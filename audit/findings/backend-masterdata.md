# Findings — Backend Master Data (Customers, Suppliers, Employees, Settings, Expenses, Categories, Workplaces)

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `backend/src/customers/customers.controller.spec.ts` | 17 | complete |
| `backend/src/customers/customers.controller.ts` | 60 | complete |
| `backend/src/customers/customers.module.ts` | 10 | complete |
| `backend/src/customers/customers.service.ts` | 66 | complete |
| `backend/src/customers/dto/create-customer.dto.ts` | 22 | complete |
| `backend/src/customers/dto/update-customer.dto.ts` | 23 | complete |
| `backend/src/suppliers/suppliers.controller.ts` | 65 | complete |
| `backend/src/suppliers/suppliers.module.ts` | 10 | complete |
| `backend/src/suppliers/suppliers.service.ts` | 115 | complete |
| `backend/src/suppliers/dto/create-supplier.dto.ts` | 23 | complete |
| `backend/src/suppliers/dto/update-supplier.dto.ts` | 28 | complete |
| `backend/src/employees/employees.controller.ts` | 73 | complete |
| `backend/src/employees/employees.module.ts` | 10 | complete |
| `backend/src/employees/employees.service.ts` | 225 | complete |
| `backend/src/employees/dto/create-employee.dto.ts` | 35 | complete |
| `backend/src/employees/dto/reset-password.dto.ts` | 11 | complete |
| `backend/src/employees/dto/update-employee.dto.ts` | 34 | complete |
| `backend/src/settings/settings.controller.ts` | 116 | complete |
| `backend/src/settings/settings.module.ts` | 12 | complete |
| `backend/src/settings/settings.service.ts` | 104 | complete |
| `backend/src/settings/uploads.util.ts` | 29 | complete |
| `backend/src/settings/dto/update-settings.dto.ts` | 47 | complete |
| `backend/src/expenses/expenses.controller.ts` | 70 | complete |
| `backend/src/expenses/expenses.module.ts` | 12 | complete |
| `backend/src/expenses/expenses.service.ts` | 182 | complete |
| `backend/src/expenses/dto/expense.dto.ts` | 58 | complete |
| `backend/src/expense-categories/expense-categories.controller.ts` | 51 | complete |
| `backend/src/expense-categories/expense-categories.module.ts` | 10 | complete |
| `backend/src/expense-categories/expense-categories.service.ts` | 59 | complete |
| `backend/src/expense-categories/dto/expense-category.dto.ts` | 20 | complete |
| `backend/src/categories/categories.controller.ts` | 51 | complete |
| `backend/src/categories/categories.module.ts` | 10 | complete |
| `backend/src/categories/categories.service.ts` | 68 | complete |
| `backend/src/categories/dto/create-category.dto.ts` | 11 | complete |
| `backend/src/categories/dto/update-category.dto.ts` | 11 | complete |
| `backend/src/workplaces/workplaces.controller.ts` | 47 | complete |
| `backend/src/workplaces/workplaces.module.ts` | 12 | complete |
| `backend/src/workplaces/workplaces.service.ts` | 99 | complete |
| `backend/src/workplaces/dto/workplace.dto.ts` | 73 | complete |
| `backend/prisma/schema.prisma` | 730 | complete |
| `backend/prisma/seed.ts` | 570 | complete |
| `backend/prisma/migrations/migration_lock.toml` | 3 | complete |
| `backend/prisma/migrations/20260915231159_init/migration.sql` | 613 | complete |
| `backend/prisma/migrations/20260918000000_add_expense_soft_delete/migration.sql` | 5 | complete |
| `backend/prisma/migrations/20260918100000_fix_invoice_status_enum/migration.sql` | 28 | complete |
| `backend/prisma/migrations/20260920000000_v25_migration/migration.sql` | 89 | complete |
| `backend/prisma/migrations/20260920000001_v25_add_change_request_item_fields/migration.sql` | 6 | complete |
| `backend/prisma/migrations/20260920120000_add_invoice_item_cogs_status/migration.sql` | 12 | complete |
| `backend/prisma/migrations/20260921000000_add_invoice_discounts/migration.sql` | 3 | complete |
| `backend/prisma/migrations/20260921100000_create_stock_lot_supplier/migration.sql` | 83 | complete |
| `backend/prisma/migrations/20260921120000_create_stock_adjustment/migration.sql` | 64 | complete |
| `backend/prisma/migrations/20260922000000_attendance_kiosk_workplace/migration.sql` | 61 | complete |
| `backend/prisma/migrations/20260923000000_notification_details/migration.sql` | 10 | complete |
| `backend/prisma/migrations/20260923200000_adjustment_review/migration.sql` | 19 | complete |
| `backend/prisma/migrations/20260924000000_reconcile_enums/migration.sql` | 57 | complete |
| `backend/prisma/migrations/20260924000001_reconcile_tables_columns/migration.sql` | 119 | complete |
| `backend/prisma/migrations/20260924000002_reconcile_indexes_nullability/migration.sql` | 66 | complete |
| `backend/prisma/migrations/20260924000003_business_rule_constraints/migration.sql` | 62 | complete |
| `backend/prisma/migrations/20260927000000_invoice_return_item_quantity/migration.sql` | 4 | complete |
| `backend/prisma/migrations/20260927100000_add_pending_change_request_unique_index/migration.sql` | 5 | complete |
| `backend/prisma/migrations/20260930135133_add_unit_of_measure_decimal_quantities/migration.sql` | 31 | complete |
| `backend/prisma/migrations/20261013000000_customer_debt_ledger/migration.sql` | 31 | complete |
| `backend/prisma/migrations/20261013120311_add_invoice_note/migration.sql` | 2 | complete |
| `backend/prisma/migration.sql` | 194 | complete |
| `backend/prisma/constraints.sql` | 148 | complete |
| `backend/prisma/add_role.sql` | 1 | complete |
| `backend/prisma/legacy/README.md` | 56 | complete |
| `backend/package.json` | 58 | complete |
| `backend/.env` | 13 | complete |
| `backend/.gitignore` | 8 | complete |
| `backend/nest-cli.json` | 8 | complete |
| `backend/tsconfig.json` | 24 | complete |
| `backend/tsconfig.build.json` | 4 | complete |

---

## BM-01 — `prisma db seed` unconditionally deletes every business table, including 5M invoices and audit history

- **Severity:** S1
- **Location:** `backend/prisma/seed.ts:161-208` (invoked at `:394`)
- **Evidence:**
  ```ts
  async function cleanDatabase() {
    await prisma.$transaction([
      prisma.stockConsumption.deleteMany(),
      prisma.stockAdjustment.deleteMany(),
  ```
  ```ts
    console.log('  • Cleaning existing database');

    await cleanDatabase();
  ```
- **Root cause:** `cleanDatabase()` runs a 30-statement `deleteMany` chain over every table (`:162-207`) and `main()` calls it unconditionally before seeding. There is no `NODE_ENV`, database-name, row-count, or `ALLOW_SEED_RESET` guard. `package.json:15` exposes it as `prisma:seed`, and `package.json:20-22` registers it as the Prisma seed, so `prisma db seed` and `prisma migrate reset` both wipe the target database.
- **Impact at scale:** One accidental invocation against production deletes all 5M+ invoices, invoice items, stock lots, consumptions, audit logs, debt movements and expenses, then recreates only the stocktake catalog and five known accounts. The array transaction also holds locks on every table for the duration, so the wipe is slow and blocks all traffic before it succeeds.
- **Reproduction:** Against a populated clone, run `cd backend && npx prisma db seed`; observe `Cleaning existing database` and `DELETE FROM "Invoice"` in the query log, then `SELECT count(*) FROM "Invoice"` → 0. `npx prisma migrate reset --skip-seed` is safe; without `--skip-seed` the same wipe runs.
- **Fix:** Make reset opt-in: require `ALLOW_SEED_RESET=1` **and** `NODE_ENV !== 'production'`, and refuse if `prisma.invoice.count() > 0` unless a second explicit flag is set. Split into `seed:reference` (idempotent upserts only) and `seed:demo` (destructive, dev-only). Never wire the destructive path into `prisma.seed`; point `package.json` at the idempotent seed.
- **Verification:** With `NODE_ENV=production` or `ALLOW_SEED_RESET` unset, the seed exits non-zero before issuing any `DELETE`; `SELECT count(*) FROM "Invoice"` is unchanged. `prisma migrate reset` on a populated DB aborts with a clear message.
- **Status:** - [ ] Fixed

---

## BM-02 — Seed creates and prints five accounts with hardcoded passwords, including a permanent `admin/admin123`

- **Severity:** S1
- **Location:** `backend/prisma/seed.ts:233-238` (credentials printed at `:485-489`)
- **Evidence:**
  ```ts
    const admin = await create(
      'System Admin',
      'admin',
      'admin123',
      Role.ADMIN,
    );
  ```
  ```ts
    console.log('admin      / admin123');
    console.log('accountant / accountant123');
    console.log('sales      / sales123');
    console.log('inventory  / inventory123');
    console.log('kiosk1     / kiosk123');
  ```
