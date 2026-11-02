-- issue #335：客户 no-show 黑名单。
-- 客户身份暂以「规范化姓名 + 手机号」精确匹配，不关联 users / member_profiles。
-- no-show 事件一个报名最多一条；封锁表按客户唯一，封到本学年结束。
-- 不改现有报名状态机；自助取消见 issue #345。

CREATE TABLE `repair_activity_no_show_events` (
  `id` CHAR(36) NOT NULL,
  `registration_id` CHAR(36) NOT NULL,
  `activity_id` CHAR(36) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `name_normalized` VARCHAR(80) NOT NULL,
  `phone` VARCHAR(11) NOT NULL,
  `phone_last4` VARCHAR(4) NOT NULL,
  `state` VARCHAR(16) NOT NULL DEFAULT 'CONFIRMED',
  `source` VARCHAR(16) NOT NULL DEFAULT 'AUTO',
  `detected_at` DATETIME(3) NOT NULL,
  `confirmed_at` DATETIME(3) NULL,
  `excused_at` DATETIME(3) NULL,
  `excused_by_user_id` CHAR(36) NULL,
  `note` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `repair_activity_no_show_events_registration_uq` (`registration_id`),
  INDEX `repair_activity_no_show_customer_state_idx` (`name_normalized`, `phone`, `state`),
  INDEX `repair_activity_no_show_activity_state_idx` (`activity_id`, `state`),
  CONSTRAINT `repair_activity_no_show_state_chk` CHECK (`state` IN ('CANDIDATE', 'CONFIRMED', 'EXCUSED')),
  CONSTRAINT `repair_activity_no_show_source_chk` CHECK (`source` IN ('AUTO', 'HISTORICAL', 'MANUAL')),
  CONSTRAINT `repair_activity_no_show_registration_fkey` FOREIGN KEY (`registration_id`) REFERENCES `repair_activity_registrations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repair_activity_no_show_activity_fkey` FOREIGN KEY (`activity_id`) REFERENCES `repair_activities`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repair_activity_no_show_excused_by_fkey` FOREIGN KEY (`excused_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

CREATE TABLE `repair_activity_customer_blocks` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(40) NOT NULL,
  `name_normalized` VARCHAR(80) NOT NULL,
  `phone` VARCHAR(11) NOT NULL,
  `phone_last4` VARCHAR(4) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `source` VARCHAR(16) NOT NULL,
  `blocked_until` DATETIME(3) NOT NULL,
  `lifted_at` DATETIME(3) NULL,
  `lifted_by_user_id` CHAR(36) NULL,
  `lifted_reason` VARCHAR(500) NULL,
  `created_by_user_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `repair_activity_customer_blocks_customer_uq` (`name_normalized`, `phone`),
  INDEX `repair_activity_customer_blocks_status_idx` (`blocked_until`, `lifted_at`),
  CONSTRAINT `repair_activity_customer_block_source_chk` CHECK (`source` IN ('AUTO', 'MANUAL')),
  CONSTRAINT `repair_activity_customer_block_created_by_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `repair_activity_customer_block_lifted_by_fkey` FOREIGN KEY (`lifted_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ENGINE=InnoDB;

-- 客户同步查询：按手机号/状态收窄，姓名再在应用层规范化比较。
CREATE INDEX `repair_activity_regs_phone_status_idx`
  ON `repair_activity_registrations` (`phone`, `status`, `activity_id`);
