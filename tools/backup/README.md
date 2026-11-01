# 定时备份（GreatSQL + uploads + 配置）

## 范围与策略

- 每日 03:40（Asia/Shanghai）由 `zafu-backup.timer` 触发，`zafu-backup.service` 以 root 执行一次。
- 备份到 `/opt/zafu-pchospital-backups/scheduled/`：
  - `daily/YYYYmmdd-HHMMSS/`：`db.sql.gz`、`uploads.tar.gz`、`config.tar.gz`、`manifest.txt`
  - `weekly/YYYY-Www/`：每周日备份的硬链接副本
  - `monthly/YYYY-MM/`：每月 1 日备份的硬链接副本
- 保留：每日 14 份、每周 8 份、每月 6 份；定时备份目录上限 1GiB。
- 闸门：备份前要求 `/opt` 可用空间 ≥ 5GiB；根分区使用率 ≥ 85% 时先清最旧定时备份，仍高则中止。
- 不备份 `.next`、`node_modules`、`public/handbook`、`.docs-source`、日志和 Docker 层。
- 配置备份含 `.env` 等敏感文件：目录 700、文件 600；**不要直接外发**。本地备份不能防整盘损坏；
  以后接 OSS/NAS 前必须先加密。
- 照片孤儿清理与存储指标观察见 [维修照片存储运维（P3+）](../../docs/photo-storage-ops.md)；
  容量阈值和告警仍以本目录脚本为唯一实现，不另建重复告警。

## 安装

```bash
install -m 755 tools/backup/backup.sh /usr/local/bin/zafu-backup
install -m 600 tools/backup/zafu-backup.conf.example /etc/zafu-backup.conf
install -m 644 tools/backup/zafu-backup.service /etc/systemd/system/zafu-backup.service
install -m 644 tools/backup/zafu-backup.timer /etc/systemd/system/zafu-backup.timer
install -d -m 700 /opt/zafu-pchospital-backups/scheduled/{daily,weekly,monthly}
install -d -m 700 /var/lib/zafu-backup
systemctl daemon-reload
systemctl enable --now zafu-backup.timer
/usr/local/bin/zafu-backup --dry-run
/usr/local/bin/zafu-backup
systemctl list-timers zafu-backup.timer
```

已有 `/etc/zafu-backup.conf` 时不要覆盖，先比对差异。

## 验证

```bash
zafu-backup --dry-run
zafu-backup
ls -l /opt/zafu-pchospital-backups/scheduled/daily
cat /var/lib/zafu-backup/status.json
journalctl -u zafu-backup -n 50 --no-pager
```

`manifest.txt` 包含表数、INSERT 数、文件 SHA256、git HEAD、BUILD_ID 和磁盘余量；
`db.sql.gz` 需通过 `gzip -t`。恢复演练建议每月一次，恢复到一个临时库/临时目录，**不要直接覆盖生产**。

## QQ bot 告警交接（bot 管理 agent 负责）

备份脚本只负责产生状态和调用 hook，不包含 QQ 凭据/发送逻辑。

- 配置项（`/etc/zafu-backup.conf`，root 600）：
  - `ALERT_HOOK`：可执行文件的绝对路径；脚本调用时传两个参数：`success|failure`、简短摘要。
  - `ALERT_ON_SUCCESS=0`：默认只在失败时调用；需要每日成功摘要时设为 1。
- 状态文件：`/var/lib/zafu-backup/status.json`，包含 `status`、`finished_at`、`host`、
  `backup_dir`、`disk_free_bytes`、`message`；不含数据库口令或客户数据。
- 失败退出码非 0；`journalctl -u zafu-backup` 有完整日志。
- bot agent 的实现要求：
  1. 用现有 QQ bot 的运维通道发送到固定管理群；token 只放服务器 root-only 文件/环境，不进仓库、日志或聊天。
  2. hook 读取 `status.json`，消息至少包含：主机、时间、成功/失败、备份目录（失败可省略）、磁盘可用字节；
     禁止发送 `.env`、连接串、手机号、姓名或请求正文。
  3. 失败立即发送；成功摘要（若开启）每日一次；对相同失败做去重/限频，避免 QQ 刷屏。
  4. 安装后先 `zafu-backup` 正常跑一次，再手动执行 hook：
     `/usr/local/bin/<hook> failure "备份告警联调"`，确认收到消息；把 hook 路径写回 `ALERT_HOOK`。
  5. 若选择 `OnFailure=` 而不是 hook，必须在 drop-in 中实现同样的脱敏与限频规则，并回写安装说明。

## 恢复

```bash
# 数据库（示例，先建临时库/确认目标）
zcat daily/<timestamp>/db.sql.gz | docker exec -i zafu-pchospital-db-greatsql-1 \
  mysql -uroot -p zafu_pchospital_restore_test

# 上传文件：解包到临时目录核对后再替换
tar -xzf daily/<timestamp>/uploads.tar.gz -C /tmp/restore-check
# 配置：含 .env，只在安全终端解包；不要输出到日志
```
