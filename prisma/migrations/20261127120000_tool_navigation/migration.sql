-- 工具导航：公开 `/tools` 页的分组与网站由后台维护，不再写死在 src/config/tools.ts。
--
-- 两张表都沿用既有约定：
--   * 软删除（`deleted_at`）—— 停用/删除后历史仍可追溯，不做物理删除；
--   * `sort_order` 稠密序号 —— 后台「上移 / 下移」与拖动排序都按它重排；
--   * `created_by` 指向 users，审计日志记录操作人。
-- 初始数据（6 个分类 / 31 个网站）由 `pnpm db:seed` 补齐，重复执行不覆盖管理员修改。

CREATE TABLE `tool_categories` (
  `id` CHAR(36) NOT NULL,
  `code` VARCHAR(64) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `label_en` VARCHAR(64) NULL,
  `description` VARCHAR(500) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  UNIQUE INDEX `tool_categories_code_uq`(`code`),
  INDEX `tool_categories_active_deleted_sort_idx`(`is_active`, `deleted_at`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `tool_sites` (
  `id` CHAR(36) NOT NULL,
  `category_id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `url` VARCHAR(500) NOT NULL,
  `description` VARCHAR(200) NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  `deleted_at` DATETIME(3) NULL,
  INDEX `tool_sites_category_active_deleted_sort_idx`(`category_id`, `is_active`, `deleted_at`, `sort_order`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

ALTER TABLE `tool_categories` ADD CONSTRAINT `tool_categories_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `tool_sites` ADD CONSTRAINT `tool_sites_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `tool_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `tool_sites` ADD CONSTRAINT `tool_sites_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