- **Root cause:** Passwords are literals in source, hashed with argon2 at seed time, and written to stdout. There is no `mustChangePassword` field in `Employee` (`schema.prisma:581-620`), no first-login rotation, and no environment override. Anyone who has read the repository (or the seed log) knows the production admin credential if this seed is ever run in a deployed environment.
- **Impact at scale:** A single seeded deployment exposes full ADMIN access (employees, expenses, invoices, settings) with a password published in the repo. Because the seed is the only documented bootstrap path, operators are likely to run it. Rotating the password later does not remove the known-credential window or the other four accounts.
- **Reproduction:** `cd backend && npx prisma db seed`, then `POST /api/auth/login` with `{"username":"admin","password":"admin123"}` → 200 and an ADMIN access token. `git grep -n "admin123"` returns the seed and the log lines.
- **Fix:** Remove literal passwords. Read `SEED_ADMIN_PASSWORD` (and per-role passwords) from env, fail if absent in non-dev, or generate a random password and print it once. Add `mustChangePassword Boolean @default(true)` and force rotation on first login. Do not create ACCOUNTANT/SALES/INVENTORY/KIOSK demo users in production seeds at all.
- **Verification:** Seed with no env password in `NODE_ENV=production` exits non-zero; in dev it generates a random password and the login with `admin123` returns 401. `git grep "admin123"` returns no source hits.
- **Status:** - [ ] Fixed

---

## BM-03 — Arabic name/phone search is `ILIKE '%term%'` with no trigram index; every search is a sequential scan

- **Severity:** S2
- **Location:** `backend/src/customers/customers.service.ts:13-19` (indexes at `backend/prisma/schema.prisma:325-327`)
- **Evidence:**
  ```ts
      const where: any = { deletedAt: null };
      if (search) {
        where.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
        ];
      }
  ```
  ```prisma
    @@index([name])
    @@index([phone])
    @@index([isActive])
  ```
- **Root cause:** Prisma compiles `contains` + `mode: 'insensitive'` to `ILIKE '%term%'`. A leading wildcard cannot use the B-tree `Customer_name_idx` or `Customer_phone_idx`, and no migration in `backend/prisma/migrations/` enables `pg_trgm` or creates a GIN index (verified: no `trgm`/`GIN` anywhere). The same pattern exists for supplier name (`suppliers.service.ts:38`), employee name/username (`employees.service.ts:38-39`), product-model name (`product-models.service.ts:23`) and invoice number (`invoices.service.ts:956`).
- **Impact at scale:** With 100k customers (and 5M invoices for the invoice-number variant), each keystroke in the search box scans and sorts the whole table. The `ORDER BY name LIMIT 20` adds a full sort because the index cannot supply the filtered order. At 100k rows this is tens to hundreds of milliseconds per request; with concurrent cashiers it saturates the DB. Arabic text is not the problem — the missing trigram index is.
- **Reproduction:** On a 100k-row `Customer` table run `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "Customer" WHERE "name" ILIKE '%احمد%' AND "deletedAt" IS NULL ORDER BY "name" ASC LIMIT 20;` → `Seq Scan on "Customer"` + `Sort`. Compare with `WHERE "name" = '...'`, which uses the index.
- **Fix:** `CREATE EXTENSION IF NOT EXISTS pg_trgm;` then `CREATE INDEX "Customer_name_trgm_idx" ON "Customer" USING GIN ("name" gin_trgm_ops);`, and the same for `Supplier(name)`, `Employee(name)`, `Employee(username)`, `Customer(phone)` and `Invoice(invoiceNumber)`. Keep the existing B-trees for equality/order. If the search term is a prefix, `startsWith` with `text_pattern_ops` is cheaper; keep `contains` only for fuzzy search.
- **Verification:** Re-run `EXPLAIN` → `Bitmap Index Scan on "Customer_name_trgm_idx"`; p95 for `GET /api/customers?search=...` stays flat as the table grows from 10k to 100k rows. `SELECT indexname FROM pg_indexes WHERE indexdef ILIKE '%gin_trgm_ops%'` lists the new indexes.
- **Status:** - [ ] Fixed

---

## BM-04 — Customer/supplier/employee/expense list endpoints accept an unbounded `limit` (whole-table responses)

- **Severity:** S2
- **Location:** `backend/src/customers/customers.service.ts:9-10` (used at `:25-26`)
- **Evidence:**
  ```ts
      const page = Number(params?.page) > 0 ? Number(params?.page) : 1;
      const limit = Number(params?.limit) > 0 ? Number(params?.limit) : 20;
  ```
  ```ts
      const [items, total] = await Promise.all([
        this.prisma.customer.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
  ```
- **Root cause:** Only `> 0` is validated; there is no upper bound and no integer check. `?limit=100000` becomes `take: 100000`, and `?page=999999999` produces a `skip` beyond Prisma's 32-bit `Int` range. The same absence of a cap exists in `suppliers.service.ts:32-33,50-51`, `employees.service.ts:29-30,58-59` and `expenses.service.ts:94-95,112-113`. `customer-debts.service.ts:12-14` already implements the correct pattern (`Math.min(Number(limit), 100)`), so this is an inconsistency, not a design choice.
- **Impact at scale:** A single `GET /api/customers?limit=100000` loads 100k rows plus a `count(*)` into Node, serializes tens of MB of JSON, and blocks the event loop; a few concurrent calls exhaust memory. The endpoint is reachable by SALES/ADMIN, so a normal client bug (or malicious request) can take the API down. Large `skip` values also produce deep-offset scans.
- **Reproduction:** Seed 100k customers, call `GET /api/customers?limit=100000` and measure response size/latency and `process.memoryUsage().heapUsed`. Call `GET /api/customers?page=2147483647&limit=100` → Prisma `P2023`/validation error (500). Repeat for `/api/suppliers`, `/api/employees`, `/api/expenses`.
- **Fix:** Centralize pagination: `page = max(1, int(page) || 1)`, `limit = min(max(1, int(limit) || 20), 100)`; reject `page > 1_000_000`. Apply in all four services, or add a shared `PaginationDto` with `@Type(() => Number)`, `@IsInt()`, `@Min(1)`, `@Max(100)`. For exports use a streaming/cursor endpoint instead of raising the cap.
- **Verification:** `?limit=100000` returns at most 100 rows and `meta.limit === 100`; `?limit=abc` returns 400; `?page=2147483647` returns 400, not 500. A load test with 50 concurrent max-size requests keeps heap below the configured limit.
- **Status:** - [ ] Fixed

---

## BM-05 — Inventory quantities are IEEE-754 `Float`; decimal-meter stock and reservations drift

- **Severity:** S2
- **Location:** `backend/prisma/schema.prisma:168-169` (also `:257-259`, `:278`, `:296`, `:391`, `:451`, `:493`)
- **Evidence:**
  ```prisma
    reservedQuantity Float     @default(0)
    minStockAlert Float        @default(0)
  ```
  ```prisma
    quantityReceived  Float
    quantityRemaining Float
    quantityReserved  Float           @default(0)
  ```
- **Root cause:** All quantity columns are `Float` (PostgreSQL `DOUBLE PRECISION`), while money is correctly `Decimal(18,2)`. The catalog explicitly supports `UnitOfMeasure.METER` (`schema.prisma:144-147`, `:167`) and the seed sells cable by the meter (`seed.ts:126-131`), so fractional quantities are a first-class flow. Binary floating point cannot represent `0.1`, `0.2` or `0.3` exactly; repeated `increment`/`decrement` of `reservedQuantity`, `quantityRemaining` and `quantityReserved` accumulates error.
- **Impact at scale:** With 5M invoices and millions of stock movements, `quantityRemaining` can end at `1.9999999999999998` instead of `2`, or `-1.4210854715202004e-14` instead of `0`. Availability checks (`remaining >= requested`) then reject valid sales or allow overselling; COGS/report sums diverge from the physical stocktake. The error is silent and irreversible once written.
- **Reproduction:** In a transaction, increment a `StockLot.quantityRemaining` by `0.1` ten times and decrement by `1`; `SELECT "quantityRemaining"` → `-1.1102230246251565e-16`, not 0. Do the same through `POST /api/stock-adjustments` with `quantity: 0.1` and approve; the lot shows a non-zero residue.
- **Fix:** Change quantity columns to `Decimal(18,3)` (or `NUMERIC(18,3)`), including `ProductModel.reservedQuantity/minStockAlert`, `StockLot.quantityReceived/Remaining/Reserved`, `StockConsumption.quantity`, `StockAdjustment.quantity`, `InvoiceItem.quantity`, `InvoiceReturnItem.quantity`, `InvoiceChangeRequestItem.quantity`. Migrate with `ALTER COLUMN ... TYPE DECIMAL(18,3) USING round(col::numeric, 3)`. Use Prisma `Decimal`/`decimal.js` in services; never `Number()` a quantity.
- **Verification:** The 0.1×10 test returns exactly `0.000`; a reconciliation query `SELECT count(*) FROM "StockLot" WHERE "quantityRemaining" < 0 OR "quantityReserved" < 0` returns 0 after a full invoice/return/adjustment cycle. `information_schema.columns.data_type` shows `numeric` for all quantity columns.
- **Status:** - [ ] Fixed

