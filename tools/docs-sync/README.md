# docs-sync：站内文档自动同步

定时下载 `ZAFU-PCHospital/ZAFU-PCHospital-Doc` 的 **gh-pages 产物**，复用官网的主题引导、
返回链接和字体注入后，替换生产 `public/handbook`。不重新构建官网，不重启应用，不动数据库。

## 必须先配置静态文件服务

Next.js 生产模式在启动时记录 `public` 文件名，无法可靠读取定时同步新增的哈希资源。
因此 `/handbook/` **必须由 nginx 直接服务**，不能继续交给 Next.js。

把同目录的 `nginx-handbook.conf` 内容加入网站 HTTPS `server {}`，核对 `root` 与实际应用
路径一致，确保 nginx 有读取权限、`http {}` 已引入 `mime.types`。保留 server 级安全响应头。

```bash
nginx -t
systemctl reload nginx
```

若 HTTP 探针失败，新脚本会拒绝替换文档并明确提示配置静态服务；仅安装脚本不能恢复当前线上
问题。没有服务器权限时请将本说明与失败摘要交给维护者。

## 同步流程

1. 比对 gh-pages SHA；SHA 相同也检查 HTTP 资源及官网定制是否完整，异常则重新同步。
2. 按读取到的 SHA 下载产物，避免分支移动导致版本记录错误。
3. 检查正文 HTML 引用资源、搜索索引，并注入官网定制；`toc.html` 是 mdBook 的侧栏 iframe，
   只检查它的引用，不注入主导航。
4. 校验文档 main 源码配置，并额外对实际发布的哈希 CSS 校验官网主题令牌。
5. 在当前文档目录临时写入随机探针，通过真实 HTTP 读取后删除，证明新文件立即可见。
6. 把新版本复制到 `public/.handbook.stage`，同文件系统内切换目录，上一版放在
   `public/handbook.prev`。两次 rename 之间有极短缺口，并非整个过程原子化。
7. 检查首页、HTML 引用的 CSS/JS 与搜索索引：状态、Content-Type、内容字节均正确才写入
   `/var/lib/docs-sync/deployed-sha`；失败则恢复上一版，并返回非零退出码。

## 安装 / 升级（服务器上以 root 执行）

先部署官网仓库内的配套文件，包括 `tools/handbook.mjs`、`tools/check-theme-palette.mjs`、
`tools/docs-source.mjs` 与当前官网主题令牌文件。系统安装的 `/usr/local/bin/docs-sync` 是副本，
仓库更新不会自动更新它。

```bash
install -m 755 /opt/zafu-pchospital-web/tools/docs-sync/sync-handbook.sh /usr/local/bin/docs-sync
mkdir -p /var/lib/docs-sync
chown zafu-web:zafu-web /var/lib/docs-sync
install -m 644 /opt/zafu-pchospital-web/tools/docs-sync/docs-sync.service /etc/systemd/system/
install -m 644 /opt/zafu-pchospital-web/tools/docs-sync/docs-sync.timer /etc/systemd/system/
systemctl daemon-reload
systemctl start docs-sync.service
journalctl -u docs-sync -n 50 --no-pager
systemctl enable --now docs-sync.timer
```

环境变量可通过 `systemctl edit docs-sync.service` 配置，例如：

```ini
[Service]
Environment=DOCS_SYNC_BASE_URL=https://pczafu.cn/handbook/
```

`DOCS_SYNC_BASE_URL` 默认即为该地址，必须以 `/handbook/` 结尾，指向实际文档入口；不要指向
另一个目录或未应用静态配置的 Next.js 端口。HTTP 验证失败会回滚，配置错误不会被静默跳过。
Node.js 必须符合官网 `package.json` 的 engines。服务账号仍是 `zafu-web`。

## 查看与回滚

```bash
systemctl list-timers docs-sync.timer
journalctl -u docs-sync -n 50 --no-pager
cat /var/lib/docs-sync/deployed-sha
systemctl start docs-sync.service
```

手工回滚前停 timer，再在生产 public 目录中执行：

```bash
systemctl disable --now docs-sync.timer
cd /opt/zafu-pchospital-web/public
mv handbook handbook.bad
mv handbook.prev handbook
```

回滚后 SHA 记录可能与磁盘不一致；恢复 timer 前先核对要保留的版本。新脚本会检查内容健康，
发现不一致可能重新同步。不要通过设置相同 SHA 来代替版本固定。

## 演练（不碰线上）

先在临时路径准备独立 HTTP 静态服务，入口须为 `/handbook/`，映射该路径下的
`public/handbook`。不能用生产 URL 验证临时目录。

```bash
DOCS_SYNC_APP_DIR=/tmp/rehearsal \
DOCS_SYNC_STATE_DIR=/tmp/rehearsal-state \
DOCS_SYNC_TOOLS_DIR=/opt/zafu-pchospital-web \
DOCS_SYNC_BASE_URL=http://127.0.0.1:8080/handbook/ \
  bash /usr/local/bin/docs-sync
```

验证新资源可访问、官网定制存在、SHA 无变化时健康检查通过。再模拟 CSS 请求 404 或返回旧
内容，确认发布失败、目录恢复且 SHA 未更新。探针无论成功或失败都应删除。

## 已知边界

- `/tools` 清单在 `next build` 时静态 import；增删页仍需下一次整站部署更新清单。
- 上游源码 main 与 gh-pages 分别发布；两者或官网配色不一致时拒绝同步，等待正确版本。
- 服务器外网、HTTP 入口或权限异常会导致本次失败，下一次 timer 会重试；通过日志定位。
- HTTP 校验覆盖文档资源与首页，不验证生产浏览器的主题交互，也不自动修改 nginx。
- 旧页面可能持有已被新版删除的哈希资源链接，需要刷新；本次未实现多版本资源保留。
