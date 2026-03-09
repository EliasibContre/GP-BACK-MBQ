-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'SUBMITTED';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "invoiceErrorsJson" JSONB,
ADD COLUMN     "rejectionType" TEXT;
