-- CreateTable
CREATE TABLE "PurchaseOrderInvoice" (
    "id" SERIAL NOT NULL,
    "purchaseOrderId" INTEGER NOT NULL,
    "pdfUrl" TEXT,
    "pdfStorageKey" TEXT,
    "xmlUrl" TEXT,
    "xmlStorageKey" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseOrderInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseOrderInvoice_purchaseOrderId_idx" ON "PurchaseOrderInvoice"("purchaseOrderId");

-- AddForeignKey
ALTER TABLE "PurchaseOrderInvoice" ADD CONSTRAINT "PurchaseOrderInvoice_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
