-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('PDF', 'XML', 'OTHER');

-- CreateTable
CREATE TABLE "PaymentEvidence" (
    "id" TEXT NOT NULL,
    "paymentId" INTEGER NOT NULL,
    "uploadedById" INTEGER,
    "kind" "EvidenceKind" NOT NULL,
    "bucket" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "sha256" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentEvidence_paymentId_idx" ON "PaymentEvidence"("paymentId");

-- CreateIndex
CREATE INDEX "PaymentEvidence_paymentId_kind_idx" ON "PaymentEvidence"("paymentId", "kind");

-- AddForeignKey
ALTER TABLE "PaymentEvidence" ADD CONSTRAINT "PaymentEvidence_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
