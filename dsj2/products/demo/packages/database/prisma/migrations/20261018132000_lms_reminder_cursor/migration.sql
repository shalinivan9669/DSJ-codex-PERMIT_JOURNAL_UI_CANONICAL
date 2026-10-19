ALTER TABLE "LmsNotificationCheckpoint" ADD COLUMN "renewalCursor" TEXT NOT NULL DEFAULT '', ADD COLUMN "renewalScannedAt" TIMESTAMP(3);
