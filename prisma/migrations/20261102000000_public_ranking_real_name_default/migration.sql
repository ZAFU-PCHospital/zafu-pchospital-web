-- issue #330：首页维修排行默认展示真实干事姓名。
-- 保留后台「实名 / 昵称 / 隐藏」开关；HIDDEN 是管理员的明确选择，不覆盖。
-- 现有单行配置若仍是旧的默认 NICKNAME，一并切到 REAL_NAME；该策略变化应在发布说明中告知。

ALTER TABLE `public_content_settings`
  ALTER COLUMN `ranking_display_name` SET DEFAULT 'REAL_NAME';

UPDATE `public_content_settings`
SET `ranking_display_name` = 'REAL_NAME'
WHERE `ranking_display_name` = 'NICKNAME';
