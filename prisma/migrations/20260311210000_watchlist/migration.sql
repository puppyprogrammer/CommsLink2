-- CreateEnum
-- Note: MySQL doesn't have native enums in migrations; Prisma handles this via column type

-- CreateTable
CREATE TABLE `watchlist_item` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `video_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `channel_title` VARCHAR(191) NULL,
    `thumbnail_url` VARCHAR(191) NULL,
    `duration` VARCHAR(191) NULL,
    `status` ENUM('UNWATCHED', 'WATCHED') NOT NULL DEFAULT 'UNWATCHED',
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `watchlist_item_user_id_video_id_key`(`user_id`, `video_id`),
    INDEX `watchlist_item_user_id_status_idx`(`user_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `watchlist_item` ADD CONSTRAINT `watchlist_item_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
