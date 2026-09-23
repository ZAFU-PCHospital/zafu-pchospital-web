-- M6 第九轮验收：成员列表支持拖动排序。
--
-- 为什么要这一列：成员列表的顺序是**用的人**才清楚的事（谁该排在前面），
-- 之前写死「加入时间倒序」，管理员拖不动任何一行。加了这一列并给一个稠密初始值，
-- 界面上的拖动才有意义 —— 否则就是「看着能拖、刷新就回去」的假功能。
--
-- 回填顺序与旧的默认顺序**逐行一致**（加入时间倒序、id 兜底），
-- 所以这次迁移不会改变任何人在列表里看到的位置。
ALTER TABLE `member_profiles` ADD COLUMN `sort_order` INTEGER NOT NULL DEFAULT 0;

UPDATE `member_profiles` AS `mp`
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (ORDER BY `created_at` DESC, `id` DESC) - 1 AS `position`
  FROM `member_profiles`
) AS `ranked` ON `ranked`.`id` = `mp`.`id`
SET `mp`.`sort_order` = `ranked`.`position`;

CREATE INDEX `member_profiles_order_idx` ON `member_profiles`(`deleted_at`, `sort_order`, `created_at`);
