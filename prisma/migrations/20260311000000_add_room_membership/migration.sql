-- AlterTable
ALTER TABLE `user` ADD COLUMN `last_room_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `room` ADD COLUMN `cmd_moderation_enabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `room_member` (
    `id` VARCHAR(191) NOT NULL,
    `room_id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'member',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `room_member_room_id_idx`(`room_id`),
    INDEX `room_member_user_id_idx`(`user_id`),
    UNIQUE INDEX `room_member_room_id_user_id_key`(`room_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `room_member` ADD CONSTRAINT `room_member_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `room_member` ADD CONSTRAINT `room_member_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
