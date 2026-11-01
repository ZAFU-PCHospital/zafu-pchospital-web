# 维修照片存储运维（P3+）

适用 issue #326。覆盖维修照片的孤儿文件清理、存储指标观察，以及 OSS/CDN、异步图像处理的评估结论。
**不改变现有权限模型，不公开原图**；本轮不引入 OSS/CDN、异步 worker 或 HEIC 转换。

## 当前存储与备份

- 上传根目录由 `UPLOAD_PATH` 指定，生产默认 `/opt/zafu-pchospital-web/storage/uploads`；
  照片键统一为 `repairs/<两位前缀>/<uuid>.webp`，数据库只保存键，不保存绝对路径。
- `repair_photos.storage_key` 指向 display 变体，`thumbnail_key` 指向缩略图；
  软删除照片保留行与两个键，文件仍然有引用。
- 内容接口 `/api/v1/repair-photos/:id/content` 仍按现有权限校验后读本地文件，没有公开桶或 CDN。
- 定时备份 `tools/backup` 每日打包数据库、uploads 与配置；容量阈值与告警也由该脚本负责（见第 2 节），
  本轮没有新增第二套告警实现。

## 1. 孤儿文件清理

### 判定口径

- 引用集合 = 所有 `repair_photos` 行的 `storage_key` 与 `thumbnail_key`（包含软删除照片）。
- 孤儿 = `UPLOAD_PATH/repairs/` 下存在、但不在引用集合里的普通文件。
- 数据库有引用但文件缺失是 **missing reference**，工具只报告、不删除；先排查存储挂载或数据问题。
- 只扫描 `repairs/`，不会碰上传根目录下的其它文件、站点静态资源或备份目录。

### 安全设计

- 缺省 dry-run，只扫描和输出报告。
- 文件修改时间必须早于 `--min-age-hours`（默认 24 小时）才会成为候选，避免误删「已写文件、数据库事务尚未提交」的上传。
- 单轮候选超过 `--max-delete`（默认 500）直接拒绝执行，防止 `UPLOAD_PATH` 配错导致大批量删除。
- `--apply` 强制要求：
  1. 一份通过 `verifyBackupManifest` 校验的定时备份（大小、SHA256、表数、INSERT、uploads 文件数）；
  2. 备份 `uploads.tar.gz` 确实包含全部候选文件；
  3. `--expect-db` 与当前 `DATABASE_URL` 库名一致；
  4. 输出 `--json` 结果清单。
- 每个候选删除前复核：引用集合、文件大小、修改时间；删除成功后再写
  `repair.photo.orphan.pruned` SYSTEM 审计（`target_type=RepairPhotoStorage`，before 含 storageKey）。
- 审计写入失败会标记 `audit-failed`（文件已删除，不要重复删除），按结果清单补审计记录。
- 幂等：已删除的文件下一轮不再出现；`already-missing`、`still-referenced` 不会重复写审计。

### 用法

先跑 dry-run：

```bash
cd /opt/zafu-pchospital-web
sudo pnpm repair:photos:orphans \
  --json=/opt/zafu-pchospital-backups/photo-orphans-dry.json
```

确认报告里的候选数量、总字节、`missingReferencedFiles` 与 `invalidReferencedKeys` 都为预期后，先做一次备份并执行：

```bash
sudo /usr/local/bin/zafu-backup
# 取最新 daily/<时间>/manifest.txt
sudo pnpm repair:photos:orphans --apply \
  --backup-manifest=/opt/zafu-pchospital-backups/scheduled/daily/<时间>/manifest.txt \
  --expect-db=zafu_pchospital \
  --json=/opt/zafu-pchospital-backups/photo-orphans-result.json
```

可选参数：

| 参数                  | 默认                      | 说明                                         |
| --------------------- | ------------------------- | -------------------------------------------- |
| `--min-age-hours=<n>` | 24                        | 文件需早于该小时数才可删除；0 仅用于受控测试 |
| `--max-delete=<n>`    | 500                       | 单轮最多删除数，超过拒绝执行                 |
| `--json=<path>`       | dry-run 可选 / apply 必填 | 报告或结果清单，权限 600                     |

### 判读与失败处理

- `candidate` / `deleted`：候选 / 已删除；`too-new`：仍在安全窗内，留待下一轮。
- `changed`：扫描后文件大小或修改时间变化，跳过并重跑；`still-referenced`：出现新引用，跳过。
- `already-missing`：删除前文件已不存在，正常幂等结果。
- `delete-failed` / `audit-failed`：保留 JSON，按 message 排查；`audit-failed` 不要重复删除。
- 事后核对：`postCheck.remainingCandidates` 必须为 0、`postCheck.failed` 必须为 0。
- 回滚：从删除前备份恢复 `uploads.tar.gz`；若数据库也需要回退，用同一份备份的 `db.sql.gz`，
  恢复前暂停应用写入。观察期内不要删除备份。
- `missingReferencedFiles > 0` 或 `invalidReferencedKeys > 0` 时工具会以非 0 退出；先查清原因，
  不要手工删除未知文件。

## 2. 存储与磁盘指标、容量告警

以上能力已经由现有的 `zafu-backup` 实现，issue #326 不重复建设：

