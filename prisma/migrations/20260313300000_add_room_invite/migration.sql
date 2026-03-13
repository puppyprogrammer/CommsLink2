-- CreateTable
CREATE TABLE `room_invite` (
    `id` VARCHAR(191) NOT NULL,
    `room_id` VARCHAR(191) NOT NULL,
    `token` VARCHAR(191) NOT NULL,
    `created_by` VARCHAR(191) NOT NULL,
    `expires_at` DATETIME(3) NULL,
    `uses_left` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `room_invite_token_key`(`token`),
    INDEX `room_invite_room_id_idx`(`room_id`),
    INDEX `room_invite_token_idx`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `room_invite` ADD CONSTRAINT `room_invite_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
