-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hour" INTEGER NOT NULL DEFAULT 8,
    "minute" INTEGER NOT NULL DEFAULT 0,
    "focus" TEXT,
    "lastSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportSchedule_organizationId_key" ON "ReportSchedule"("organizationId");
