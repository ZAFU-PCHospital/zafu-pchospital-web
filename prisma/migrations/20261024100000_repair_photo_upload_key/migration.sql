-- issue #324：照片上传幂等键（响应丢失后重试同一文件不重复落库）。
-- 新增可空列 + 同记录唯一索引；历史行与不带键的旧客户端保持 NULL，不受影响。
ALTER TABLE `repair_photos`
  ADD COLUMN `upload_key` VARCHAR(160) NULL;

CREATE UNIQUE INDEX `repair_photos_record_upload_key_uq`
  ON `repair_photos` (`repair_record_id`, `upload_key`);