---

## BM-06 — Deactivating a customer with outstanding debt hides the receivable from the debt ledger

- **Severity:** S2
- **Location:** `backend/src/customers/customers.service.ts:59-65` (debt column at `backend/prisma/schema.prisma:320`)
- **Evidence:**
  ```ts
    async deactivate(id: number) {
      await this.findOne(id);
      return this.prisma.customer.update({
        where: { id },
        data: { isActive: false, deletedAt: new Date() },
      });
    }
  ```
  ```prisma
    currentDebt             Decimal               @default(0) @db.Decimal(18, 2)
  ```
- **Root cause:** `deactivate` soft-deletes the customer without checking `currentDebt` or open invoices. Every debt query filters `deletedAt: null` (`customer-debts.service.ts:16`), so the customer and their balance disappear from the debt dashboard while `Customer.currentDebt` and the unpaid invoices remain in the database. There is no `restore` endpoint and `UpdateCustomerDto` has no `isActive`/`deletedAt`, so the account cannot be brought back through the API.
- **Impact at scale:** A sales user deactivating a customer with an unpaid balance removes that receivable from collections without recording a write-off. At 100k customers even a small fraction of such deactivations creates an unreconcilable AR ledger; month-end totals no longer match `SUM(Invoice.currentTotal)`.
- **Reproduction:** Create a customer, add a debt movement (`POST /api/customer-debts/...`) so `currentDebt > 0`, then `DELETE /api/customers/:id`. `GET /api/customer-debts` no longer lists the customer, but `SELECT "currentDebt" FROM "Customer" WHERE id = ...` still returns the balance.
- **Fix:** In a transaction, reject deactivation when `currentDebt <> 0` or when the customer has invoices in a non-settled status, with a 409 listing the balance. Alternatively keep the customer visible in debt/AR queries by filtering on `isActive` rather than `deletedAt`, and add an explicit `restore` that clears both flags. Record a `SystemAuditLog` entry for deactivation.
- **Verification:** `DELETE /api/customers/:id` on a customer with `currentDebt = 100` returns 409 and leaves `deletedAt` NULL; after settling to 0 the same call succeeds. The AR report total is unchanged by deactivation.
- **Status:** - [ ] Fixed

---

## BM-07 — Reconciliation migrations add `NOT NULL` columns without backfill; `migrate deploy` fails on any populated database

- **Severity:** S2
- **Location:** `backend/prisma/migrations/20260924000001_reconcile_tables_columns/migration.sql:102-105` (also `20260924000002_reconcile_indexes_nullability/migration.sql:20`)
- **Evidence:**
  ```sql
  ALTER TABLE "StockReceipt" ADD COLUMN IF NOT EXISTS "supplierId" INTEGER;
  ALTER TABLE "StockReceipt" ADD COLUMN IF NOT EXISTS "pricedByEmployeeId" INTEGER;
  ALTER TABLE "StockReceipt" ADD COLUMN IF NOT EXISTS "pricedAt" TIMESTAMP(3);
  ALTER TABLE "StockReceipt" ALTER COLUMN "supplierId" SET NOT NULL;
  ```
- **Root cause:** The column is added as nullable with no `DEFAULT` and no `UPDATE`; every existing `StockReceipt` row gets `NULL`, then `SET NOT NULL` immediately fails with `column "supplierId" of relation "StockReceipt" contains null values`. The legacy script did the missing work (`migration.sql:47-57` inserted an "Unknown Supplier" and backfilled), but the official chain dropped it. The comment at `:96-100` assumes only disposable development data, yet any database created by the official `init` migration and then used has receipts. `20260924000002:20` repeats the pattern for `Expense.description` (`SET NOT NULL` on a column that was nullable in `init:283`).
- **Impact at scale:** A production database with 5M invoices certainly has stock receipts; `prisma migrate deploy` aborts at this migration and the release cannot start. Because Prisma wraps the migration in a transaction, the deploy is stuck on the same migration every retry. A forced partial apply leaves the schema inconsistent with `_prisma_migrations`.
- **Reproduction:** Create a DB at `20260915231159_init`, insert one `StockReceipt` row, then run `npx prisma migrate deploy`. Observe `ERROR: column "supplierId" of relation "StockReceipt" contains null values` and a non-zero exit. The same happens for an `Expense` row with `description IS NULL` at the later migration.
- **Fix:** Backfill before tightening: create/ensure a sentinel supplier, `UPDATE "StockReceipt" SET "supplierId" = (SELECT id FROM "Supplier" ORDER BY id LIMIT 1) WHERE "supplierId" IS NULL`, then `SET NOT NULL`; add `ON CONFLICT`/idempotency. For `Expense.description`, `UPDATE ... SET description = '' WHERE description IS NULL` (or keep the column nullable and enforce in the DTO). Prefer `ADD CONSTRAINT ... NOT VALID` + `VALIDATE CONSTRAINT` for large tables.
- **Verification:** On a clone with receipts and NULL descriptions, `prisma migrate deploy` completes and `SELECT count(*) FROM "StockReceipt" WHERE "supplierId" IS NULL` → 0; `prisma migrate status` reports up to date. A fresh empty DB also completes.
- **Status:** - [ ] Fixed

---

## BM-08 — `StockReceiptStatus` enum rebuild casts `FINALIZED` rows into an enum that no longer has that value

- **Severity:** S2
- **Location:** `backend/prisma/migrations/20260924000000_reconcile_enums/migration.sql:38-53` (old default at `20260915231159_init/migration.sql:73`)
- **Evidence:**
  ```sql
  DO $$
  BEGIN
    IF (SELECT array_agg(e.enumlabel::text ORDER BY e.enumlabel)
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'StockReceiptStatus')
       IS DISTINCT FROM ARRAY['CANCELLED', 'PENDING_PRICING', 'PRICED'] THEN

      CREATE TYPE "StockReceiptStatus_new" AS ENUM ('PENDING_PRICING', 'PRICED', 'CANCELLED');
      ALTER TABLE "StockReceipt" ALTER COLUMN "status" DROP DEFAULT;
      ALTER TABLE "StockReceipt" ALTER COLUMN "status" TYPE "StockReceiptStatus_new"
        USING ("status"::text::"StockReceiptStatus_new");
  ```
- **Root cause:** `init` created the type with `FINALIZED` and made it the default (`init:73`), so receipts created before v2.4 legitimately contain `FINALIZED`. The rebuild only checks the enum label set, not the data, and the `USING "status"::text::"StockReceiptStatus_new"` cast has no mapping for `FINALIZED`. PostgreSQL raises `invalid input value for enum "StockReceiptStatus_new": "FINALIZED"` and the migration aborts. The comment claims `FINALIZED` is never referenced, but it was the column default.
- **Impact at scale:** Any database that received stock receipts before the pricing workflow (the exact legacy data this reconciliation is meant to support) cannot upgrade; `migrate deploy` fails and the enum is left renamed/partially rebuilt if not transactional. On a fresh DB the branch is skipped only because the label set already matches, so this is invisible in CI.
- **Reproduction:** On a DB with the `init` enum, `INSERT INTO "StockReceipt" ("employeeId", "status") VALUES (1, 'FINALIZED');` then run the reconcile migration. Observe the invalid-input error. `SELECT DISTINCT status FROM "StockReceipt"` shows `FINALIZED`.
- **Fix:** Map data before the cast: `UPDATE "StockReceipt" SET "status" = 'PRICED' WHERE "status" = 'FINALIZED';` (or `PENDING_PRICING` if unpriced), then rebuild. Add `FINALIZED` to the new enum if historical rows must remain readable, or keep a separate legacy column. Add a migration test that starts from `init` with one receipt of each status.
- **Verification:** Seed one `FINALIZED`, one `PRICED`, one `CANCELLED` receipt, run `migrate deploy`; it succeeds and `SELECT DISTINCT status` returns only the new values. A fresh DB and a v2.4 DB both reach `migrate status` up to date.
- **Status:** - [ ] Fixed

---

## BM-09 — Soft delete is incoherent: `includeInactive` exposes deleted rows and `isActive` can never clear `deletedAt`

- **Severity:** S3
- **Location:** `backend/src/suppliers/suppliers.service.ts:35-40` (update at `:97-100`; same pattern in `categories.service.ts:9-11`, `customers.service.ts:59-65`, `employees.service.ts:165-187`, `workplaces.service.ts:83-97`)
- **Evidence:**
  ```ts
      const where: Prisma.SupplierWhereInput = {
        ...(includeInactive ? {} : { isActive: true, deletedAt: null }),
        ...(search && {
          name: { contains: search, mode: 'insensitive' },
        }),
      };
  ```
  ```ts
      return this.prisma.supplier.update({
        where: { id },
        data,
      });
  ```
