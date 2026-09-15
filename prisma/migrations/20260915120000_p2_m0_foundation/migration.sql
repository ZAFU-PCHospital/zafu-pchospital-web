SET SESSION default_storage_engine = InnoDB;

-- CreateTable
CREATE TABLE `users` (
    `id` CHAR(36) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `display_name` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `users_status_deleted_idx`(`status`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_identities` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `identifier_normalized` VARCHAR(191) NOT NULL,
    `verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `user_identities_user_deleted_idx`(`user_id`, `deleted_at`),
    UNIQUE INDEX `user_identities_type_identifier_uq`(`type`, `identifier_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `password_credentials` (
    `user_id` CHAR(36) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `must_change_password` BOOLEAN NOT NULL DEFAULT true,
    `password_changed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `roles_code_uq`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_roles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `role_id` CHAR(36) NOT NULL,
    `source_type` VARCHAR(32) NOT NULL,
    `source_id` CHAR(36) NULL,
    `granted_by` CHAR(36) NULL,
    `granted_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `active_key` VARCHAR(80) NULL,

    UNIQUE INDEX `user_roles_active_key_uq`(`active_key`),
    INDEX `user_roles_user_revoked_idx`(`user_id`, `revoked_at`),
    INDEX `user_roles_role_idx`(`role_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `member_profiles` (
    `id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `real_name` VARCHAR(64) NOT NULL,
    `student_id` VARCHAR(32) NULL,
    `class_name` VARCHAR(80) NULL,
    `nickname` VARCHAR(64) NULL,
    `avatar_url` VARCHAR(500) NULL,
    `status` VARCHAR(32) NOT NULL,
    `joined_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `member_profiles_user_uq`(`user_id`),
    INDEX `member_profiles_status_deleted_idx`(`status`, `deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `join_applications` (
    `id` CHAR(36) NOT NULL,
    `ticket_no` VARCHAR(32) NOT NULL,
    `recruitment_cycle` VARCHAR(32) NOT NULL,
    `real_name` VARCHAR(64) NOT NULL,
    `qq_normalized` VARCHAR(32) NOT NULL,
    `phone_normalized` VARCHAR(32) NOT NULL,
    `self_introduction` TEXT NULL,
    `preferred_direction` VARCHAR(120) NULL,
    `applicant_remark` VARCHAR(500) NULL,
    `status` VARCHAR(32) NOT NULL,
    `provision_status` VARCHAR(32) NOT NULL,
    `privacy_consent_at` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL,
    `last_reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `join_applications_ticket_uq`(`ticket_no`),
    INDEX `join_applications_status_submitted_idx`(`status`, `submitted_at`),
    INDEX `join_applications_provision_updated_idx`(`provision_status`, `updated_at`),
    UNIQUE INDEX `join_applications_cycle_qq_uq`(`recruitment_cycle`, `qq_normalized`),
    UNIQUE INDEX `join_applications_cycle_phone_uq`(`recruitment_cycle`, `phone_normalized`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `join_application_reviews` (
    `id` CHAR(36) NOT NULL,
    `application_id` CHAR(36) NOT NULL,
    `result` VARCHAR(32) NOT NULL,
    `interviewed_at` DATETIME(3) NOT NULL,
    `reviewer_user_id` CHAR(36) NOT NULL,
    `internal_note` VARCHAR(2000) NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `join_reviews_application_created_idx`(`application_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invite_codes` (
    `id` CHAR(36) NOT NULL,
    `code_digest` BINARY(32) NOT NULL,
    `display_prefix` VARCHAR(12) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `active_from` DATETIME(3) NULL,
    `expires_at` DATETIME(3) NULL,
    `max_uses` INTEGER NOT NULL,
    `used_count` INTEGER NOT NULL DEFAULT 0,
    `bound_qq_normalized` VARCHAR(32) NULL,
    `bound_phone_normalized` VARCHAR(32) NULL,
    `created_by_user_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `invite_codes_digest_uq`(`code_digest`),
    INDEX `invite_codes_status_expires_idx`(`status`, `expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invite_code_redemptions` (
    `id` CHAR(36) NOT NULL,
    `invite_code_id` CHAR(36) NOT NULL,
    `user_id` CHAR(36) NOT NULL,
    `member_profile_id` CHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `redeemed_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `invite_redemptions_idempotency_uq`(`idempotency_key`),
    INDEX `invite_redemptions_code_redeemed_idx`(`invite_code_id`, `redeemed_at`),
    INDEX `invite_redemptions_user_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_provisions` (
    `id` CHAR(36) NOT NULL,
    `source_type` VARCHAR(32) NOT NULL,
    `source_id` CHAR(36) NOT NULL,
    `idempotency_key` VARCHAR(128) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `user_id` CHAR(36) NULL,
    `member_profile_id` CHAR(36) NULL,
    `attempt_count` INTEGER NOT NULL DEFAULT 0,
    `last_error_code` VARCHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `account_provisions_idempotency_uq`(`idempotency_key`),
    INDEX `account_provisions_status_updated_idx`(`status`, `updated_at`),
    UNIQUE INDEX `account_provisions_source_uq`(`source_type`, `source_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_type` VARCHAR(16) NOT NULL,
    `actor_user_id` CHAR(36) NULL,
    `action` VARCHAR(80) NOT NULL,
    `target_type` VARCHAR(80) NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `request_id` VARCHAR(64) NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `before_summary` JSON NULL,
    `after_summary` JSON NULL,
    `error_code` VARCHAR(64) NULL,
    `ip_digest` BINARY(32) NULL,
    `user_agent_digest` BINARY(32) NULL,
    `created_at` DATETIME(3) NOT NULL,

    INDEX `audit_logs_target_created_idx`(`target_type`, `target_id`, `created_at`),
    INDEX `audit_logs_actor_created_idx`(`actor_user_id`, `created_at`),
    INDEX `audit_logs_request_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `user_identities` ADD CONSTRAINT `user_identities_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `password_credentials` ADD CONSTRAINT `password_credentials_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_granted_by_fkey` FOREIGN KEY (`granted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `member_profiles` ADD CONSTRAINT `member_profiles_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `join_application_reviews` ADD CONSTRAINT `join_application_reviews_application_id_fkey` FOREIGN KEY (`application_id`) REFERENCES `join_applications`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `join_application_reviews` ADD CONSTRAINT `join_application_reviews_reviewer_user_id_fkey` FOREIGN KEY (`reviewer_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invite_codes` ADD CONSTRAINT `invite_codes_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invite_code_redemptions` ADD CONSTRAINT `invite_code_redemptions_invite_code_id_fkey` FOREIGN KEY (`invite_code_id`) REFERENCES `invite_codes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invite_code_redemptions` ADD CONSTRAINT `invite_code_redemptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invite_code_redemptions` ADD CONSTRAINT `invite_code_redemptions_member_profile_id_fkey` FOREIGN KEY (`member_profile_id`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_provisions` ADD CONSTRAINT `account_provisions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_provisions` ADD CONSTRAINT `account_provisions_member_profile_id_fkey` FOREIGN KEY (`member_profile_id`) REFERENCES `member_profiles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- GreatSQL-enforced business invariants. used_count has no application-level management write path.
ALTER TABLE `invite_codes`
    ADD CONSTRAINT `invite_codes_usage_bounds_chk`
    CHECK (`max_uses` >= 1 AND `used_count` >= 0 AND `used_count` <= `max_uses`);

ALTER TABLE `account_provisions`
    ADD CONSTRAINT `account_provisions_attempt_count_chk`
    CHECK (`attempt_count` >= 0);
