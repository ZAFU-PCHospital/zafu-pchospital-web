# 维修照片存量回填与原图删除（P1b）

适用 issue #323。只处理 `repair_photos` 的旧记录；不做站点静态图、HEIC 转换或 OSS/CDN。

## 前置条件

1. P1（#322）已部署，`repair_photos.thumbnail_key / width / height` 迁移已应用。
2. 文件存储使用生产 `UPLOAD_PATH`（默认 `/opt/zafu-pchospital-web/storage/uploads`）。
3. `tools/backup` 定时备份已安装，且刚完成一次可校验的备份（数据库 + uploads + config）。

先手动跑一次备份并记下目录：

```bash
sudo /usr/local/bin/zafu-backup
sudo ls -l /opt/zafu-pchospital-backups/scheduled/daily/
```

取最新目录的 `manifest.txt` 作为后续 `--backup-manifest`。工具会核对 `db.sql.gz` /
`uploads.tar.gz` 的大小与 SHA256、表数与 INSERT，并要求 `uploads_files > 0`；真正执行
apply 时还会检查 `uploads.tar.gz` 条目确实包含待处理原图，而不是只验归档完整性。

## 1. 回填 dry-run

```bash
cd /opt/zafu-pchospital-web
sudo pnpm repair:photos:backfill --json=/opt/zafu-pchospital-backups/photo-backfill-dry.json
```

工具只读取 / 校验 / 解码，不写文件或数据库。apply 需要读取 root-only 备份目录并删除 uploads 文件，生产上使用 `sudo` 执行；若已给运维账号单独的备份读权限和 uploads 权限，也可用该账号。逐张输出 `ready`，并核对：

- 原图文件存在，大小和数据库摘要一致；
- 能生成 display / thumb；
- 软删除照片也列入（回填后会一并处理）。

任何 `missing-original`、`size-mismatch`、`digest-mismatch`、`decode-failed` 都会让 dry-run
以非 0 退出。先查明原因，不要带着失败项执行 apply。

## 2. 回填 apply

```bash
cd /opt/zafu-pchospital-web
sudo pnpm repair:photos:backfill --apply \
  --backup-manifest=/opt/zafu-pchospital-backups/scheduled/daily/<时间>/manifest.txt \
  --manifest-out=/opt/zafu-pchospital-backups/photo-backfill-<runId>.json \
  --expect-db=zafu_pchospital \
  --json=/opt/zafu-pchospital-backups/photo-backfill-result.json
```

每张照片：

1. 先写 display / thumb；2. 以 `thumbnail_key IS NULL` 为条件更新数据库；3. 同一事务写
   `repair.photo.backfilled` 审计。更新失败会删除刚写的两个变体，原图保持不动。

结束时核对：

- 清单的 `database` 必须与当前库一致（apply/dry-run 都会核对）；
- `remainingLegacy = 0`、`missingVariantFiles = 0`、`mismatchedRows = 0`；
- 原图文件仍在，等下一步删除；
- 用有照片查看权限的账号抽样打开 `/api/v1/repair-photos/<id>/content` 与
  `...?variant=thumb`，确认 200 且图片正常（工具已校验文件与摘要，HTTP 仍需人工抽样）。

结果清单 `photo-backfill-<runId>.json` 是后续删除原图的唯一依据，**保留它**。若一轮有失败项、
修复后再次 apply，会把成功项写到多份清单；删除原图时可重复 `--manifest`，工具按 photoId 去重。

## 3. 观察期

- 回填完成到删除原图之间保留至少一个观察期（建议不少于 7 天，最终由负责人确认）。
- 观察期内不要删除定时备份；发现展示异常时可用备份恢复数据库和 uploads。
- 可以随时重跑 dry-run；已经回填的照片不会被重复处理。

## 4. 原图删除

先 dry-run，只列出清单内、当前数据库仍指向新变体、变体摘要一致、原图摘要一致且没有任何
`repair_photos` 行再引用原图键的文件：

```bash
cd /opt/zafu-pchospital-web
sudo pnpm repair:photos:prune-originals \
  --manifest=/opt/zafu-pchospital-backups/photo-backfill-<runId>.json \
  --json=/opt/zafu-pchospital-backups/photo-prune-dry.json
```

确认列表与回填清单数量、键名逐项一致后，再执行：

```bash
sudo pnpm repair:photos:prune-originals \
  --manifest=/opt/zafu-pchospital-backups/photo-backfill-<runId>.json \
  --apply \
  --backup-manifest=/opt/zafu-pchospital-backups/scheduled/daily/<新备份>/manifest.txt \
  --expect-db=zafu_pchospital \
  --json=/opt/zafu-pchospital-backups/photo-prune-result.json
```

删除前建议再跑一次备份，确保备份包含回填后的数据库与**尚未删除的原图**。工具只调用
`repair_photos` 清单里的原图键；`repairs/` 之外的静态文件、清单外孤儿文件和备份目录都不会被碰。
`--apply` 必须同时提供 `--json=<结果清单>`，作为不可逆删除的持久记录；每成功删除一张原图
会写 `repair.photo.original.pruned` 审计（photoId、原图键、runId）。

删除后核对：

- `remainingOriginalFiles = 0`，display / thumb 文件仍在；
- 再抽样访问两个 variant，确认不 404；
- `unreferencedFiles` 只应剩下既有孤儿（如有），不要为了清零手工删除未知文件。

## 失败与回滚

- **回填部分失败**：失败项留在结果清单的 `failures` 和 dry-run 输出里；成功的行已更新，
  重跑只处理剩余 `thumbnail_key IS NULL` 的行。不要重复执行删除，先让回填 post-check 通过。
- **写到一半被杀**：数据库行未更新的变体可能成为孤儿；原图仍在。先重跑回填，再按清单
  核对；孤儿文件留给 P3+ 孤儿清理，不要手工删除未知键。
- **回填后展示异常、尚未删原图**：直接重跑会跳过已更新行；需要回退时用定时备份恢复
  数据库，uploads 备份恢复原图（变体文件可作为孤儿留存）。
- **删除原图后发现异常**：用删除前的新备份恢复数据库与 uploads；恢复前暂停应用写入。
- **部分原图已删除后重跑 prune**：必须继续使用第一次删除前的同一份备份（它包含已删原图），
  不要换成只包含剩余文件的新备份；工具会在 apply 前核对清单原图是否都在备份归档里。
- **多份回填清单来自不同数据库**：工具直接拒绝；不要手工拼接清单。
- **备份校验失败 / 文件大小不符**：删除该备份目录，重新执行 `zafu-backup`；不要拿失败备份
  继续操作。
- **库名不符**：工具在写库或删文件前用 `--expect-db` 核对；报错即停止，不要用
  `ALLOW_NON_TEST_DB` 绕过。

## 不在本工具范围

- 新照片上传、变体生成、内容接口：见 P1（#322）。
- 客户端压缩、HEIC 提示与上传进度：P2。
- 前端缩略图 / lightbox：P3。
- 孤儿清理与磁盘告警：P3+。
