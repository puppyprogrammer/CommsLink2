-- CreateTable
CREATE TABLE `watchlist_items` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `video_id` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NULL,
    `channel` VARCHAR(191) NULL,
    `thumbnail` VARCHAR(191) NULL,
    `duration` VARCHAR(191) NULL,
    `status` ENUM('UNWATCHED', 'WATCHED') NOT NULL DEFAULT 'UNWATCHED',
    `added_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `watchlist_items_video_id_key`(`video_id`),
    INDEX `watchlist_items_user_id_idx`(`user_id`),
    INDEX `watchlist_items_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `watchlist_items` ADD CONSTRAINT `watchlist_items_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
