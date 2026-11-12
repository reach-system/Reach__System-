-- CreateEnum
CREATE TYPE "ProductLastPriceSource" AS ENUM ('INVOICE', 'MANUAL');

-- CreateTable
CREATE TABLE "ProductLastPrice" (
    "id" SERIAL NOT NULL,
    "productModelId" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "source" "ProductLastPriceSource" NOT NULL DEFAULT 'MANUAL',
    "sourceInvoiceId" INTEGER,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "updatedByEmployeeId" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductLastPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductLastPrice_productModelId_key" ON "ProductLastPrice"("productModelId");
CREATE INDEX "ProductLastPrice_sourceInvoiceId_idx" ON "ProductLastPrice"("sourceInvoiceId");
CREATE INDEX "ProductLastPrice_effectiveAt_idx" ON "ProductLastPrice"("effectiveAt");

-- AddForeignKey
ALTER TABLE "ProductLastPrice" ADD CONSTRAINT "ProductLastPrice_productModelId_fkey" FOREIGN KEY ("productModelId") REFERENCES "ProductModel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductLastPrice" ADD CONSTRAINT "ProductLastPrice_sourceInvoiceId_fkey" FOREIGN KEY ("sourceInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProductLastPrice" ADD CONSTRAINT "ProductLastPrice_updatedByEmployeeId_fkey" FOREIGN KEY ("updatedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