- **Root cause:** `includeInactive=true` spreads `{}`, so `deletedAt` is not filtered at all and soft-deleted suppliers appear in the "inactive" list. Meanwhile `UpdateSupplierDto` accepts `isActive` but not `deletedAt`, so setting `isActive: true` leaves `deletedAt` set; `findOne` (`:78-80`) and `findAll` still treat the row as deleted. `categories.service.ts:9-11` has the same `includeInactive ? {}` leak; customers/employees/categories/workplaces have no restore field at all. The model conflates "inactive" and "deleted" in one row.
- **Impact at scale:** Operators cannot reliably reactivate a supplier/category/customer; the UI shows a deleted supplier under "include inactive" but every edit returns 404. Over time the `deletedAt` set grows and "inactive" reports mix archived and disabled records, making master-data counts and dedupe checks wrong.
- **Reproduction:** `DELETE /api/suppliers/:id` then `GET /api/suppliers?includeInactive=true` → the deleted row is returned. `PATCH /api/suppliers/:id {"isActive":true}` → 200, but `GET /api/suppliers/:id` → 404 and the default list omits it. Repeat for `GET /api/categories?includeInactive=true`.
- **Fix:** Always filter `deletedAt: null` in list queries; add a separate admin-only `includeDeleted` flag if archives must be shown. Add `restore` endpoints that set `isActive: true` **and** `deletedAt: null` in one transaction. Or split the concepts into `isActive` (operational) and `archivedAt` (history) and never expose archived rows through normal lists.
- **Verification:** `?includeInactive=true` never returns a row with `deletedAt != null`; `POST /api/suppliers/:id/restore` makes the row visible in the default list and editable; a test asserts `deletedAt` and `isActive` change together.
- **Status:** - [ ] Fixed

---

## BM-10 — Duplicate master-data names are prevented only by check-then-insert, with no unique constraint (race + case sensitivity)

- **Severity:** S3
- **Location:** `backend/src/suppliers/suppliers.service.ts:10-24` (schema at `backend/prisma/schema.prisma:203-217`; same pattern in `workplaces.service.ts:48-66`, `expense-categories.service.ts:25-35`, `categories.service.ts:39-44`)
- **Evidence:**
  ```ts
      const existing = await this.prisma.supplier.findFirst({
        where: { name: data.name, deletedAt: null },
      });

      if (existing) {
        throw new ConflictException({ code: 'SUPPLIER_DUPLICATE', message: 'A supplier with this name already exists' });
      }

      return this.prisma.supplier.create({
  ```
  ```prisma
  model Supplier {
    id        Int           @id @default(autoincrement())
    name      String
  ```
- **Root cause:** The application does `SELECT` then `INSERT` with no transaction, no advisory lock, and no database uniqueness. Two concurrent `POST /api/suppliers` with the same name both pass `findFirst` and both insert. The comparison is case-sensitive and whitespace-sensitive, so `"Acme"`, `"acme"` and `"Acme "` are distinct. `Category` and `ExpenseCategory` have no unique index at all (`schema.prisma:149-159`, `:647-657`); `Customer` has no duplicate check anywhere (`customers.service.ts:50-52`); `Workplace` checks only on create and never on update (`workplaces.service.ts:69-80`). `ProductModel`'s `@@unique([categoryId, name])` is case-sensitive too.
- **Impact at scale:** 100k customers and thousands of quick-add supplier/workplace entries produce duplicates from retries and double-clicks. Duplicate customers split debt and purchase history; duplicate categories split product counts; duplicate suppliers split lots and receipts, breaking supplier-level reporting and payable totals. A retry after a timeout is enough to trigger it.
- **Reproduction:** Fire two concurrent `POST /api/suppliers` with `{"name":"Acme"}`; both return 201 and `SELECT count(*) FROM "Supplier" WHERE name='Acme'` → 2. `POST` `"Acme"` then `"acme"` → both 201. For categories, `POST /api/categories` twice with the same name → both 201.
- **Fix:** Add partial unique indexes on the normalized key, e.g. `CREATE UNIQUE INDEX "Supplier_name_active_unique" ON "Supplier" (lower(btrim(name))) WHERE "deletedAt" IS NULL;` and equivalents for `Category`, `ExpenseCategory`, `Workplace`, and `Customer(lower(name), coalesce(phone,''))`. Catch Prisma `P2002` and return 409. Normalize (`trim`, collapse spaces) before write. Keep the pre-check only for a friendly message.
- **Verification:** Two concurrent POSTs → one 201 and one 409; `SELECT lower(btrim(name)), count(*) ... GROUP BY 1 HAVING count(*) > 1` returns 0 rows. `"Acme"` vs `"acme"` is rejected by the unique index.
- **Status:** - [ ] Fixed

---

## BM-11 — `InvoiceChangeRequestItem.productModelId` has an index but no foreign key; product references can dangle

- **Severity:** S3
- **Location:** `backend/prisma/schema.prisma:492-493` (index at `:500`; FK list in `20260920000001_v25_add_change_request_item_fields/migration.sql:1-6`)
- **Evidence:**
  ```prisma
    productModelId Int?
    quantity      Float?
  ```
  ```prisma
    @@index([productModelId])
  ```
- **Root cause:** Every other relation in the schema declares a `@relation` with `onDelete: Restrict`, but `productModelId` is a bare scalar. The migration adds the column and the index only; no `FOREIGN KEY` is ever created. Deleting a `ProductModel` therefore succeeds even when change-request history references it, and the id becomes a dangling integer.
- **Impact at scale:** Change-request/audit screens join or look up the model by id and silently render a blank line or drop the row. Over years of catalog cleanup, historical change requests become unreadable exactly when they are needed for dispute resolution. Because every other FK is `RESTRICT`, this one hole is easy to miss in integrity checks.
- **Reproduction:** `SELECT conname FROM pg_constraint WHERE conrelid = '"InvoiceChangeRequestItem"'::regclass AND contype = 'f';` → no FK for `productModelId`. Create a change request item with `productModelId = X`, delete `ProductModel X`, and observe the delete succeeds and the item still points at X.
- **Fix:** Add `productModel ProductModel? @relation(fields: [productModelId], references: [id], onDelete: Restrict)` to the model and a migration `ALTER TABLE "InvoiceChangeRequestItem" ADD CONSTRAINT "InvoiceChangeRequestItem_productModelId_fkey" FOREIGN KEY ("productModelId") REFERENCES "ProductModel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;` after cleaning orphans.
- **Verification:** The `pg_constraint` query returns the new FK; deleting a referenced `ProductModel` returns a FK violation (or the app returns 409); deleting an unreferenced model still works.
- **Status:** - [ ] Fixed

---

## BM-12 — `StockLot` and `InvoiceReturnItem` have no non-negative/positive quantity checks; negative stock can be persisted

- **Severity:** S3
- **Location:** `backend/prisma/schema.prisma:257-259` (also `:451`; deliberate omission documented at `20260921100000_create_stock_lot_supplier/migration.sql:13-18`)
- **Evidence:**
  ```prisma
    quantityReceived  Float
    quantityRemaining Float
    quantityReserved  Float           @default(0)
  ```
  ```prisma
    quantity        Float           @default(1)
  ```
- **Root cause:** The official migrations intentionally omit `stock_lot_remaining_le_received` and `stock_lot_reserved_valid` because adjustments can legitimately exceed `quantityReceived` and lower `quantityRemaining` below `quantityReserved` (`20260921100000:13-18`, `legacy/README.md:39-44`). But the minimal invariants that must always hold — `quantityRemaining >= 0`, `quantityReserved >= 0`, `quantityReceived > 0`, and `InvoiceReturnItem.quantity > 0` — are also absent. The application guard for negative remaining is not in this module and is not backed by the DB.
- **Impact at scale:** A race or a missed branch in adjustment/return/confirmation writes a negative remaining or a zero/negative return quantity. The next availability calculation either oversells (because the negative is treated as available) or blocks all sales (because it is treated as exhausted). At 5M invoices the bad row is buried among millions of lots and only surfaces in a stocktake.
- **Reproduction:** `UPDATE "StockLot" SET "quantityRemaining" = -5 WHERE id = 1;` succeeds. `INSERT INTO "InvoiceReturnItem" ("invoiceReturnId","invoiceItemId","refundAmount","quantity") VALUES (1,1,10,0);` succeeds. No CHECK constraint is listed by `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = '"StockLot"'::regclass;`.
- **Fix:** Add `CHECK ("quantityRemaining" >= 0)`, `CHECK ("quantityReserved" >= 0)`, `CHECK ("quantityReceived" > 0)` and `CHECK ("quantity" > 0)` on `InvoiceReturnItem`, using `NOT VALID` then `VALIDATE` after a cleanup query. Keep the signed `StockAdjustment.quantity` (intentionally signed) but make the service reject any adjustment whose resulting lot would go negative. Add `CHECK ("quantity" > 0)` to `InvoiceChangeRequestItem` where non-null.
- **Verification:** The negative `UPDATE`/`INSERT` above fail with `violates check constraint`; a full adjustment/return test suite passes; `SELECT count(*) FROM "StockLot" WHERE "quantityRemaining" < 0 OR "quantityReserved" < 0` → 0.
- **Status:** - [ ] Fixed

