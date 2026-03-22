CREATE TABLE `audit_log` (
    `id` VARCHAR(191) NOT NULL,
    `event` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `ip_address` VARCHAR(191) NULL,
    `details` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_log_event_idx`(`event`),
    INDEX `audit_log_username_idx`(`username`),
    INDEX `audit_log_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
