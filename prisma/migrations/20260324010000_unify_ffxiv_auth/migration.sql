-- Add last_free_credit_at to user table
ALTER TABLE `user` ADD COLUMN `last_free_credit_at` DATETIME(3) NULL;

-- Change default credit_balance for new users to 1000
ALTER TABLE `user` MODIFY COLUMN `credit_balance` INTEGER NOT NULL DEFAULT 1000;

-- Create ffxiv_profile table
CREATE TABLE `ffxiv_profile` (
  `id` VARCHAR(191) NOT NULL,
  `user_id` VARCHAR(191) NOT NULL,
  `content_id` VARCHAR(191) NULL,
  `char_name` VARCHAR(191) NULL,
  `voice_id` VARCHAR(191) NOT NULL DEFAULT 'Joanna',
  `registration_ip` VARCHAR(45) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `ffxiv_profile_user_id_key`(`user_id`),
  INDEX `ffxiv_profile_user_id_idx`(`user_id`),
  INDEX `ffxiv_profile_content_id_idx`(`content_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `ffxiv_profile` ADD CONSTRAINT `ffxiv_profile_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing ffxiv_user data:
-- For each ffxiv_user, create a user row (if username doesn't exist) then link ffxiv_profile
-- Step 1: Create user rows for ffxiv_users whose username doesn't already exist in user table
INSERT INTO `user` (`id`, `username`, `password_hash`, `credit_balance`, `last_free_credit_at`, `created_at`, `updated_at`)
SELECT fu.`id`, fu.`username`, fu.`password_hash`, fu.`credit_balance`, fu.`last_free_credit_at`, fu.`created_at`, fu.`updated_at`
FROM `ffxiv_user` fu
WHERE NOT EXISTS (SELECT 1 FROM `user` u WHERE u.`username` = fu.`username`);

-- Step 2: Create ffxiv_profile rows for all ffxiv_users
-- For users created in step 1, user_id = ffxiv_user.id (same UUID)
-- For users that already existed, user_id = existing user.id
INSERT INTO `ffxiv_profile` (`id`, `user_id`, `content_id`, `char_name`, `voice_id`, `registration_ip`, `created_at`, `updated_at`)
SELECT
  UUID() as `id`,
  COALESCE(
    (SELECT u.`id` FROM `user` u WHERE u.`username` = fu.`username` AND u.`id` != fu.`id` LIMIT 1),
    fu.`id`
  ) as `user_id`,
  fu.`content_id`,
  fu.`char_name`,
  fu.`voice_id`,
  fu.`registration_ip`,
  fu.`created_at`,
  fu.`updated_at`
FROM `ffxiv_user` fu;

-- For existing users that matched, add the ffxiv credit balance to their existing balance
UPDATE `user` u
INNER JOIN `ffxiv_user` fu ON u.`username` = fu.`username` AND u.`id` != fu.`id`
SET u.`credit_balance` = u.`credit_balance` + fu.`credit_balance`;

-- Drop old table
DROP TABLE `ffxiv_user`;