---

## BM-13 — Missing FK-support and FIFO/queue composite indexes (customer change requests, price adjustments, stock lots, invoice status)

- **Severity:** S3
- **Location:** `backend/prisma/schema.prisma:466-467` (also `:420-421`, `:469-470`, `:267-269`, `:378-382`)
- **Evidence:**
  ```prisma
    proposedCustomerId    Int?
    proposedCustomer      Customer?                @relation("ProposedCustomer", fields: [proposedCustomerId], references: [id], onDelete: Restrict)
  ```
  ```prisma
    requestId     Int?
    request       InvoiceChangeRequest? @relation(fields: [requestId], references: [id], onDelete: Restrict)
  ```
  ```prisma
    @@index([productModelId])
    @@index([stockReceiptId])
    @@index([supplierId])
  ```
- **Root cause:** Several FK columns have no supporting index: `InvoiceChangeRequest.proposedCustomerId`, `InvoiceChangeRequest.reviewedByAdminId`, and `InvoicePriceAdjustment.requestId`. PostgreSQL does not auto-index FK referencing columns, so deleting/updating a customer, employee or change request scans the whole child table. Separately, `StockLot` has only `productModelId`, while FIFO consumption filters by `productModelId` and orders by `receivedDate`; `Invoice` has only single-column `status` and `date`, while the accountant queue filters `status` and orders by `date` at 5M rows.
- **Impact at scale:** `DELETE FROM "Customer"` (or a customer merge) scans every change request; with 100k customers and years of change requests this is seconds of lock time. FIFO lot selection sorts many lots per model; the accountant pending queue sorts a large `status` slice. Both grow linearly with history and are on interactive paths.
- **Reproduction:** On a seeded 5M-invoice DB run `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM "Invoice" WHERE "status" = 'PENDING_ACCOUNTANT' ORDER BY "date" DESC LIMIT 25;` → `Seq Scan`/`Sort`, not an index-only scan. Run `EXPLAIN` for `SELECT * FROM "InvoiceChangeRequest" WHERE "proposedCustomerId" = 42;` → `Seq Scan`. Run the FIFO lot query (`WHERE "productModelId" = X AND "quantityRemaining" > 0 ORDER BY "receivedDate"`) → `Sort`.
- **Fix:** Add `CREATE INDEX "InvoiceChangeRequest_proposedCustomerId_idx" ...`, `..._reviewedByAdminId_idx`, `"InvoicePriceAdjustment_requestId_idx"`, `"StockLot_productModelId_receivedDate_idx"` (optionally partial `WHERE "quantityRemaining" > 0`), and `"Invoice_status_date_idx" ON "Invoice"("status","date")`. Use `CREATE INDEX CONCURRENTLY` in a non-transactional migration (or `prisma migrate` with a separate script) to avoid locking 5M rows.
- **Verification:** `EXPLAIN` shows index scans for all four queries; p95 for `GET /api/invoices?status=PENDING_ACCOUNTANT` and FIFO confirmation stays flat as history grows; `pg_indexes` lists the new indexes.
- **Status:** - [ ] Fixed

---

## BM-14 — Unvalidated `page`/`limit`/`role`/`categoryId` query params cause 500s or silently return the wrong dataset

- **Severity:** S3
- **Location:** `backend/src/suppliers/suppliers.service.ts:32-33` (controller `suppliers.controller.ts:34-35`; also `employees.service.ts:29-30`, `expenses.service.ts:94-95`, `expenses.controller.ts:39`)
- **Evidence:**
  ```ts
      const { search, includeInactive = false, page = 1, limit = 25 } = params;
      const skip = (page - 1) * limit;
  ```
  ```ts
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
  ```
- **Root cause:** `parseInt('abc', 10)` is `NaN`; `(NaN - 1) * 25` is `NaN`, and Prisma rejects `skip: NaN` with a validation error (500). The same code exists in employees and expenses. `employees.controller.ts:29` passes `role` straight through without an enum pipe, so `?role=HACK` reaches Prisma as an invalid enum (500). In expenses, `categoryId: categoryId ? Number(categoryId) : undefined` turns `"abc"` into `NaN`; `if (categoryId)` in the service treats `NaN` as falsy and drops the filter, so `GET /api/expenses?categoryId=abc` returns **all** expenses instead of 400. `customers.service.ts:9-10` guards NaN but not the upper bound (see BM-04).
- **Impact at scale:** Any malformed link, monitoring probe, or client typo produces a 500 and pollutes error dashboards; the expenses case is worse — it silently bypasses a tenant/category filter and returns the full ledger to an admin UI. At 5M invoices/expenses the accidental full scan is also expensive.
- **Reproduction:** `GET /api/suppliers?page=abc` → 500. `GET /api/employees?role=HACK` → 500. `GET /api/expenses?categoryId=abc` → 200 with all categories' expenses (compare with a valid `categoryId`). `GET /api/expenses?limit=abc` → 500.
- **Fix:** Use Nest pipes: `@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number`, `@Query('limit', new DefaultValuePipe(25), ParseIntPipe)`, `@Query('role', new ParseEnumPipe(Role, { optional: true }))`, and a positive-int pipe for `categoryId`. Clamp limits (BM-04). For optional params, write a small `OptionalIntPipe` that returns `undefined` for empty and throws `BadRequestException` otherwise.
- **Verification:** All malformed variants above return 400 with a validation code; valid requests return the same payload as before. A contract test enumerates every query param with `abc` and asserts 400, not 500.
- **Status:** - [ ] Fixed

---

## BM-15 — Expense dates are free strings; invalid input becomes a 500 and `endDate` excludes the whole final day

- **Severity:** S3
- **Location:** `backend/src/expenses/expenses.service.ts:80` (DTO at `dto/expense.dto.ts:23-26`; range at `expenses.service.ts:99-103`)
- **Evidence:**
  ```ts
          date: data.date ? new Date(data.date) : new Date(),
  ```
  ```ts
      if (startDate || endDate) {
        where.date = {};
        if (startDate) (where.date as any).gte = new Date(startDate);
        if (endDate) (where.date as any).lte = new Date(endDate);
      }
  ```
- **Root cause:** `CreateExpenseDto.date` and `UpdateExpenseDto.date` are `@IsString()`, not `@IsISO8601()`. `new Date('not-a-date')` yields an `Invalid Date`, which Prisma rejects with `P2023`/`Invalid value for argument` → 500. For a valid date-only `endDate`, `new Date('2026-09-23')` is `2026-09-23T00:00:00Z`; `lte` excludes every expense recorded later that day. The same applies to `startDate` if callers expect local-midnight semantics, and timezone is not normalized.
- **Impact at scale:** Daily/monthly expense reports silently omit the last day (or shift by the server timezone), so totals never reconcile with the bank/cash book. A single bad client date crashes the create/update endpoint. At thousands of expenses per month the off-by-one is systematic, not a rare edge.
- **Reproduction:** `POST /api/expenses {"categoryId":1,"amount":10,"date":"not-a-date","description":"x"}` → 500. Create an expense at `2026-09-23T15:00:00Z`, then `GET /api/expenses?startDate=2026-09-23&endDate=2026-09-23` → 0 rows.
- **Fix:** Use `@IsISO8601({ strict: true })` / `@IsDateString()` on all date fields and reject `Invalid Date` explicitly. For ranges, interpret `endDate` as inclusive end-of-day: `lt: addDays(startOfDay(endDate), 1)` (or `lte: endOfDay(endDate)`), and document whether dates are UTC or `Africa/Cairo`. Apply the same validation to `startDate`/`endDate` query params.
- **Verification:** Invalid date strings return 400; an expense at 15:00 is included by a same-day range; a test at 23:59:59.999 passes. The range query uses `[start 00:00, next day 00:00)` and the count matches a manual day total.
- **Status:** - [ ] Fixed

---

## BM-16 — Employee creation allows 6-character passwords while reset requires 8; no complexity or breach check

- **Severity:** S3
- **Location:** `backend/src/employees/dto/create-employee.dto.ts:20-25` (reset at `dto/reset-password.dto.ts:5-10`)
- **Evidence:**
  ```ts
    @ApiProperty({ example: 'password123' })
    @IsString()
    @IsNotEmpty()
    @MinLength(6)
    @MaxLength(128)
    password: string;
  ```
  ```ts
    @ApiProperty({ minLength: 8 })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    @MaxLength(128)
    newPassword: string;
  ```
