-- Track the outstanding quantity a price adjustment actually applies to.
-- Without it, reports and refunds can only assume one unit per adjustment.
ALTER TABLE "InvoicePriceAdjustment"
  ADD COLUMN IF NOT EXISTS "appliedQuantity" DOUBLE PRECISION NOT NULL DEFAULT 1;
