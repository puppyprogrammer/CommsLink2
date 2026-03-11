-- AlterTable
ALTER TABLE `room` ADD COLUMN `cmd_terminal_enabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `machine` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `owner_id` VARCHAR(191) NOT NULL,
    `socket_id` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'offline',
    `os` VARCHAR(191) NULL,
    `last_seen` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `machine_owner_id_idx`(`owner_id`),
    INDEX `machine_status_idx`(`status`),
    UNIQUE INDEX `machine_owner_id_name_key`(`owner_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `machine_permission` (
    `id` VARCHAR(191) NOT NULL,
    `machine_id` VARCHAR(191) NOT NULL,
    `room_id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,

    INDEX `machine_permission_machine_id_idx`(`machine_id`),
    INDEX `machine_permission_room_id_idx`(`room_id`),
    UNIQUE INDEX `machine_permission_machine_id_room_id_key`(`machine_id`, `room_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `machine` ADD CONSTRAINT `machine_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `machine_permission` ADD CONSTRAINT `machine_permission_machine_id_fkey` FOREIGN KEY (`machine_id`) REFERENCES `machine`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `machine_permission` ADD CONSTRAINT `machine_permission_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
