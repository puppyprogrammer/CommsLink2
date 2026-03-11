-- AlterTable
ALTER TABLE `room` ADD COLUMN `cmd_think_enabled` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `room` ADD COLUMN `cmd_effort_enabled` BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE `room` ADD COLUMN `cmd_audit_enabled` BOOLEAN NOT NULL DEFAULT true;
