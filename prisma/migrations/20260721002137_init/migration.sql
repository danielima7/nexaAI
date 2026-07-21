-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationLog" (
    "id" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "result" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_contact_createdAt_idx" ON "Message"("contact", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_contact_createdAt_idx" ON "OperationLog"("contact", "createdAt");

-- CreateIndex
CREATE INDEX "OperationLog_tool_createdAt_idx" ON "OperationLog"("tool", "createdAt");
