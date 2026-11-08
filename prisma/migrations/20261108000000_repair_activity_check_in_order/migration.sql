-- 批量签到按管理员勾选顺序入队（issue #358）。
-- 历史行与未签到行为 NULL；队列读取时同 checkedInAt 再按本列升序，NULL 排在有序行之后。
ALTER TABLE `repair_activity_registrations`
  ADD COLUMN `check_in_order` INTEGER NULL;
