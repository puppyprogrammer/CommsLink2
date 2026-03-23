CREATE TABLE `ffxiv_user` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password_hash` VARCHAR(191) NOT NULL,
    `content_id` VARCHAR(191) NULL,
    `char_name` VARCHAR(191) NULL,
    `voice_id` VARCHAR(191) NOT NULL DEFAULT 'Rachel',
    `credit_balance` INTEGER NOT NULL DEFAULT 500,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ffxiv_user_email_key`(`email`),
    INDEX `ffxiv_user_email_idx`(`email`),
    INDEX `ffxiv_user_content_id_idx`(`content_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
