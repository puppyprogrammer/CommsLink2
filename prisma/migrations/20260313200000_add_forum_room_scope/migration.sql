-- AlterTable
ALTER TABLE `room` ADD COLUMN `cmd_forum_enabled` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `thread` ADD COLUMN `room_id` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `thread_room_id_last_reply_at_idx` ON `thread`(`room_id`, `last_reply_at`);

-- AddForeignKey
ALTER TABLE `thread` ADD CONSTRAINT `thread_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