- **Root cause:** The create path enforces only 6 characters, the reset path 8, and neither checks complexity, common passwords, username similarity, or breached-password lists. An admin can create `123456` for a cashier and that account has full SALES/INVENTORY access. Argon2 hashing is correct, but hashing a weak password does not make it strong.
- **Impact at scale:** With hundreds of employee accounts, weak/reused passwords are the easiest path to invoice fraud and data exfiltration. The inconsistency also means a password accepted at creation may be rejected at reset, confusing operators and support.
- **Reproduction:** `POST /api/employees {"name":"X","username":"weakuser","password":"123456","role":"SALES"}` → 201; `POST /api/auth/login` with `weakuser/123456` → 200. The same 6-character value is rejected by `PATCH /api/employees/:id/reset-password` (400).
- **Fix:** One shared policy: minimum 12 characters (or 8 + zxcvbn score ≥ 3), reject the top-100k breached passwords, reject username/name substrings, and apply it to create, reset, and self-change. Add a `PasswordPolicyService` used by all three DTOs/services. Keep `MaxLength(128)` to bound argon2 input.
- **Verification:** The create request above returns 400; a 12-character random password succeeds; the same policy tests run against create, reset and change-password. `git grep "MinLength(6)"` returns nothing.
- **Status:** - [ ] Fixed

---

## BM-17 — No guard against deactivating the last active ADMIN (or self), which can lock everyone out

- **Severity:** S3
- **Location:** `backend/src/employees/employees.service.ts:165-187`
- **Evidence:**
  ```ts
    async deactivate(id: number) {
      const employee = await this.prisma.employee.findUnique({ where: { id } });
      if (!employee || employee.deletedAt) {
        throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: 'Employee not found' });
      }

      // Soft delete + revoke refresh tokens immediately
      return this.prisma.employee.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
          refreshToken: null,
        },
  ```
- **Root cause:** The method checks existence but not how many active ADMIN accounts remain. `PATCH /api/employees/:id {"isActive":false}` (`:120-163`) has the same gap. An admin can deactivate the only other admin, then themselves; after that no account can create employees, reset passwords, or change settings. There is no break-glass account or CLI restore path.
- **Impact at scale:** A single misclick in a multi-admin shop permanently disables administration until someone edits the database directly. At 100k-customer deployments with one or two admins, this is a realistic outage.
- **Reproduction:** As the only admin, `DELETE /api/employees/<own id>` → 200; `POST /api/auth/login` with the admin username → 403 `ACCOUNT_INACTIVE`; every `@Roles(ADMIN)` endpoint is unreachable. `SELECT count(*) FROM "Employee" WHERE role='ADMIN' AND "isActive"=true AND "deletedAt" IS NULL` → 0.
- **Fix:** In a transaction, count active admins (`role = ADMIN`, `isActive`, `deletedAt IS NULL`); reject if the target is the last one, and reject self-deactivation unless another active admin exists. Apply the same check when `role` is changed away from ADMIN. Return 409 with the remaining-admin count. Document a DB-level break-glass procedure.
- **Verification:** With one admin, deactivate returns 409 and the account still logs in; with two admins, deactivating one succeeds; changing the last admin's role returns 409. The count query never reaches 0 through the API.
- **Status:** - [ ] Fixed

---

## BM-18 — Argon2 (memory-hard) is used to hash refresh tokens on every login/refresh; 100 kiosks can exhaust memory

- **Severity:** S3
- **Location:** `backend/src/employees/employees.service.ts:211-217` (called from `auth.service.ts:52` and `:117`)
- **Evidence:**
  ```ts
    async updateRefreshToken(employeeId: number, refreshToken: string | null) {
      const hashedToken = refreshToken ? await argon2.hash(refreshToken) : null;
      await this.prisma.employee.update({
        where: { id: employeeId },
        data: { refreshToken: hashedToken },
      });
    }
  ```
- **Root cause:** A refresh token is a high-entropy signed JWT, not a low-entropy password. Hashing it with argon2's default memory cost (tens of MB per call) on every login and every rotation is unnecessary work, and the stored hash cannot be indexed or looked up. Each refresh also hashes the *new* token, so a kiosk fleet refreshing every 15 minutes performs continuous argon2 operations. The auth path verifies the old token with `argon2.verify` (`auth.service.ts:108`) and then hashes the new one.
- **Impact at scale:** Argon2's default memory is ~64 MiB; 100 concurrent refreshes can reserve ~6.4 GiB and spike CPU, causing 503s for invoice/POS traffic. On a small VPS this is a denial-of-service vector via repeated refresh calls. Password hashing remains the right use of argon2; refresh tokens should not compete for the same pool.
- **Reproduction:** Load-test `POST /api/auth/refresh` with 100 valid tokens in parallel and watch `process.memoryUsage().rss` and event-loop lag; compare with a SHA-256 implementation. `SELECT "refreshToken" FROM "Employee"` shows a full argon2 `$argon2id$...` string per user.
- **Fix:** Store `HMAC-SHA256(refreshToken, REFRESH_TOKEN_PEPPER)` (or a random `jti` + hashed family) and compare with `crypto.timingSafeEqual`; keep argon2 only for `passwordHash`. If argon2 must stay, use explicit low-memory parameters and a single-session model, but SHA-256/HMAC is the standard choice for opaque/high-entropy tokens.
- **Verification:** Refresh latency p95 drops below 10 ms and memory stays flat under 100 concurrent refreshes; old tokens are still rejected after rotation/logout; `refreshToken` no longer matches `^\$argon2`.
- **Status:** - [ ] Fixed

---

## BM-19 — Logo upload accepts SVG and serves it from the API origin; stored XSS via `image/svg+xml`

- **Severity:** S3
- **Location:** `backend/src/settings/uploads.util.ts:5-11` (filter at `settings.controller.ts:85-98`; static serving at `main.ts:23-25`)
- **Evidence:**
  ```ts
  export const ALLOWED_IMAGE_EXTENSIONS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.webp',
    '.svg',
  ]);
  ```
  ```ts
        const extension = extname(file.originalname).toLowerCase();
        if (
          !ALLOWED_IMAGE_EXTENSIONS.has(extension) ||
          !file.mimetype?.startsWith('image/')
        ) {
  ```
