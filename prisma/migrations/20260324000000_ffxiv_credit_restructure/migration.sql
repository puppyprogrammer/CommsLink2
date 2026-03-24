-- AlterTable: add IP tracking and monthly free credit fields
ALTER TABLE `ffxiv_user` ADD COLUMN `registration_ip` VARCHAR(45) NULL;
ALTER TABLE `ffxiv_user` ADD COLUMN `last_free_credit_at` DATETIME(3) NULL;
ALTER TABLE `ffxiv_user` MODIFY COLUMN `credit_balance` INTEGER NOT NULL DEFAULT 10000;

-- Update existing users to 10000 credits if they have the old default (500)
UPDATE `ffxiv_user` SET `credit_balance` = 10000 WHERE `credit_balance` = 500;
