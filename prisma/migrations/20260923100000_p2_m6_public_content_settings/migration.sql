-- M6 批次 2：公开内容与展示策略
-- 前向 Migration：新增 PublicContentSetting（`/admin/settings` 的持久化）。
-- 不修改 M0–M4 已执行 Migration，不使用 prisma db push 或手工 DDL。
--
-- 为什么必须是新表而不是复用既有表：需求 §74 要求「展示策略由管理员配置」，
-- 这是需要被审计的**可持久化配置**，既不属于某个成员，也不属于本机环境变量
-- （环境变量改不了、也没有变更留痕）。M7 接入官网公开数据时消费这一行。

-- 1) 公开内容与展示策略（单行配置表，主键即单行约束）
CREATE TABLE `public_content_settings` (
  `id` CHAR(32) NOT NULL,
  `public_repair_stats_enabled` BOOLEAN NOT NULL DEFAULT false,
  `public_repair_stats_detail_enabled` BOOLEAN NOT NULL DEFAULT false,
  `public_rankings_enabled` BOOLEAN NOT NULL DEFAULT false,
  `ranking_display_name` VARCHAR(16) NOT NULL DEFAULT 'NICKNAME',
  `updated_by_user_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

ALTER TABLE `public_content_settings` ADD CONSTRAINT `public_content_settings_ranking_display_name_chk` CHECK (`ranking_display_name` IN ('REAL_NAME', 'NICKNAME', 'HIDDEN'));

ALTER TABLE `public_content_settings` ADD CONSTRAINT `public_content_settings_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
