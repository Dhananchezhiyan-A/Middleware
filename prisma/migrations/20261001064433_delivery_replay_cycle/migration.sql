-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "cycleStartAttempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "replayCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DeliveryAttempt" ADD COLUMN     "replayCycle" INTEGER NOT NULL DEFAULT 0;
