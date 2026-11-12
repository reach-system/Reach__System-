-- ===========================================================================
-- db_recommendations.sql
-- rich_mangment — index, statistics and constraint recommendations
--
-- READ-ONLY AUDIT ARTIFACT. Nothing here has been executed.
--
-- HOW TO APPLY
--   * Test on a restored copy of production first.
--   * Run each statement SEPARATELY, outside a transaction:
--       psql "$DATABASE_URL" -f db_recommendations.sql
--     (CREATE INDEX CONCURRENTLY cannot run inside a transaction block.)
--   * `CREATE INDEX CONCURRENTLY` still takes a short lock at the end; run in a
--     low-traffic window and monitor `pg_stat_progress_create_index`.
--   * Re-run `ANALYZE` afterwards.
--
-- Each block states the query pattern it serves and the expected effect.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
-- Trigram search for Arabic/Latin names. Required for `%term%` ILIKE searches
-- that currently do sequential scans on Customer/Supplier/ProductModel.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Invoice — the 5M-row hot table
-- ---------------------------------------------------------------------------
-- Pattern: GET /invoices?status=...&from=...&to=... ORDER BY date DESC
-- Current schema has separate (status) and (date) indexes; PostgreSQL can use
-- only one of them, so the other predicate becomes a filter over many rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_status_date
  ON "Invoice" ("status", "date" DESC);

-- Pattern: customer statement / customer report (customerId + date range).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_customer_status_date
  ON "Invoice" ("customerId", "status", "date" DESC);

-- Pattern: employee sales report (employeeId + date range + status).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_employee_status_date
  ON "Invoice" ("employeeId", "status", "date" DESC);

-- Pattern: dashboard "pending review" queue and overdue delivery.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_pending_date
  ON "Invoice" ("date" DESC)
  WHERE "status" = 'PENDING_ACCOUNTANT';