- `manifest.txt`：`uploads_files`、`uploads_bytes`、`disk_free_bytes` 等，随每日备份生成。
- `status.json`（`/var/lib/zafu-backup/status.json`）：`status`、`finished_at`、`host`、`backup_dir`、
  `disk_free_bytes`、`message`；失败时同样写入。
- 阈值（`/etc/zafu-backup.conf`）：`MIN_FREE_BYTES`（默认 5 GiB）、`DISK_WARN_PCT`（默认 85）、
  `MAX_SCHEDULED_BYTES`（默认 1 GiB）。低于可用空间或超过使用率时先清理最旧 daily，仍不达标则备份失败。
- 告警：`ALERT_HOOK` 接收 `success|failure` 与脱敏摘要；默认 `ALERT_ON_SUCCESS=0`，只在失败时发送。
  安装、脱敏与联调要求见 `tools/backup/README.md`。
- 孤儿工具的 dry-run 报告另外提供：文件数 / 总字节、引用键数、缺失引用、孤儿数 / 字节、
  候选数 / 字节、安全窗内文件数；可作为临时存储盘点，不替代每日备份告警。

常用观察命令：

```bash
cat /var/lib/zafu-backup/status.json
cat /opt/zafu-pchospital-backups/scheduled/daily/<时间>/manifest.txt
sudo pnpm repair:photos:orphans --json=/tmp/photo-storage-report.json
```

## 3. OSS/CDN + 短期签名 URL 评估

**结论：当前不接入。** 现有照片规模、单机部署与每日备份下，本地存储 + 权限校验的内容接口更简单；
接入对象存储会引入外部依赖、费用、签名泄漏面与缓存/回滚复杂度。达到以下任一条件再排期：

- uploads 超过约 20 GB，或磁盘使用率持续接近备份告警阈值；
- 内容接口带宽/延迟成为瓶颈，或需要多实例共享存储；
- 需要异地容灾，且现有「本地备份 + 手工恢复」不能满足 RTO/RPO。

若届时接入，建议方案与约束：

- **私有 bucket**：禁止公共读；对象键直接复用 `storageKey`，不改数据库结构。
- **签名 URL**：内容接口校验现有权限后返回短期签名 URL（建议 5–10 分钟）；不把原图放入公开桶。
  签名 URL 是 bearer token，禁止写入访问日志、Referer 或前端持久化；过期后由页面重新请求。
- **缓存**：对象键不可变，保留现有 ETag；CDN 只缓存私有响应并正确区分签名参数，不能把签名 URL
  当成公共缓存键；`Cache-Control` 使用 private，不缓存原图。
- **费用**：按「存储容量 + 外网下行 + 请求次数」估算，实际单价以云厂商账单为准；迁移前用
  `manifest.txt` 的 `uploads_files/uploads_bytes` 和生产访问日志估算月流量，先做小流量灰度。
- **回滚**：保留本地文件至少 30 天；用 `REPAIR_PHOTO_BACKEND=local|oss` 一类开关切换读取，
  OSS 读取失败回落本地；对象键不变，回滚不需要数据库迁移。写入切换前先双读验证，再切写。
- **迁移步骤**：备份 → 上传对象并核对 SHA256 → 双读灰度 → 切读 → 观察期 → 切写 → 清理本地。
  任一步失败都保持本地可读，并从备份恢复。

## 4. 异步图像处理 / 独立 worker 评估

**结论：当前不引入。** 上传时同步生成 display/thumb 已有并发槽位控制（`withRepairPhotoImageSlot`），
单张 1280 长边 WebP + 320 缩略图的处理时间在可接受范围；引入队列会增加任务表、重试、状态展示与
运维组件。达到以下条件再评估：

- 上传处理 p95 明显超过 2–3 秒，或频繁触发请求超时；
- 批量导入/回填造成内存或 CPU 压力，影响正常请求；
- 需要 HEIC 转换或更重的图像处理，且 P0/P2 数据显示确有需求。

若引入：用任务表/outbox 记录照片 ID 与幂等键，worker 按照片 ID 幂等生成变体；上传接口先落原文件与
任务，返回处理中状态；失败重试有上限并保留审计；内容接口在变体未就绪时回退原图/占位。HEIC 转换
需要额外解码依赖，仍只在数据证明必要时再做。

## 5. 生产执行清单（assignee）

1. 确认 P1b 回填/原图删除已完成，`tools/backup` 定时任务正常，最近一次备份可校验。
2. 执行 `zafu-backup`，记下 `manifest.txt`；观察期内保留该备份。
3. 跑孤儿 dry-run，核对候选数量、字节数、缺失引用与非法键；有异常先排查。
4. 执行 apply（带 `--backup-manifest`、`--expect-db`、`--json`），检查 `postCheck` 与审计数量。
5. 抽样访问照片内容接口（display / thumb）确认 200；确认未触碰站点静态图与备份目录。
6. 生产删除由 assignee 执行；不要手工 `rm` 未知文件，不要把 `.env`/备份路径发到聊天或日志。

## 不在本轮范围

- 权限模型、内容接口鉴权、公开原图；
- OSS/CDN 实际接入、签名 URL 实现；
- 异步 worker、HEIC 转换；
- 站点静态图与 `repairs/` 之外的文件。