- **Root cause:** SVG is XML and can contain `<script>`, `<foreignObject>`, event handlers and external references. The only checks are the filename extension and the client-supplied `Content-Type`; there is no sanitization or magic-byte validation. `main.ts:23-25` serves `uploads/` with `express.static` and no `Content-Security-Policy`, `X-Content-Type-Options`, or `Content-Disposition`. The resulting URL is public through `GET /api/settings/brand`, so any authenticated user who opens it executes script on the API origin.
- **Impact at scale:** An ADMIN account (or a compromised admin session) can persist a script that runs for other admins viewing the brand/logo, potentially exfiltrating tokens from same-origin storage or performing actions as the viewer. Even without admin compromise, SVG is an unnecessary attack surface for a logo field.
- **Reproduction:** Upload an SVG containing `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script></svg>` via `POST /api/settings/logo`, then open the returned `/uploads/<uuid>.svg` in a browser; the script runs. `curl -I` shows `Content-Type: image/svg+xml` and no CSP/nosniff.
- **Fix:** Remove `.svg` from `ALLOWED_IMAGE_EXTENSIONS` (PNG/JPEG/WebP are sufficient for a logo), or sanitize with a server-side SVG sanitizer (DOMPurify + jsdom) before storing. Serve uploads with `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, and `Content-Disposition: attachment` for anything not a raster image; ideally serve from a separate cookie-less origin. Validate magic bytes, not just the extension/mimetype.
- **Verification:** Uploading `.svg` returns 400; an existing SVG URL returns `Content-Disposition: attachment` and a CSP header; a browser test shows no script execution. `ALLOWED_IMAGE_EXTENSIONS.has('.svg')` is false.
- **Status:** - [ ] Fixed

---

## BM-20 — Deactivating a category with active product models silently orphans the catalog

- **Severity:** S3
- **Location:** `backend/src/categories/categories.service.ts:56-66`
- **Evidence:**
  ```ts
    async deactivate(id: number) {
      await this.findOne(id);

      return this.prisma.category.update({
        where: { id },
        data: {
          isActive: false,
          deletedAt: new Date(),
        },
        select: { id: true, name: true, isActive: true },
      });
    }
  ```
- **Root cause:** There is no check for `productModels` with `isActive: true, deletedAt: null`. The category becomes invisible to `findAll` (`:9-11`), but its models remain active and sellable. Category-scoped lists/filters then omit those models, and `findOne` on the category 404s, so the products cannot be found through the normal catalog path.
- **Impact at scale:** With 100k products, deactivating a category to "clean up" hides thousands of active SKUs from inventory screens while invoices can still sell them. Stock and reorder reports that join through the category lose rows, and operators cannot tell whether the product is missing or the category is archived.
- **Reproduction:** Create a category with one active `ProductModel`; `DELETE /api/categories/:id` → 200. `GET /api/categories` omits the category, `GET /api/categories/:id` → 404, but `GET /api/product-models?categoryId=:id` still returns the active model (or the product remains sellable).
- **Fix:** In a transaction, count active models; return 409 with the count unless `force=true`. If `force`, deactivate the models too (and warn about stock) or reassign them. Never soft-delete a category while active models reference it.
- **Verification:** Deactivating a non-empty category returns 409 and leaves it active; after moving/deactivating all models it succeeds; the catalog never contains an active model whose category has `deletedAt != null`.
- **Status:** - [ ] Fixed

---

## BM-21 — Expenses can be edited or soft-deleted with no audit trail

- **Severity:** S3
- **Location:** `backend/src/expenses/expenses.service.ts:159-168` (delete at `:171-181`)
- **Evidence:**
  ```ts
      return this.prisma.expense.update({
        where: { id },
        data: {
          ...(data.categoryId && { categoryId: data.categoryId }),
          ...(data.amount !== undefined && { amount: data.amount }),
          ...(data.date && { date: new Date(data.date) }),
          ...(data.description !== undefined && { description: data.description }),
        },
        include: { category: { select: { id: true, name: true } } },
      });
  ```
- **Root cause:** `Expense` has `createdAt`/`updatedAt`/`deletedAt` but no audit table, and `update`/`remove` do not write `SystemAuditLog` either. An ADMIN can change the amount, date or category of a posted expense, or soft-delete it, and the only trace is `updatedAt` (which does not record who or what changed). `create` records the employee, but edits do not.
- **Impact at scale:** Expense fraud/error investigation is impossible: a 10,000 EGP expense can become 1,000 with no record, and a deleted expense disappears from reports while the row remains. At thousands of expenses per year this defeats reconciliation and audit requirements.
- **Reproduction:** `POST /api/expenses` as admin A, then `PUT /api/expenses/:id {"amount":1}` as admin B; `SELECT * FROM "SystemAuditLog" WHERE "entityType"='Expense' AND "entityId"='<id>'` → 0 rows. `DELETE /api/expenses/:id` also writes no audit row.
- **Fix:** Add an append-only `ExpenseAuditLog` (`expenseId`, `action` CREATE/UPDATE/DELETE, `employeeId`, `before Json`, `after Json`, `createdAt`) or reuse `SystemAuditLog`. Write it in the same transaction as the mutation, with the actor from `req.user.sub`. Keep soft delete and never hard-delete.
- **Verification:** Each create/update/delete produces exactly one audit row with the correct actor and before/after values; a test asserts the log is immutable (no update/delete endpoints); reports can reconstruct any historical amount.
- **Status:** - [ ] Fixed

---

## BM-22 — Archived legacy SQL is still present at `prisma/*.sql`; applying it re-adds constraints that break stock adjustments

- **Severity:** S3
- **Location:** `backend/prisma/constraints.sql:71-81` (root copies also `backend/prisma/migration.sql`, `backend/prisma/add_role.sql`; archive statement at `backend/prisma/legacy/README.md:1-7`)
- **Evidence:**
  ```sql
  -- StockLot: quantityRemaining must be between 0 and quantityReceived
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'stock_lot_remaining_le_received'
    ) THEN
      ALTER TABLE "StockLot"
      ADD CONSTRAINT stock_lot_remaining_le_received
      CHECK ("quantityRemaining" >= 0 AND "quantityRemaining" <= "quantityReceived");
  ```
- **Root cause:** `legacy/README.md` says these three files "must **not** be run anymore" and describes them as archived, but identical copies still sit in `backend/prisma/` next to `schema.prisma`. Nothing prevents an operator or a deployment script from running `psql -f prisma/constraints.sql`. That file adds `stock_lot_remaining_le_received` and `stock_lot_reserved_valid`, which the README itself says reject supported adjustment flows (`legacy/README.md:39-44`). `migration.sql:47-48` also inserts a new `"Unknown Supplier"` every run and `:54` picks `LIMIT 1` nondeterministically.
- **Impact at scale:** Running the wrong SQL once makes positive `FOUND`/`COUNT_CORRECTION` adjustments fail with a 500, and every subsequent invoice confirmation that lowers `quantityRemaining` below `quantityReserved` crashes. The duplicate "Unknown Supplier" rows also pollute supplier reports. Because the files look official (same directory as `schema.prisma`), this is an easy operational mistake.
- **Reproduction:** On a test DB, `psql "$DATABASE_URL" -f backend/prisma/constraints.sql`, then approve a positive `FOUND` adjustment that raises `quantityRemaining` above `quantityReceived`; the API returns a check-constraint error. Run the file twice and `SELECT count(*) FROM "Supplier" WHERE name='Unknown Supplier'` increases.
- **Fix:** Delete the root copies (they already exist under `legacy/`), or rename them to `.sql.archived` outside `prisma/`; add a CI/lint check that only `prisma/migrations/**/migration.sql` may contain DDL. Document `prisma migrate deploy` as the only supported path. If the legacy files must stay for archaeology, move them to `docs/legacy/` and add a prominent `DO NOT RUN` header plus a guard that refuses to run when `_prisma_migrations` exists.
- **Verification:** `git ls-files 'backend/prisma/*.sql'` returns only the expected archived paths (or none); CI fails if a new root `.sql` appears; applying the archived file is not referenced by any script or README command.
- **Status:** - [ ] Fixed

---

## BM-23 — OFFSET pagination orders by non-unique columns; pages repeat or skip rows when names/dates collide

- **Severity:** S3
- **Location:** `backend/src/customers/customers.service.ts:22-27` (also `suppliers.service.ts:43-53`, `expenses.service.ts:105-115`)
- **Evidence:**
  ```ts
        this.prisma.customer.findMany({
          where,
          orderBy: { name: 'asc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
  ```
- **Root cause:** `ORDER BY name` (and `ORDER BY date` for expenses) is not a total order: many customers share a name, and many expenses share a timestamp. PostgreSQL is free to return equal-key rows in any order per query, so `LIMIT/OFFSET` can show the same row on page 1 and page 2, or omit one entirely. There is no `id` tiebreaker and no keyset/cursor pagination. `suppliers.service.ts:52` has the same `orderBy: { name: 'asc' }`.
- **Impact at scale:** With 100k customers and common Arabic names (e.g. "محمد أحمد"), duplicate keys are guaranteed; an operator paging through the list will miss customers or see duplicates, and exports built from pages will be incomplete. At 5M invoices the same defect in expense/date lists affects financial review. The bug is intermittent and data-dependent, so it is hard to reproduce in small tests.
- **Reproduction:** Seed 100 customers all named `"Same"`; request `?page=1&limit=10` and `?page=2&limit=10` repeatedly and collect ids; observe overlaps/missing ids across runs. `EXPLAIN` shows a `Sort` with no unique key.
- **Fix:** Always append a unique tiebreaker: `orderBy: [{ name: 'asc' }, { id: 'asc' }]` and `[{ date: 'desc' }, { id: 'desc' }]`. For deep pages, switch to keyset pagination (`WHERE (name, id) > (:lastName, :lastId)`) so performance and correctness do not depend on OFFSET. Apply to every list endpoint in this module.
- **Verification:** The duplicate-name test returns a stable partition: union of all pages equals the full set, with no duplicates. `EXPLAIN` shows the index `(name, id)` and no external sort for the first page.
- **Status:** - [ ] Fixed

---

## BM-24 — `SettingsService.get()` lazy-creates the singleton row; concurrent first requests race and one returns 500

- **Severity:** S4
- **Location:** `backend/src/settings/settings.service.ts:13-27`
- **Evidence:**
  ```ts
      let settings = await this.prisma.appSetting.findUnique({
        where: { id: 1 },
      });

      if (!settings) {
        // Initialize with defaults
        settings = await this.prisma.appSetting.create({
          data: {
            id: 1,
            businessName: 'Pallet POS',
            currency: 'EGP',
            timezone: 'Africa/Cairo',
            invoicePrefix: 'INV',
          },
        });
      }
  ```
- **Root cause:** Read-then-create is not atomic. On a fresh database, two concurrent `GET /api/settings/brand` (public) or `GET /api/settings` requests both see `null` and both `create({ id: 1 })`; the second violates the primary key and throws `P2002`, which the global filter turns into a 500. `AppSetting` has no DB-side default row and no migration inserts one.
- **Impact at scale:** Only the first request after provisioning is affected, but that is exactly when a health check and the login page (`brand`) fire together; the login page can show a 500 on first boot. It is also reproducible in tests that truncate `AppSetting`.
- **Reproduction:** `TRUNCATE "AppSetting";` then fire 10 parallel `GET /api/settings/brand`; at least one returns 500 with `P2002` in the log, the rest return defaults.
- **Fix:** Use `prisma.appSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1, ...defaults } })`, which is atomic, or insert the row in a migration/seed and make `get()` read-only. Catch `P2002` and re-read as a fallback.
- **Verification:** After truncation, 10 parallel brand requests all return 200 and the same row; no `P2002` in the log; a test asserts a single `AppSetting` row exists.
- **Status:** - [ ] Fixed

---

## BM-25 — Settings API accepts `currency`, `timezone`, `logoUrl` and `invoicePrefix` but silently ignores or never uses them

- **Severity:** S4
- **Location:** `backend/src/settings/settings.service.ts:49-57` (DTO at `dto/update-settings.dto.ts:24-46`)
- **Evidence:**
  ```ts
      // Force Egyptian configuration
      const safeData = { ...data };
      delete safeData.currency;
      delete safeData.timezone;

      if ('logoUrl' in safeData && safeData.logoUrl !== undefined) {
        // Logo changes go through upload/delete endpoints only
        delete safeData.logoUrl;
      }
  ```
- **Root cause:** The DTO advertises all fields and the controller returns 200, but the service deletes `currency`, `timezone` and `logoUrl` before the update. `invoicePrefix` is stored but never read anywhere in `backend/src` (only `settings.service.ts:25,44` and the DTO mention it), so changing it has no effect on invoice numbering. Clients cannot distinguish "saved" from "ignored".
- **Impact at scale:** An admin changes the invoice prefix or currency, sees success, and expects new invoices to use it; they do not. This creates support tickets and, for currency, a false expectation of multi-currency support. The mismatch also makes the API contract untestable.
- **Reproduction:** `PATCH /api/settings {"currency":"USD","timezone":"UTC","invoicePrefix":"ABC"}` → 200; `GET /api/settings` still shows `EGP`/`Africa/Cairo`, and the next invoice number still uses the old prefix (grep shows `invoicePrefix` is never used in invoice generation).
- **Fix:** Remove immutable/ignored fields from `UpdateSettingsDto` (or reject them with 400 listing the allowed fields), and implement `invoicePrefix` in the invoice-number generator or remove it from the model/UI. If currency/timezone are intentionally fixed, document them as read-only and do not accept them.
- **Verification:** Sending `currency` returns 400 (or is absent from the DTO); changing `invoicePrefix` changes the next generated invoice number; an OpenAPI/schema test asserts the accepted fields match the persisted fields.
- **Status:** - [ ] Fixed

---

## BM-26 — Redundant indexes duplicate unique constraints on `Invoice`, `Employee` and `ProductUnit`

- **Severity:** S4
- **Location:** `backend/prisma/schema.prisma:348,381` (also `:585,619`, `:187,200`)
- **Evidence:**
  ```prisma
    invoiceNumber          String                  @unique
  ```
  ```prisma
    @@index([invoiceNumber])
  ```
- **Root cause:** `@unique` already creates a B-tree unique index, but the schema also declares a plain `@@index` on the same column; the `init` migration creates both (`20260915231159_init/migration.sql:355,364` for barcode, `:460,466` for username, `:388,400` for invoice number). PostgreSQL maintains both on every insert/update.
- **Impact at scale:** At 5M invoices, every insert/update writes an extra B-tree entry and consumes disk/WAL; the same for millions of `ProductUnit` rows. The redundant indexes also enlarge backups and slow `VACUUM`. There is no read benefit because the unique index serves the same lookups.
- **Reproduction:** `SELECT indexname, indexdef FROM pg_indexes WHERE tablename='Invoice' AND indexdef ILIKE '%invoiceNumber%';` returns two indexes. `EXPLAIN` for `WHERE "invoiceNumber" = 'INV-1'` uses one; the other is never chosen. Measure `pg_relation_size` before/after dropping.
- **Fix:** Drop the plain indexes: `DROP INDEX "Invoice_invoiceNumber_idx"`, `"Employee_username_idx"`, `"ProductUnit_barcode_idx"`. Keep the unique constraints. Add a schema lint/test that fails if a column has both `@unique` and `@@index`.
- **Verification:** `pg_indexes` shows one index per column; insert throughput/WAL per invoice improves measurably in a benchmark; `prisma migrate diff` reports no schema drift.
- **Status:** - [ ] Fixed

---

## BM-27 — Category list `_count.productModels` includes soft-deleted/inactive models, unlike `findOne`

- **Severity:** S4
- **Location:** `backend/src/categories/categories.service.ts:12-16` (contrast `:25-29`)
- **Evidence:**
  ```ts
        include: {
          _count: {
            select: { productModels: true },
          },
        },
  ```
- **Root cause:** The list count has no `where`, so it counts every `ProductModel` row, including `isActive: false` and `deletedAt != null`. `findOne` filters the relation to `isActive: true, deletedAt: null` (`:25-29`). The same category therefore reports different product counts depending on the endpoint.
- **Impact at scale:** Category cards show inflated counts (e.g. 5,000 when only 200 are sellable), confusing inventory planning. After years of catalog churn the discrepancy grows and users stop trusting the counts.
- **Reproduction:** Create a category with one active and one soft-deleted model; `GET /api/categories` shows `_count.productModels = 2`, while `GET /api/categories/:id` returns one model. `SELECT count(*) FROM "ProductModel" WHERE "categoryId"=... AND "deletedAt" IS NULL AND "isActive"=true` → 1.
- **Fix:** Use a filtered count (`_count: { select: { productModels: { where: { isActive: true, deletedAt: null } } } }`) or a separate `groupBy` query; make the list and detail use the same predicate. Add a test asserting the two counts match.
- **Verification:** The list and detail counts are equal for a category with mixed models; `EXPLAIN` shows the count uses `ProductModel_categoryId_isActive_idx`.
- **Status:** - [ ] Fixed

---

## BM-28 — Two divergent expense-category CRUD implementations; `ExpensesService` category methods are dead code with different validation

- **Severity:** S4
- **Location:** `backend/src/expenses/expenses.service.ts:11-58` (live implementation at `expense-categories/expense-categories.service.ts:23-58`)
- **Evidence:**
  ```ts
    async createCategory(data: { name: string }) {
      return this.prisma.expenseCategory.create({
        data: { name: data.name },
      });
    }
  ```
- **Root cause:** `ExpensesService` still contains `createCategory`, `findAllCategories`, `updateCategory` and `deleteCategory`, but `ExpensesController` exposes none of them (verified: only `create`, `findAll`, `findOne`, `update`, `remove` call the service). The live `ExpenseCategoriesService` trims names, checks duplicates and soft-deletes; the dead copy does none of that and hard-deletes when no expenses exist. Two implementations of the same table invite a future caller to pick the wrong one.
- **Impact at scale:** A new endpoint or refactor may wire the dead methods and reintroduce duplicate/untracked categories or hard-delete a category that a concurrent expense just referenced (FK error). The divergence also makes the codebase harder to reason about during audits.
- **Reproduction:** `grep -R "createCategory\|findAllCategories\|updateCategory\|deleteCategory" backend/src` shows only `expenses.service.ts` definitions and no call sites; `expenses.controller.ts` has no category routes. The dead `createCategory` accepts `" Rent "` without trimming, while the live one trims and rejects duplicates.
- **Fix:** Delete the four methods from `ExpensesService` (or make them delegate to `ExpenseCategoriesService`) and keep a single source of truth. Add a lint rule for unused public service methods if feasible.
- **Verification:** `grep` finds one implementation; the expense-category test suite covers trim/duplicate/deactivate; no dead code remains in `expenses.service.ts`.
- **Status:** - [ ] Fixed

---

## BM-29 — `.gitignore` protects only the exact `.env` filename; `.env.production`/`.env.local` would be committed

- **Severity:** S4
- **Location:** `backend/.gitignore:3`
- **Evidence:**
  ```gitignore
  node_modules
  dist
  .env
  uploads
  *.js
  !nest-cli.json
  !tsconfig.json
  !tsconfig.build.json
  ```
- **Root cause:** The pattern `.env` matches only that exact path. Standard variants (`.env.production`, `.env.staging`, `.env.local`, `.env.test`) are not ignored, and there is no `.env.example` to show which variables are required. A developer creating `.env.production` with real JWT/database secrets will see it staged by `git add -A`.
- **Impact at scale:** A single committed production env file leaks the database superuser URL and JWT/QR signing secrets, allowing token forgery and full data access. The repository currently has no tracked `.env` (verified with `git ls-files`), but the guard is too narrow for a team.
- **Reproduction:** `printf 'SECRET=x\n' > backend/.env.production; git status --porcelain backend/.env.production` → `?? backend/.env.production` (not ignored). `git check-ignore -v backend/.env.production` exits 1.
- **Fix:** Replace `.env` with `.env*` and add `!.env.example`; commit a placeholder `.env.example` documenting `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ATTENDANCE_QR_SECRET`, `CORS_ORIGINS`, `PORT`. Add a pre-commit secret scanner (gitleaks) and a CI check that no `.env*` other than `.env.example` is tracked.
- **Verification:** `git check-ignore -v backend/.env.production backend/.env.local` reports the new pattern; `git ls-files 'backend/.env*'` lists only `.env.example`; a test commit with a fake secret is rejected by the scanner.
- **Status:** - [ ] Fixed

---
