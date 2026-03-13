-- CreateTable
CREATE TABLE `payment_transaction` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `stripe_session_id` VARCHAR(191) NOT NULL,
    `stripe_payment_intent_id` VARCHAR(191) NULL,
    `amount_usd` INTEGER NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'usd',
    `status` VARCHAR(191) NOT NULL,
    `pack_id` VARCHAR(191) NULL,
    `credits_granted` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_transaction_stripe_session_id_key`(`stripe_session_id`),
    INDEX `payment_transaction_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `payment_transaction_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `payment_transaction` ADD CONSTRAINT `payment_transaction_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
