# SEED PLAN — Large Dataset for Scale Validation

## Purpose

Provide a reproducible, **non-production** dataset that exercises the audit's scale
targets:

| Dimension | Target |
|---|---|
| Customers | 100,000+ |
| Product models | 2,000+ (100k+ product units) |
| Invoices | 5,000,000+ |
| Invoice items | 12,000,000+ |
| Employees | 20–200 |
| Date span | 36 months (Africa/Cairo) |

The dataset is designed to make the following failure modes observable:

1. Report endpoints that aggregate in Node.js instead of SQL.
2. Leading-wildcard `ILIKE` search without trigram indexes.
3. Unbounded `include` / nested relation loads on invoice detail.
4. Dropdown endpoints returning 10,000 rows.
5. `InvoiceSequence` row-lock serialization under concurrent invoice creation.
6. Dashboard/report queries that scan `InvoiceItem` without a covering index.
7. Client-side sorting/pagination of large report payloads.

## Safety model

The seed script is **additive by default** and refuses to run unless the operator
opts in explicitly.

Required environment variables:

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Target database (must be a disposable/dev database). |
| `CONFIRM_LARGE_SEED=YES` | Explicit acknowledgement that the target is disposable. |
| `SEED_RUN_ID` | Short tag embedded in every generated natural key, so rows can be identified and removed. |
| `SEED_RESET=1` | Optional. Deletes rows for `SEED_RUN_ID` first. Requires `CONFIRM_LARGE_SEED=YES`. |
| `CUSTOMERS` | Default `100000`. |
| `PRODUCT_MODELS` | Default `2000`. |
| `UNITS` | Default `100000`. |
| `INVOICES` | Default `200000`. Set `5000000` for the full target. |
| `ITEMS_PER_INVOICE_MAX` | Default `5`. |
| `EMPLOYEES` | Default `40`. |
| `BATCH` | Default `5000` rows per `UNNEST` insert. |

The script **never** runs `DROP`, `TRUNCATE`, or deletes rows outside the current
`SEED_RUN_ID`.

## Recommended execution order

```powershell
# 0. Use a disposable database. Never point this at production.
$env:DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/rich_scale"
$env:CONFIRM_LARGE_SEED = "YES"
$env:SEED_RUN_ID = "scale01"

# 1. Apply schema
cd backend
npx prisma migrate deploy

# 2. Small smoke run first (validates the generator end-to-end)
$env:CUSTOMERS = "1000"; $env:INVOICES = "2000"; $env:UNITS = "1000"
node ..\audit\scripts\seed_large_dataset.js

# 3. Full-scale run
$env:CUSTOMERS = "100000"
$env:UNITS = "100000"
$env:INVOICES = "5000000"
node ..\audit\scripts\seed_large_dataset.js

# 4. Refresh planner statistics (critical: without this, EXPLAIN lies)
psql $env:DATABASE_URL -c "ANALYZE;"
```

## Data shape

### Master data
- **Workplaces**: 3, with Cairo coordinates.
- **Employees**: 1 admin, 2 accountants, 10 sales, 10 inventory, 2 kiosks;
  password hash is a fixed argon2 hash of `SeedPass123!` (never use in production).
- **Categories**: 40 Arabic/English names.
- **Product models**: configurable; `isSerialized` mostly true, every 10th
  non-serialized with `unit = METER`.
- **Product units**: barcode `SEED-<run>-U-<n>`; status distribution
  70% AVAILABLE, 20% SOLD, 5% RESERVED, 5% DAMAGED.
- **Customers**: 100k Arabic names, 10% COMPANY, phones unique-ish, debt 0.
- **Suppliers**: 200.

### Transactions
- **Stock receipts + lots**: one lot per 500 units, purchase price 50–500 EGP.
- **Invoices**: dates uniformly spread over the last 36 months in Africa/Cairo.
  Status distribution: 55% CONFIRMED, 15% DELIVERED, 20% PENDING_ACCOUNTANT,
  10% CANCELLED.
- **Invoice items**: 1..`ITEMS_PER_INVOICE_MAX` per invoice; `price` decimal,
  `costAtSale` decimal, `cogsStatus` FINAL for confirmed/delivered.
- **Invoice unit assignments**: for serialized items, one assignment per unit.
- **Customer debt movements**: one INCREASE per confirmed credit invoice and
  occasional PAYMENT rows.
- **Audit logs**: one CREATED row per invoice (5M rows) to exercise audit paging.
- **Notifications**: a bounded sample (e.g. 50k) to avoid dominating runtime.

### Natural-key convention

Every generated natural key starts with `SEED-<runId>-`:

- `Customer.name` → `SEED-<run>-CUST-<n>`
- `ProductModel.name` → `SEED-<run>-MODEL-<n>`
- `ProductUnit.barcode` → `SEED-<run>-U-<n>`
- `Invoice.invoiceNumber` → `SEED-<run>-INV-<n>`
- `Employee.username` → `seed_<run>_<role>_<n>`

This makes cleanup and targeted measurement possible without touching real rows.

## Cleanup

```sql
-- Only rows created by the run.
DELETE FROM "InvoiceAuditLog" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "invoiceNumber" LIKE 'SEED-scale01-%');
DELETE FROM "InvoiceItemUnitAssignment" WHERE "invoiceItemId" IN (SELECT id FROM "InvoiceItem" WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE "invoiceNumber" LIKE 'SEED-scale01-%'));
-- ... walk the FK graph in dependency order (see script header) ...
DELETE FROM "Invoice" WHERE "invoiceNumber" LIKE 'SEED-scale01-%';
```

The script prints the exact cleanup statements for the active run.

## What to measure after seeding

| Check | Command | Pass criterion |
|---|---|---|
| Invoice list p95 | `EXPLAIN (ANALYZE, BUFFERS)` on `GET /invoices?page=1` | < 300 ms |
| Customer search p95 | `GET /customers?search=...` | < 300 ms, index scan |
| Report revenue | `GET /reports/revenue?from=...&to=...` | < 1 s, no full `InvoiceItem` scan in Node |
| Invoice detail payload | `GET /invoices/:id` | < 500 KB, bounded includes |
| Concurrent invoice create | 50 parallel POSTs | no sequence deadlocks, monotonic numbers |
| Dropdown load | `GET /product-models?limit=10000` | should be replaced by search endpoint |
| Audit history | `GET /audit?page=1` | constant memory, `LIMIT/OFFSET` in SQL |

## Risks / notes

- **Do not run against production.** There is no reliable way for the script to
  detect production; the explicit `CONFIRM_LARGE_SEED` flag is the safeguard.
- The seed intentionally creates **denormalized-looking** data (e.g. debt
  movements) to expose reconciliation bugs; it is not a financial reference.
- 5M invoices with 12M+ items can require 50–150 GB of disk. Start with the
  smoke run and scale up.
- `ANALYZE` after seeding is mandatory; autovacuum may take a long time on first
  load.
- If `pg_stat_statements` is available, enable it before running the API load
  tests so the audit's query recommendations can be validated.
