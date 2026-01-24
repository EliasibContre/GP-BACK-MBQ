/*
  Warnings:

  - You are about to drop the column `invoiceId` on the `Payment` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[code]` on the table `DocumentType` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerId,documentTypeId]` on the table `ProviderDocument` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `code` to the `DocumentType` table without a default value. This is not possible if the table is not empty.
  - Added the required column `purchaseOrderId` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "DepartmentType" AS ENUM ('SIN_ASIGNAR', 'RH', 'FINANZAS', 'COMPRAS', 'TI', 'VENTAS', 'MARKETING', 'OPERACIONES', 'LOGISTICA', 'CALIDAD', 'DIRECCION_GENERAL');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('FISICA', 'MORAL');

-- CreateEnum
CREATE TYPE "AccessRequestKind" AS ENUM ('INTERNAL', 'PROVIDER');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
ALTER TYPE "PurchaseOrderStatus" ADD VALUE 'APPROVED';

-- DropForeignKey
ALTER TABLE "public"."Payment" DROP CONSTRAINT "Payment_invoiceId_fkey";

-- DropIndex
DROP INDEX "public"."Payment_invoiceId_idx";

-- AlterTable
ALTER TABLE "DocumentType" ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "requiredFor" "PersonType"[] DEFAULT ARRAY[]::"PersonType"[];

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "invoiceId",
ADD COLUMN     "purchaseOrderId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "contactPosition" TEXT,
ADD COLUMN     "direccionFiscal" TEXT,
ADD COLUMN     "inactivatedAt" TIMESTAMP(3),
ADD COLUMN     "inactivatedBy" INTEGER,
ADD COLUMN     "inactiveReason" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "observaciones" TEXT,
ADD COLUMN     "personType" "PersonType";

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "invoicePdfUrl" TEXT,
ADD COLUMN     "invoiceStorageKey" TEXT,
ADD COLUMN     "invoiceUploadedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceXmlStorageKey" TEXT,
ADD COLUMN     "invoiceXmlUrl" TEXT,
ADD COLUMN     "obervations" TEXT,
ADD COLUMN     "pdfUrl" TEXT,
ADD COLUMN     "storageKey" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "department" "DepartmentType" NOT NULL DEFAULT 'SIN_ASIGNAR',
ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessRequest" (
    "id" SERIAL NOT NULL,
    "kind" "AccessRequestKind" NOT NULL,
    "personType" "PersonType",
    "fullName" TEXT,
    "companyName" TEXT,
    "department" "DepartmentType",
    "rfc" TEXT,
    "email" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" INTEGER,
    "createdUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "PasswordResetToken_token_idx" ON "PasswordResetToken"("token");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AccessRequest_email_status_idx" ON "AccessRequest"("email", "status");

-- CreateIndex
CREATE INDEX "AccessRequest_status_idx" ON "AccessRequest"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_code_key" ON "DocumentType"("code");

-- CreateIndex
CREATE INDEX "Payment_purchaseOrderId_idx" ON "Payment"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "Provider_isActive_idx" ON "Provider"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderDocument_providerId_documentTypeId_key" ON "ProviderDocument"("providerId", "documentTypeId");

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_inactivatedBy_fkey" FOREIGN KEY ("inactivatedBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequest" ADD CONSTRAINT "AccessRequest_createdUserId_fkey" FOREIGN KEY ("createdUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
