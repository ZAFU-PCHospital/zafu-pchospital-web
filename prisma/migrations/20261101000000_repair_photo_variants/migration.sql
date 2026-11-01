-- 维修照片变体（issue #322）：display 复用 storage_key，新增 320 缩略图与展示尺寸。
-- 历史记录这两列为空，读取时回退到原图；P1b 回填后写入。
ALTER TABLE `repair_photos`
  ADD COLUMN `thumbnail_key` VARCHAR(255) NULL,
  ADD COLUMN `width` INT NULL,
  ADD COLUMN `height` INT NULL;

CREATE UNIQUE INDEX `repair_photos_thumbnail_key_uq` ON `repair_photos`(`thumbnail_key`);