-- Pattern: invoice number search / exact lookup already covered by the unique
-- index on invoiceNumber, but leading-wildcard search needs trigram.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_number_trgm
  ON "Invoice" USING gin ("invoiceNumber" gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. InvoiceItem — 12M+ rows, report aggregation
-- ---------------------------------------------------------------------------
-- Pattern: report joins InvoiceItem -> Invoice filtered by date/status.
-- A covering index on (invoiceId) already exists; the planner still has to
-- fetch the heap for productModelId/price. This index makes the join cheaper.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_item_invoice_model
  ON "InvoiceItem" ("invoiceId", "productModelId");

-- Pattern: product sales report grouping by product over a date range. The
-- existing (productModelId) index helps, but the date filter lives on Invoice.
-- A materialized monthly rollup is the real fix (see section 9); this index
-- reduces the join cost in the meantime.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_item_model_created
  ON "InvoiceItem" ("productModelId", "createdAt" DESC);

-- ---------------------------------------------------------------------------
-- 3. Customer / Supplier / ProductModel — Arabic name search
-- ---------------------------------------------------------------------------
-- Pattern: GET /customers?search=... uses `contains` (ILIKE '%...%').
-- Without trigram GIN this is a sequential scan at 100k+ rows.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_name_trgm
  ON "Customer" USING gin ("name" gin_trgm_ops);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_phone_trgm
  ON "Customer" USING gin ("phone" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_supplier_name_trgm
  ON "Supplier" USING gin ("name" gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_model_name_trgm
  ON "ProductModel" USING gin ("name" gin_trgm_ops);

-- Pattern: active-only lists. Partial indexes are smaller and hotter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_customer_active_name
  ON "Customer" ("name")
  WHERE "isActive" = true AND "deletedAt" IS NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_product_model_active_name
  ON "ProductModel" ("name")
  WHERE "isActive" = true AND "deletedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. ProductUnit — barcode scan and availability
-- ---------------------------------------------------------------------------
-- `barcode` is already UNIQUE, which creates a btree index. The extra
-- @@index([barcode]) in schema.prisma is redundant and doubles write cost.
-- After confirming no migration depends on the name, drop the duplicate:
-- DROP INDEX CONCURRENTLY IF EXISTS "ProductUnit_barcode_idx";

-- Pattern: "find an available serialized unit for this model" (delivery scan).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_unit_model_status_barcode
  ON "ProductUnit" ("productModelId", "status", "barcode");

-- ---------------------------------------------------------------------------
-- 5. Stock lots / consumption — FIFO allocation
-- ---------------------------------------------------------------------------
-- Pattern: allocate oldest lot first: WHERE productModelId = ? AND
-- quantityRemaining > 0 ORDER BY receivedDate ASC.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_lot_model_received
  ON "StockLot" ("productModelId", "receivedDate" ASC)
  WHERE "quantityRemaining" > 0;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_stock_consumption_item_lot
  ON "StockConsumption" ("invoiceItemId", "stockLotId");

-- ---------------------------------------------------------------------------
-- 6. Attendance — duplicate check-in prevention
-- ---------------------------------------------------------------------------
-- Pattern: one attendance row per employee per calendar day (Africa/Cairo).
-- The current (employeeId, date) index is not unique and `date` is a timestamp,
-- so concurrent check-ins can create duplicates. This expression index makes
-- the rule enforceable at the database level.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_attendance_employee_day
  ON "Attendance" ("employeeId", ((("date" AT TIME ZONE 'Africa/Cairo'))::date))
  WHERE "checkOut" IS NULL;

-- Pattern: kiosk dashboard "who is currently checked in".
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_attendance_open
  ON "Attendance" ("employeeId", "checkIn" DESC)
  WHERE "checkOut" IS NULL;

-- ---------------------------------------------------------------------------
-- 7. Audit / notifications
-- ---------------------------------------------------------------------------
-- Pattern: global audit history ORDER BY timestamp DESC LIMIT 50. Existing
-- indexes are (entityType, entityId, timestamp) and (employeeId, timestamp),
-- neither of which supports a global sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_system_audit_timestamp
  ON "SystemAuditLog" ("timestamp" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoice_audit_timestamp
  ON "InvoiceAuditLog" ("timestamp" DESC);

-- Pattern: unread badge count per employee.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notification_unread
  ON "Notification" ("employeeId", "createdAt" DESC)
  WHERE "isRead" = false;

-- Pattern: dedupe lookup. `dedupeKey` already has a non-unique index and a
-- unique (employeeId, dedupeKey) constraint; the standalone index is redundant.
-- DROP INDEX CONCURRENTLY IF EXISTS "Notification_dedupeKey_idx";

-- ---------------------------------------------------------------------------
-- 8. Expenses / debts / change requests
-- ---------------------------------------------------------------------------
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_expense_active_date
  ON "Expense" ("date" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_debt_movement_customer_created
  ON "CustomerDebtMovement" ("customerId", "createdAt" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_change_request_pending
  ON "InvoiceChangeRequest" ("createdAt" DESC)
  WHERE "status" = 'PENDING';

-- ---------------------------------------------------------------------------
-- 9. Statistics & autovacuum for hot tables
-- ---------------------------------------------------------------------------
-- Larger statistics targets improve plans on skewed status/date distributions.
ALTER TABLE "Invoice"       ALTER COLUMN "status" SET STATISTICS 500;
ALTER TABLE "Invoice"       ALTER COLUMN "customerId" SET STATISTICS 500;
ALTER TABLE "InvoiceItem"   ALTER COLUMN "productModelId" SET STATISTICS 500;
ALTER TABLE "Customer"      ALTER COLUMN "name" SET STATISTICS 500;

-- Aggressive autovacuum on the append-heavy tables to keep visibility maps
-- healthy and index-only scans effective.
ALTER TABLE "Invoice"        SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "InvoiceItem"    SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "InvoiceAuditLog" SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.01);
ALTER TABLE "Notification"   SET (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.02);

-- ---------------------------------------------------------------------------
-- 10. Correctness constraints (add after cleaning existing violations)
-- ---------------------------------------------------------------------------
-- Verify first:
--   SELECT count(*) FROM "InvoiceItem" WHERE quantity <= 0;
--   SELECT count(*) FROM "StockLot" WHERE "quantityReceived" < 0;
-- Then add:
-- ALTER TABLE "InvoiceItem" ADD CONSTRAINT chk_invoice_item_qty_positive CHECK (quantity > 0);
-- ALTER TABLE "StockLot"    ADD CONSTRAINT chk_stock_lot_received_nonneg CHECK ("quantityReceived" >= 0);
-- ALTER TABLE "StockLot"    ADD CONSTRAINT chk_stock_lot_remaining_nonneg CHECK ("quantityRemaining" >= 0);
-- ALTER TABLE "Invoice"     ADD CONSTRAINT chk_invoice_total_nonneg CHECK ("originalTotal" >= 0 AND "currentTotal" >= 0);

-- ---------------------------------------------------------------------------
-- 11. Partitioning (strategic, not a single-statement change)
-- ---------------------------------------------------------------------------
-- At 5M+ invoices and 12M+ items, consider declarative monthly partitioning:
--   Invoice        PARTITION BY RANGE ("date")
--   InvoiceItem    PARTITION BY RANGE ("createdAt")  (or inherit invoice date)
--   InvoiceAuditLog PARTITION BY RANGE ("timestamp")
-- This requires a table rewrite and application changes (Prisma does not model
-- partitions). Do it only after the query/index fixes above are measured.
-- Keep 36 monthly partitions + a DEFAULT partition; automate with pg_partman.

-- ---------------------------------------------------------------------------
-- 12. Verification queries
-- ---------------------------------------------------------------------------
-- Confirm an index is used:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT * FROM "Invoice"
--   WHERE "status" = 'CONFIRMED' AND "date" >= now() - interval '30 days'
--   ORDER BY "date" DESC LIMIT 50;
--
-- Confirm trigram search:
--   EXPLAIN (ANALYZE, BUFFERS)
--   SELECT id, name FROM "Customer" WHERE name ILIKE '%أحمد%' LIMIT 50;
--
-- Confirm duplicate barcode index is gone:
--   SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'ProductUnit';
