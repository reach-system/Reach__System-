# Findings — Backend Invoicing (`invoices` + `invoice-delivery`)

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `backend/src/invoices/invoices.service.ts` | 1008 | complete |
| `backend/src/invoices/invoices.controller.ts` | 147 | complete |
| `backend/src/invoices/invoices.module.ts` | 13 | complete |
| `backend/src/invoices/invoices.service.spec.ts` | 306 | complete |
| `backend/src/invoices/dto/create-invoice.dto.ts` | 66 | complete |
| `backend/src/invoices/dto/reject-invoice.dto.ts` | 10 | complete |
| `backend/src/invoice-delivery/invoice-delivery.service.ts` | 521 | complete |
| `backend/src/invoice-delivery/invoice-delivery.controller.ts` | 56 | complete |
| `backend/src/invoice-delivery/invoice-delivery.module.ts` | 13 | complete |
| `backend/src/invoice-delivery/dto/scan-barcode.dto.ts` | 10 | complete |
| `backend/src/common/constants/invoice.constants.ts` | 5 | complete |

---

## BI-01 — Invoice money is computed in binary floats and only rounded by the database

- **Severity:** S1
- **Location:** `backend/src/invoices/invoices.service.ts:55-59`
- **Evidence:**
  ```ts
      const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const safePercentage = Math.max(0, Math.min(discountPercentage || 0, 100));
      const safeFixedDiscount = Math.max(0, discountAmount || 0);
      const percentageDiscount = subtotal * (safePercentage / 100);
      const total = Math.max(0, subtotal - percentageDiscount - safeFixedDiscount);
  ```
- **Root cause:** `price`, `quantity`, `discountPercentage` and `discountAmount` are plain JS `number`s (IEEE-754). `calculateInvoiceTotals` performs every multiplication/subtraction in float and returns float, which is then written to `Decimal(18,2)` columns (`originalTotal`, `currentTotal`, `InvoiceItem.price`) at `invoices.service.ts:272-273`, `286-287`, `296-297`. Each value is rounded independently by PostgreSQL, so the stored line prices need not sum to the stored subtotal/total. There is no 2-decimal validation on `price` in `CreateInvoiceDto` (`dto/create-invoice.dto.ts:17-20`), so a client can send `1.005` and the line price is rounded to `1.01` while the total is computed from `1.005`.
- **Impact at scale:** Financial reports, VAT/accounting exports and customer statements drift by cents per invoice; at 5M invoices the aggregate drift is material and unreconcilable because the per-line inputs were never stored exactly. Any discount percentage that produces a half-cent boundary can flip a cent depending on float representation. This is a correctness defect at any scale, not only at 5M.
- **Reproduction:** `POST /invoices` with `items: [{ productModelId: 1, quantity: 1, price: 1.005 }]`. The response/total is computed from `1.005`; the persisted `InvoiceItem.price` is `1.01` (`Decimal(18,2)`), so `SUM(invoice_items.price * quantity) <> invoice.original_total`. Similarly `discountPercentage: 33.333333` on a subtotal of `100.05` yields `total = 66.6999…` and stores `66.70`, while `100.05 - 33.35 = 66.70` only by luck of the rounding mode.
- **Fix:** Use `Prisma.Decimal` (decimal.js) end-to-end: parse `price`/`discount` into `Decimal`, compute `subtotal`, `percentageDiscount`, `fixedDiscount` and `total` with `Decimal`, set an explicit rounding mode (`ROUND_HALF_UP`) and 2-dp scale at each boundary, and pass `Decimal` values to Prisma. Validate `price` with `@IsNumber({ maxDecimalPlaces: 2 })` (or a custom `Decimal` string DTO) so unrepresentable inputs are rejected with 400. Persist the applied discount (`fixedDiscount`) rather than the requested one (see BI-21).
- **Verification:** Add a unit test asserting `calculateInvoiceTotals` returns `Decimal` and that `sum(line.price * quantity) - percentageDiscount - fixedDiscount === total` exactly for adversarial inputs (`1.005`, `0.1`, `19.99 × 3`, `33.333333%`). Integration test: create an invoice and assert `SUM(price*quantity)` from the DB equals `originalTotal` and `originalTotal - discountAmount = currentTotal`.
- **Status:** - [ ] Fixed

---

## BI-02 — Concurrent barcode scans can exceed the required quantity (over-delivery)

- **Severity:** S1
- **Location:** `backend/src/invoice-delivery/invoice-delivery.service.ts:138-141`
- **Evidence:**
  ```ts
      // Rule 7: Would not exceed required quantity
      if (matchingLine.unitAssignments.length >= matchingLine.quantity) {
        throw new BadRequestException({ code: 'SCANNED_QUANTITY_EXCEEDS_REQUIRED', message: `Required quantity (${matchingLine.quantity}) already reached for this line`, line: matchingLine.productModel.name, required: matchingLine.quantity, scanned: matchingLine.unitAssignments.length });
      }
  ```
- **Root cause:** The quantity cap is enforced from a snapshot read outside the transaction (`invoice.items.unitAssignments` loaded at lines 76-87), and the transaction at lines 144-220 only guards the *unit* (`ProductUnit.version`, line 147) and the *invoice status*, never the line's scanned count. Two scans of two **different** units for the same line both see `n-1` assignments, both pass Rule 7, and both commit because they touch different `ProductUnit` rows. `InvoiceItemUnitAssignment` has no unique constraint on `(invoiceItemId, productUnitId)` (schema lines 503-518) and no `scannedQuantity` counter exists on `InvoiceItem`.
- **Impact at scale:** At a delivery desk with multiple inventory employees scanning in parallel, a line of quantity 1 can receive 2+ assignments. `deliverInvoice` only checks `unitAssignments.length < item.quantity` (line 407), so the extra units are marked `SOLD` and leave inventory while the invoice records only the required quantity — direct stock loss and corrupted COGS. The same race can push a line past its quantity on any high-concurrency scan burst.
- **Reproduction:** Create and confirm an invoice with one serialized line, `quantity: 1`. Have two `INVENTORY` users `POST /invoices/:id/delivery/scan` at the same time with two different AVAILABLE barcodes of that model. Both return 201, and `GET /invoices/:id/delivery` reports `scannedQuantity: 2` for `requiredQuantity: 1`. Then `PATCH /invoices/:id/deliver` succeeds and both units become `SOLD`.
- **Fix:** Enforce the cap inside the transaction with a conditional counter update, e.g. add `scannedQuantity Int @default(0)` to `InvoiceItem` and do `tx.invoiceItem.updateMany({ where: { id: lineId, scannedQuantity: { lt: quantity } }, data: { scannedQuantity: { increment: 1 } } })`, throwing `SCANNED_QUANTITY_EXCEEDS_REQUIRED` when `count === 0`; or `SELECT … FOR UPDATE` the `InvoiceItem` row at the start of the tx. Add `@@unique([invoiceItemId, productUnitId])` so the same unit can never be double-assigned. Keep the pre-check only as a fast-fail.
- **Verification:** Concurrency test (Promise.all of two `scanBarcode` calls with different units, line quantity 1): exactly one succeeds, the other returns 409/400, and the DB has one assignment. Add a test that `deliverInvoice` rejects when `unitAssignments.length > quantity`.
- **Status:** - [ ] Fixed

---

## BI-03 — `InvoiceSequence` is incremented at the start of the invoice transaction, serializing every invoice creation

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:200-208`
- **Evidence:**
  ```ts
        transactionResult = await this.prisma.$transaction(async (tx) => {
        const sequence = await tx.invoiceSequence.upsert({
          where: { id: 1 },
          update: { currentNumber: { increment: 1 } },
          create: { id: 1, currentNumber: 1 },
        });

        const nextNumber = sequence.currentNumber;
        const invoiceNumber = `INV-${String(nextNumber).padStart(6, '0')}`;
  ```
- **Root cause:** The `UPDATE invoice_sequence SET current_number = current_number + 1 WHERE id = 1` acquires an exclusive row lock on the single sequence row, and that lock is held until the entire interactive transaction commits (all stock reservation, item inserts, audit inserts and model lookups). Every concurrent `createInvoice` therefore queues behind the previous one for the whole duration of the transaction — the classic single-row sequence bottleneck.
- **Impact at scale:** Invoice creation throughput collapses to roughly `1 / transaction_duration`. With the transaction doing tens of round-trips (BI-04/BI-05), a 50 ms commit means ~20 invoices/s globally, regardless of connection pool size; at 5M invoices and peak sales periods this becomes a hard ceiling and produces `P2028`/`55P03` timeout and lock-wait errors. It also serializes unrelated stock updates, amplifying lock contention on `ProductModel`/`StockLot`.
- **Reproduction:** Load-test `POST /invoices` with 50 concurrent clients on the same DB. Observe `pg_stat_activity` showing one `invoice_sequence` row lock holder and the rest waiting on `transactionid`/`tuple` locks; throughput is flat as concurrency increases, and `p99` grows linearly with transaction time.
- **Fix:** Allocate the number outside the long transaction. Best: use a PostgreSQL sequence (`CREATE SEQUENCE invoice_number_seq`) and `SELECT nextval('invoice_number_seq')`, which is non-transactional and O(1) under concurrency. Acceptable alternative: a dedicated short transaction/autocommit `UPDATE invoice_sequence … RETURNING current_number` executed before (or after) the stock transaction, then use the value. If gapless numbering is mandatory, allocate the number at the very end of a short transaction and retry on gaps rather than holding the row lock across stock work.
- **Verification:** Load test with 50 concurrent creates: throughput scales with pool size and `pg_locks` shows no long-lived wait on `invoice_sequence`. Assert invoice numbers are unique and monotonically increasing; assert no duplicate `invoiceNumber` (`@unique` already enforces this).
- **Status:** - [ ] Fixed

---

## BI-04 — `createInvoice` wraps all per-item/per-lot work in one long interactive transaction

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:200-362`
- **Evidence:**
  ```ts
          for (const lot of lots) {
            if (remainingToReserve <= 0) break;
            const availableInLot = lot.quantityRemaining - lot.quantityReserved;
            if (availableInLot <= 0) continue;
            const toReserve = Math.min(availableInLot, remainingToReserve);
            const updated = await tx.stockLot.updateMany({
              where: {
                id: lot.id,
                quantityReserved: { lte: lot.quantityRemaining - toReserve },
              },
              data: { quantityReserved: { increment: toReserve } },
            });
            if (updated.count === 1) {
              remainingToReserve = roundQuantity(remainingToReserve - toReserve);
            }
          }
  ```
- **Root cause:** A single `$transaction(async (tx) => …)` spans the sequence increment, every serialized `count` + `updateMany`, every non-serialized `findMany` + per-lot `updateMany`, the `invoice.create`, one `invoiceItem.create` per line, two `invoiceAuditLog.create` calls, and one `productModel.findUnique` per affected model. Each `await` is a network round-trip inside the transaction; Prisma's default interactive-transaction timeout is 5 s. There is no `timeout`/`maxWait` override and no batching.
- **Impact at scale:** With 20–50 line invoices, the transaction easily exceeds the 5 s default, aborting with `P2028` and forcing the client to retry (each retry burns a sequence number and re-does all reads). Locks on `ProductModel`/`StockLot` rows are held for the full duration, so unrelated invoices touching the same popular model block behind it. Under load this produces a retry storm that further lengthens the queue.
- **Reproduction:** Create an invoice with 40 non-serialized lines, each spanning 5 lots (200 lot updates + 40 item inserts + 40 lookups). Time the request; with a remote DB (1–2 ms RTT) it exceeds 5 s and returns `P2028 Transaction already closed`. `pg_stat_activity` shows the transaction `idle in transaction` between round-trips while holding row locks.
- **Fix:** Keep the transaction to a small, fixed number of statements: batch-read models/lots once (`findMany({ where: { id: { in: ids } } })`), perform reservations with set-based SQL (`UPDATE stock_lot SET quantity_reserved = quantity_reserved + v.qty FROM (VALUES …) v WHERE …`), insert items with `createMany`, insert audit logs with `createMany`, and move sequence allocation out (BI-03). Set explicit `{ timeout: 10000, maxWait: 2000 }` as a safety net. Consider a reservation table + background reconciliation instead of interactive transactions.
- **Verification:** Add a test that a 50-line invoice issues a bounded number of SQL statements (assert via Prisma query log ≤ ~10) and completes under 500 ms locally. Load test at 50 concurrent creates with no `P2028` and no lock waits > 100 ms.
- **Status:** - [ ] Fixed

---

## BI-05 — Per-row inserts and lookups inside the create transaction (N+1 writes)

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:281-301`
- **Evidence:**
  ```ts
        for (const si of serializedItems) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              productModelId: si.productModelId,
              quantity: si.quantity,
              price: si.price,
            },
          });
        }

        for (const nsi of nonSerializedItems) {
          await tx.invoiceItem.create({
            data: {
              invoiceId: invoice.id,
              productModelId: nsi.productModelId,
              quantity: nsi.quantity,
              price: nsi.price,
            },
          });
        }
  ```
- **Root cause:** Two separate `invoiceItem.create` loops (one per item, lines 281-301), plus one `productModel.findUnique` per affected model at lines 347-354, plus one `stockLot.updateMany` per lot at lines 246-252. All of these are individual round-trips inside the already-long transaction (BI-04). `createMany` is not used anywhere in the path.
- **Impact at scale:** A 50-line invoice issues 50 item inserts + up to 50 model lookups + N lot updates, each with full round-trip latency and WAL flush amplification. This is the dominant contributor to the transaction duration that causes the sequence lock (BI-03) and timeout (BI-04) problems; at 5M invoices the extra statements dominate DB CPU and connection occupancy.
- **Reproduction:** Enable Prisma query logging and create an invoice with 30 lines. Observe 30 separate `INSERT INTO invoice_items` statements and 30 `SELECT … FROM product_models WHERE id = $1` statements for a single request (the models were already loaded at lines 143-145).
- **Fix:** `tx.invoiceItem.createMany({ data: [...] })` for all lines in one statement. Reuse the `model` objects already loaded in the pre-check instead of re-reading them at lines 347-354 (or one `findMany({ where: { id: { in: [...affectedModelIds] } } })`). Batch lot updates with a single `UPDATE … FROM (VALUES …)`.
- **Verification:** Query-log assertion: creating a 30-line invoice emits one `INSERT INTO invoice_items`, one model `findMany`, and no per-row `findUnique`. Compare statement count before/after; target ≤ 10 statements per create.
- **Status:** - [ ] Fixed

---

## BI-06 — `confirmInvoice` holds a transaction across per-lot updates and a per-item aggregate

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:474-530`
- **Evidence:**
  ```ts
            const lots = await tx.stockLot.findMany({
              where: { productModelId: item.productModelId, quantityReserved: { gt: 0 } },
              orderBy: { receivedDate: 'asc' },
            });

            let remainingToConsume = item.quantity;
            for (const lot of lots) {
              if (remainingToConsume <= 0) break;
              const toConsume = Math.min(lot.quantityReserved, remainingToConsume);

              await tx.stockLot.update({
                where: { id: lot.id },
                data: {
                  quantityRemaining: { decrement: toConsume },
                  quantityReserved: { decrement: toConsume },
                },
              });
  ```
- **Root cause:** For every invoice item, the transaction runs a `findMany` of all reserved lots, then one unconditional `stockLot.update` per lot, one `stockConsumption.create` per lot (lines 497-505), and a `stockConsumption.aggregate` per item (lines 517-520), then an `invoiceItem.update` (522-528). It also performs two audit inserts (532-549). The status claim (`updateMany`, lines 458-465) is correctly conditional, but the rest of the work is per-row and unbounded by any item/lot cap.
- **Impact at scale:** Confirming a 100-line invoice with 3 lots per line is ~700 round-trips inside one transaction, far past the 5 s default; the invoice row stays locked (`FOR UPDATE` from the claim) while other accountants see `P2028` or wait. Because `stockLot.update` is unconditional (no `quantityReserved >= toConsume` predicate), a concurrent confirm/reject on the same lots can also drive `quantityReserved` negative.
- **Reproduction:** Seed a model with 10 lots, create and confirm an invoice with 50 lines of that model; time `PATCH /invoices/:id/confirm` against a remote DB. Observe > 5 s and `P2028`; `pg_locks` shows the invoice row lock held for the whole request.
- **Fix:** Replace the loop with set-based SQL: allocate lots in one `UPDATE stock_lot … FROM (SELECT … ORDER BY received_date FOR UPDATE)` statement per item (or a single statement for all items using a lateral join), bulk-insert `stock_consumption` with `createMany`, and compute `costAtSale` in the same SQL (`SUM(total_cost)/quantity`). Add `where: { id: lot.id, quantityReserved: { gte: toConsume } }` to the update and check `count` before proceeding. Batch audit inserts with `createMany`.
- **Verification:** Confirm a 50-line invoice: statement count ≤ 10, latency < 300 ms locally, no `P2028`; assert `quantityReserved >= 0` for all lots after a concurrent confirm+reject stress test.
- **Status:** - [ ] Fixed

---

## BI-07 — Invoice detail loads unbounded nested collections

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:790-840`
- **Evidence:**
  ```ts
          auditLogs: {
            include: {
              employee: { select: { id: true, name: true } },
            },
            orderBy: { timestamp: 'desc' },
          },
  ```
- **Root cause:** `findOne` uses a single `findUnique` with `include` for `items` (with `unitAssignments` and `consumptions`, lines 799-819), `priceAdjustments` (821), `returns` with `items` (822-824), `changeRequests` with `items` + two employees (825-832), and `auditLogs` with employee (833-838) — none of them has `take`, and there is no `select` limiting the payload. Prisma issues one query per included relation and materializes every row in memory. `auditLogs` grows monotonically: 2 rows on create, 1 on confirm, 1 per scan, 1 per unscan, 1 on deliver, plus every price-adjustment/change-request event.
- **Impact at scale:** An invoice that went through many scans/adjustments can return thousands of audit rows and consumption rows in a single response. At 5M invoices this is a memory and latency hazard (large JSON serialization, event-loop blocking), and it is reachable by any authenticated `ADMIN/ACCOUNTANT/SALES/INVENTORY` user via `GET /invoices/:id`. Deep includes also multiply DB round-trips (one per relation per invoice).
- **Reproduction:** Create an invoice, scan/unscan 100 serialized units repeatedly (each scan writes 2 audit rows), then call `GET /invoices/:id`. The response contains the entire audit history and every assignment/consumption with no pagination; response time and payload grow linearly with history.
- **Fix:** Split the detail endpoint: return invoice header + item lines with `_count` for assignments/consumptions, and expose `auditLogs`, `returns`, `changeRequests`, `priceAdjustments` via the existing paginated `GET /invoices/:id/audit-log` plus dedicated paginated endpoints. If they must stay, add `take: 50` and a cursor to each collection, `select` only needed columns, and drop `consumptions.stockLot.supplier` from the hot path (use a summary aggregate).
- **Verification:** Add a test asserting the detail response contains at most N audit rows and does not include `consumptions` by default; measure p95 payload size for an invoice with 200 audit rows before/after.
- **Status:** - [ ] Fixed

---

## BI-08 — Delivery queue sorts on an unindexed column and returns full item payloads

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:756-788`
- **Evidence:**
  ```ts
        this.prisma.invoice.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            employee: { select: { id: true, name: true } },
            items: {
              include: {
                productModel: { select: { id: true, name: true, isSerialized: true } },
              },
            },
          },
          skip,
          take: limit,
          orderBy: { confirmedAt: 'asc' },
        }),
  ```
- **Root cause:** `findDeliveryQueue` filters `status = CONFIRMED` and orders by `confirmedAt`, but the `Invoice` model has only `@@index([status])`, `@@index([date])`, `@@index([employeeId, date])`, `@@index([customerId, date])` and `@@index([invoiceNumber])` (schema lines 378-382) — there is no index on `confirmedAt` and no composite `(status, confirmedAt)`. PostgreSQL must read all `CONFIRMED` rows, sort them, then apply `OFFSET/LIMIT`. The query also loads every `items` row (with `productModel`) for each of the `limit` invoices, and the mapping at lines 782-785 keeps `items` in the response even though only `itemCount` is used.
- **Impact at scale:** With hundreds of thousands of `CONFIRMED` (undelivered) invoices, each page request performs a full sort of the confirmed set and transfers the entire item list of 25 invoices. `skip` grows with page depth, so late pages re-sort and re-scan more. Delivery staff polling this queue makes it a continuous CPU sink.
- **Reproduction:** Seed 200k `CONFIRMED` invoices with random `confirmedAt`; run `GET /invoices/delivery-queue?page=1&limit=25` and `EXPLAIN (ANALYZE, BUFFERS)` — observe `Seq Scan on invoices` + `Sort` with high `Sort Method: external merge` and rows removed by `Limit`. Inspect the response: each element contains `items[]` even though only `itemCount` is displayed.
- **Fix:** Add `@@index([status, confirmedAt])` (partial index `WHERE status = 'CONFIRMED'` is even better) and order by `(confirmedAt, id)`. Replace the `items` include with `_count: { select: { items: true } }` and map `itemCount = inv._count.items`, removing `items` from the response. Use keyset pagination on `(confirmedAt, id)` instead of `skip`.
- **Verification:** `EXPLAIN` shows an index scan on `(status, confirmed_at)` with no `Sort`; response elements no longer contain `items`; p95 latency for page 1 and page 500 are comparable.
- **Status:** - [ ] Fixed

---

## BI-09 — Pagination parameters are unbounded and unvalidated

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.controller.ts:66-80`
- **Evidence:**
  ```ts
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 25,
  ```
- **Root cause:** `findAll`, `findPendingReview` and `findDeliveryQueue` accept raw query strings, `parseInt` them, and pass them straight to Prisma (`invoices.service.ts:730-731`, `757-758`, `875-876`). There is no `@Min/@Max`, no clamp, and no rejection of `NaN`/negative values. `limit=1000000` is accepted; `page=0` yields a negative `skip`; `limit=abc` yields `NaN`, which Prisma rejects with an unhandled validation error (500 instead of 400). The same pattern is repeated at controller lines 92-95 and 107-110.
- **Impact at scale:** A single `GET /invoices?limit=1000000` forces the DB to materialize and serialize a million invoices with nested customer/employee/items — an easy accidental or malicious DoS that can exhaust memory and DB connections for all users. Deep `skip` (e.g. `page=100000`) makes PostgreSQL scan and discard millions of rows per request, and `NaN`/negative values produce 500s that pollute error tracking.
- **Reproduction:** `GET /invoices?limit=999999` returns the entire invoice table (or OOMs the Node process). `GET /invoices?page=-1` returns a Prisma error 500. `GET /invoices?limit=abc` returns 500 with a Prisma validation message.
- **Fix:** Create a shared pagination DTO with `@Type(() => Number) @IsInt() @Min(1) @Max(100)` for `limit` and `@Min(1)` for `page`, enable the global `ValidationPipe({ transform: true, whitelist: true })` for query DTOs, and additionally clamp in the service (`Math.min(Math.max(limit, 1), 100)`). Move to keyset/cursor pagination for `findAll` and the delivery queue.
- **Verification:** Tests: `limit=0`, `limit=101`, `limit=abc`, `page=0`, `page=-1` all return 400; `limit=100` returns at most 100 rows; `limit=999999` returns 400. Load test confirms a single request cannot allocate unbounded memory.
- **Status:** - [ ] Fixed

---

## BI-10 — Invoice-number search uses `contains` + `insensitive`, forcing a full table scan

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:954-957`
- **Evidence:**
  ```ts
      const where: Prisma.InvoiceWhereInput = {
        ...baseWhere,
        ...(numberTerm && { invoiceNumber: { contains: numberTerm, mode: 'insensitive' } }),
      };
  ```
- **Root cause:** `contains` translates to `invoiceNumber ILIKE '%term%'`. A leading wildcard plus `lower()` cannot use the `invoiceNumber` btree index (schema line 381, and the `@unique` index), so PostgreSQL sequentially scans the entire `invoices` table for every search. The `mode: 'insensitive'` adds a `lower()` call per row. The controller documents `search` as "Invoice number or unit barcode" and users type the full number, so the fuzzy match buys nothing.
- **Impact at scale:** Every keystroke-triggered search from the invoices screen scans 5M rows; at 5M invoices this is seconds of CPU per request and saturates the DB under a handful of concurrent users. It also defeats the `(employeeId, date)`/`(customerId, date)` filters because the planner must still evaluate the ILIKE predicate on every candidate row.
- **Reproduction:** `EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM invoices WHERE invoice_number ILIKE '%INV-000123%'` on a 5M-row table → `Seq Scan`, ~5M rows filtered. Compare with `invoice_number = 'INV-000123'` → index scan.
- **Fix:** Since numbers are generated as `INV-` + zero-padded digits, normalize the term (uppercase, add the `INV-` prefix if missing) and use exact equality (`invoiceNumber: normalized`) or, for partial entry, `startsWith` (which can use the btree index with `text_pattern_ops`). If fuzzy search is genuinely required, add a `pg_trgm` GIN index on `invoiceNumber` and keep `contains`.
- **Verification:** `EXPLAIN` for the search query shows an index scan / bitmap index scan instead of a seq scan; p95 search latency stays under 50 ms at 5M rows; add a test that searching `inv-000123` returns the exact invoice.
- **Status:** - [ ] Fixed

---

## BI-11 — `rejectInvoice` silently releases less stock than reserved and still cancels the invoice

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:625-637`
- **Evidence:**
  ```ts
            let remainingToRelease = item.quantity;
            for (const lot of lots) {
              if (remainingToRelease <= 0) break;
              const toRelease = Math.min(lot.quantityReserved, remainingToRelease);

              await tx.stockLot.update({
                where: { id: lot.id },
                data: { quantityReserved: { decrement: toRelease } },
              });

              remainingToRelease = roundQuantity(remainingToRelease - toRelease);
            }
  ```
- **Root cause:** Unlike `confirmInvoice`, which throws `STOCK_CONFLICT` when `remainingToConsume > 0` (lines 510-515), the reject path never checks `remainingToRelease` after the loop. If the lots hold less reserved quantity than the line requires (data drift, a concurrent release, an earlier partial failure, or a manual adjustment), the loop exits with `remainingToRelease > 0` and the invoice is still transitioned to `CANCELLED`. The serialized branch (lines 613-616) is also an unconditional `decrement` with no lower-bound guard, so it can drive `ProductModel.reservedQuantity` negative.
- **Impact at scale:** Silent reservation leaks: stock stays reserved forever against a cancelled invoice, so available quantity is permanently understated and subsequent invoices fail with `INSUFFICIENT_STOCK` even though physical stock exists. Negative `reservedQuantity` makes `available = availableCount - reservedQuantity` overstate availability (the check at line 156), allowing overselling. Both are hard to detect at 5M invoices and corrupt stock reporting.
- **Reproduction:** Create a `PENDING_ACCOUNTANT` invoice for 5 units of a non-serialized model, then manually `UPDATE stock_lots SET quantity_reserved = 0 WHERE product_model_id = …`. `PATCH /invoices/:id/reject` returns 200 and the invoice becomes `CANCELLED`, but no error is raised and the reservation is not reconciled. For serialized, set `product_models.reserved_quantity = 0` and reject: it becomes `-5`.
- **Fix:** Mirror the confirm guard: after the loop, `if (remainingToRelease > 0) throw new ConflictException({ code: 'STOCK_CONFLICT', … })` so the whole transaction rolls back and the invoice stays pending for investigation. Make each decrement conditional (`where: { id, quantityReserved: { gte: toRelease } }`, check `count === 1`) and make the serialized release conditional (`where: { id, reservedQuantity: { gte: item.quantity } }`). Optionally write a reconciliation audit log when the reservation is short.
- **Verification:** Test: corrupt the reservation then reject → transaction rolls back, invoice remains `PENDING_ACCOUNTANT`, and an error is returned. Assert `reservedQuantity >= 0` and `quantityReserved >= 0` invariants after a reject stress test.
- **Status:** - [ ] Fixed

---

## BI-12 — Status transitions commit, then post-commit notifications can fail and return 500

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:552-569`
- **Evidence:**
  ```ts
      await this.notificationsService.notifyInvoiceConfirmed(invoiceId, result.invoiceNumber, result.salesEmployeeId, invoiceDetails);
      this.realtimeService?.publish({
        type: 'invoice.confirmed',
        entity: 'Invoice',
        entityId: invoiceId,
        roles: [Role.ADMIN, Role.SALES, Role.INVENTORY],
        employeeIds: [result.salesEmployeeId],
        payload: { status: InvoiceStatus.CONFIRMED },
      });

      return { id: invoiceId, status: InvoiceStatus.CONFIRMED };
  ```
- **Root cause:** The status change and all stock mutations are committed by `$transaction` at line 552, and only then are `notifyInvoiceConfirmed` (559) and `realtimeService.publish` (560) awaited outside the transaction. If either throws (SMTP/DB error in notifications, Redis/socket failure in realtime), the exception propagates and Nest returns 500 even though the invoice is already `CONFIRMED`. The same pattern exists for `rejectInvoice` (681-685, 717-724), `deliverInvoice` (`invoice-delivery.service.ts:510-517`) and `scanBarcode` (`invoice-delivery.service.ts:222-248`).
- **Impact at scale:** The client sees a failure and retries; the retry hits the state guard (`invoice.status !== PENDING_ACCOUNTANT` at 453-455 or the claim `count !== 1`) and returns `INVALID_STATUS`/409, so the UI reports "invoice was already processed by another employee" to the same user who just processed it. Operators then investigate phantom failures. Under notification-provider outages this turns every confirm/deliver into a user-visible error and a support ticket, at 5M-invoice scale a continuous stream.
- **Reproduction:** Stub `NotificationsService.notifyInvoiceConfirmed` to throw (`jest.spyOn(...).mockRejectedValue(new Error('SMTP down'))`), call `confirmInvoice`. The invoice row is `CONFIRMED` and stock is deducted, but the HTTP call returns 500. Repeating the call returns 409 `INVALID_STATUS`.
- **Fix:** Make post-commit side effects non-fatal: wrap them in `try/catch` and log/metric the failure (or enqueue an outbox job inside the transaction and let a worker deliver it). Return the committed result regardless. For true idempotency, allow a repeat `confirm` on an already-`CONFIRMED` invoice by the same actor to return the existing result (200) instead of 409.
- **Verification:** Test: notifications throw → endpoint still returns 200 with `status: CONFIRMED`, invoice committed, and an error is logged. Test: calling confirm twice by the same employee returns the same 200 result (or a documented 409 only for a *different* actor).
- **Status:** - [ ] Fixed

---

## BI-13 — Delivery/unscan validate status outside the transaction; scans can land on a `DELIVERED` invoice

- **Severity:** S2
- **Location:** `backend/src/invoice-delivery/invoice-delivery.service.ts:405-436`
- **Evidence:**
  ```ts
      // Check all serialized lines are fully scanned
      for (const item of invoice.items) {
        if (item.unitAssignments.length < item.quantity) {
          throw new BadRequestException({
            code: 'DELIVERY_INCOMPLETE',
            message: `Line "${item.productModel.name}" requires ${item.quantity} units but only ${item.unitAssignments.length} scanned`,
            line: item.productModel.name,
            required: item.quantity,
            scanned: item.unitAssignments.length,
          });
        }
      }
  ```
- **Root cause:** `deliverInvoice` reads the invoice and assignments at lines 381-395 and validates completeness at 405-416, then opens a transaction that only claims `status: CONFIRMED → DELIVERED` (422-429). `scanBarcode` symmetrically checks `invoice.status !== InvoiceStatus.CONFIRMED` at line 93 *before* its transaction (144), and `unscanBarcode` checks at line 272 before its transaction (315). A scan that passed its status check can commit after the delivery claim, creating an assignment on an already-`DELIVERED` invoice (unit left `RESERVED`, `reservedQuantity` decremented); an unscan can flip a unit back to `AVAILABLE` after delivery (unit already `SOLD` is caught by the `status: RESERVED` guard at 326-329 only if the deliver tx ran first, otherwise the unscan wins and the delivered unit is `AVAILABLE`).
- **Impact at scale:** Multi-user delivery desks at 5M invoices will hit this interleaving: delivered invoices with units still `RESERVED` (never sold, never returned) or `SOLD` units reverted to `AVAILABLE` and resold. It also breaks the `scannedQuantity` invariant that `deliverInvoice` relies on and produces inventory that disagrees with invoices.
- **Reproduction:** Concurrency test with two parallel calls: (a) `POST /invoices/:id/delivery/scan` with the last missing unit, (b) `PATCH /invoices/:id/deliver`. Delay the scan's transaction start (e.g. inject a sleep between the status check at line 93 and `$transaction` at 144). Observe the invoice `DELIVERED` while the new assignment exists with `reversedAt = null` and the unit is `RESERVED`. Analogously race `DELETE …/scan/:unitId` with `PATCH …/deliver`.
- **Fix:** Re-check the invoice status **inside** every delivery transaction and lock the invoice row: in `scanBarcode`, start the tx with `tx.invoice.findUnique({ where: { id }, select: { status: true } })` (or `SELECT … FOR UPDATE`) and abort unless `CONFIRMED`; in `deliverInvoice`, claim the status *before* reading/validating assignments inside the same tx, and re-read assignments after the claim. In `unscanBarcode`, add the same in-tx status check. Prefer a single serialization point per invoice (row lock) for scan/unscan/deliver.
- **Verification:** Concurrency tests for scan-vs-deliver and unscan-vs-deliver: exactly one operation wins; after delivery no assignment has `reversedAt = null` beyond the required quantity and no `RESERVED` unit remains attached to the invoice. Add a DB assertion job that no `DELIVERED` invoice has `RESERVED` assigned units.
- **Status:** - [ ] Fixed

---

## BI-14 — Missing composite index `(status, date)` for the pending-review queue

- **Severity:** S2
- **Location:** `backend/src/invoices/invoices.service.ts:733-746`
- **Evidence:**
  ```ts
      const where: Prisma.InvoiceWhereInput = { status: InvoiceStatus.PENDING_ACCOUNTANT };

      const [data, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true } },
            employee: { select: { id: true, name: true } },
            items: { select: { id: true } },
          },
          skip,
          take: limit,
          orderBy: { date: 'asc' },
        }),
  ```
- **Root cause:** The query filters on `status` and orders by `date`, but `Invoice` only has separate `@@index([status])` and `@@index([date])` (schema lines 378-382). PostgreSQL can use one of them, then must sort the matching set (or scan the date index and filter status row-by-row). Neither plan satisfies both the filter and the ordering, so every page of the accountant queue sorts the pending set. `findAll` with `status` + a date range has the same gap for `(status, date)`.
- **Impact at scale:** With a backlog of 100k+ `PENDING_ACCOUNTANT` invoices (common when accountants are behind, and guaranteed during any outage), each page request sorts 100k rows and `skip` re-does it for every page. The accountant UI auto-refreshes, turning this into sustained CPU and I/O. The count query (`invoice.count({ where })` at 747) also scans the status index, which is acceptable, but the sort is not.
- **Reproduction:** Seed 200k `PENDING_ACCOUNTANT` invoices with random dates; `EXPLAIN (ANALYZE, BUFFERS)` the `findPendingReview` query → `Sort` with `external merge Disk` above the limit. Compare after adding `@@index([status, date])` → index-only scan, no sort.
- **Fix:** Add `@@index([status, date])` to `Invoice` (consider `@@index([status, date, id])` for stable keyset pagination), and use keyset pagination `where: { status, date: { gt: lastDate } }` instead of `skip`. For `findAll`, add `(status, date)` and `(employeeId, status, date)` as query patterns require.
- **Verification:** `EXPLAIN` shows `Index Scan using invoices_status_date_idx` with no `Sort` node; p95 for page 1 and page 1000 of the queue are within 20% of each other.
- **Status:** - [ ] Fixed

---

## BI-15 — Invoice items array has no maximum size, amplifying the create transaction

- **Severity:** S2
- **Location:** `backend/src/invoices/dto/create-invoice.dto.ts:61-65`
- **Evidence:**
  ```ts
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => InvoiceItemDto)
    items: InvoiceItemDto[];
  ```
- **Root cause:** `CreateInvoiceDto.items` has a minimum but no `@ArrayMaxSize`, so a client can submit an arbitrarily large array. Every element drives the pre-check queries (BI-16) and the in-transaction per-row writes and lot updates (BI-04/BI-05/BI-06), so request cost is unbounded and attacker-controlled.
- **Impact at scale:** A single request with 10k lines generates tens of thousands of DB statements inside one interactive transaction, guaranteeing a `P2028` timeout, holding the `InvoiceSequence` row lock (BI-03) for the duration, and consuming memory for the DTO and audit payload (`invoiceItemsSummary`, lines 303-307, is also stored verbatim in `invoiceAuditLog.details`). This is a cheap DoS vector and a source of transaction timeouts for legitimate users.
- **Reproduction:** `POST /invoices` with 5,000 items (same `productModelId`) → request takes minutes or times out with `P2028`, while all other invoice creations block on the sequence row lock. Response/DB audit log contains a 5,000-element JSON array.
- **Fix:** Add `@ArrayMaxSize(100)` (or the business limit) and validate it in the service as defense in depth. Also cap the audit `items` summary (e.g. store counts + first 20 lines) to keep `invoiceAuditLog.details` bounded.
- **Verification:** Test: 101 items → 400 with a clear message; 100 items → succeeds within the transaction budget. Assert audit `details.items` length is capped.
- **Status:** - [ ] Fixed

---

## BI-16 — Pre-transaction N+1 reads: one `productModel` lookup and one stock aggregate per line

- **Severity:** S3
- **Location:** `backend/src/invoices/invoices.service.ts:137-180`
- **Evidence:**
  ```ts
        const model = await this.prisma.productModel.findFirst({
          where: { id: item.productModelId, isActive: true, deletedAt: null },
        });
        if (!model) {
          throw new NotFoundException({ code: 'PRODUCT_MODEL_NOT_FOUND', message: `Product model ${item.productModelId} not found` });
        }
  ```
- **Root cause:** For each item the service issues a separate `productModel.findFirst` (143-145), then either a `productUnit.count` (153-155) or a `stockLot.aggregate` (165-168). A 50-line invoice therefore performs 100+ queries before the transaction even starts, each with full round-trip latency; duplicate `productModelId` entries repeat the same reads.
- **Impact at scale:** Adds tens to hundreds of milliseconds per create and 100+ query-planner invocations; at high create rates this is meaningful DB CPU for zero additional correctness (the authoritative checks are re-done inside the tx at 210-264 anyway). It also widens the window between the pre-check and the transaction, making the pre-check increasingly stale under load.
- **Reproduction:** Prisma query log for a 30-line invoice shows 30 `SELECT … FROM product_models` and 30 `SELECT COUNT/SUM` statements before the `BEGIN`.
- **Fix:** Deduplicate `productModelId`s, fetch all models in one `findMany({ where: { id: { in: ids }, isActive: true, deletedAt: null } })`, and fetch stock availability in one `groupBy` over `stockLot` (`_sum` of `quantityRemaining`/`quantityReserved`) plus one `groupBy` over `productUnit` by `productModelId, status`. Validate the batch results in memory.
- **Verification:** Query log for a 30-line invoice shows ≤ 3 pre-check statements; latency improves accordingly and the in-tx authoritative checks still pass the existing ISS-007 tests.
- **Status:** - [ ] Fixed

---

## BI-17 — Queue endpoints load every invoice item just to compute `itemCount`

- **Severity:** S3
- **Location:** `backend/src/invoices/invoices.service.ts:735-751`
- **Evidence:**
  ```ts
      const [data, total] = await Promise.all([
        this.prisma.invoice.findMany({
          where,
          include: {
            customer: { select: { id: true, name: true } },
            employee: { select: { id: true, name: true } },
            items: { select: { id: true } },
          },
          skip,
          take: limit,
          orderBy: { date: 'asc' },
        }),
        this.prisma.invoice.count({ where }),
      ]);

      return {
        data: data.map((inv) => ({ ...inv, itemCount: inv.items.length, items: undefined })),
  ```
- **Root cause:** `findPendingReview` (and `findAll` at 928-945 and 959-977) include `items: { select: { id: true } }` solely to derive `itemCount`, then discard the array with `items: undefined`. Prisma still runs a second query to fetch every item id for every invoice on the page and transfers them to Node. `findDeliveryQueue` (BI-08) does the same but keeps the payload.
- **Impact at scale:** For a 25-invoice page with 20 lines each, that is 500 unnecessary rows per request plus an extra query; the queue is polled continuously by multiple roles. It also inflates the `count`/`findMany` pair's memory footprint at 5M invoices and prevents using a covering index.
- **Reproduction:** Enable Prisma logging: `GET /invoices/pending-review` emits a `SELECT id FROM invoice_items WHERE invoice_id IN (…)` query and returns 25 objects whose `items` were fetched then dropped.
- **Fix:** Replace the `items` include with `_count: { select: { items: true } }` and map `itemCount: inv._count.items`. Do the same in `findAll` and `findDeliveryQueue`.
- **Verification:** Query log no longer contains an `invoice_items` fetch for the list endpoints; response still reports correct `itemCount`; p95 latency drops proportionally to item count.
- **Status:** - [ ] Fixed

---

## BI-18 — Idempotency key is claimed late and the response is stored in a non-atomic second write

- **Severity:** S3
- **Location:** `backend/src/invoices/invoices.service.ts:189-195`
- **Evidence:**
  ```ts
      const normalizedIdempotencyKey = idempotencyKey?.trim();
      let idempotencyClaimed = false;
      if (normalizedIdempotencyKey) {
        const existingResponse = await this.claimIdempotencyKey(employeeId, normalizedIdempotencyKey);
        if (existingResponse !== null) return existingResponse;
        idempotencyClaimed = true;
      }
  ```
- **Root cause:** The key is claimed only after the customer lookup and all per-item stock pre-checks (lines 123-187), so duplicate concurrent requests both perform the full pre-check before one loses the `P2002` race and receives `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` (lines 98-101) instead of the first request's result. Worse, the stored response is written in a separate statement after the transaction commits (lines 385-390), outside the transaction: a crash, timeout, or a cleanup job deleting the row between commit and update leaves a committed invoice whose idempotency key has `responseBody = null`; retries then get 409 for up to 24 h, and if the row was deleted by the expiry path the retry creates a **second invoice**.
- **Impact at scale:** Clients that retry on timeouts (common at 5M invoices with the slow transactions above) hit 409s or, in the deletion window, duplicate invoices. Duplicate invoices double-reserve stock and corrupt sales reporting, and the 24 h `IN_PROGRESS` blackhole blocks legitimate retries.
- **Reproduction:** (a) Send two simultaneous `POST /invoices` with the same `Idempotency-Key`: one 201, one 409 (not the same body). (b) Kill the process after the `$transaction` resolves but before line 386: the invoice exists, `idempotency_keys.response_body` is `NULL`; retrying returns 409 until expiry. (c) Delete the key row manually after commit and retry: a second invoice is created.
- **Fix:** Claim the key as the first action (before any expensive reads) and make the result write atomic with the business transaction: insert the idempotency row inside the same `$transaction` as the invoice, or store `invoiceId` and let retries resolve it. On `P2002`, poll/read the row briefly (or return `202` with a `Retry-After`) instead of a bare 409. Keep the key until its TTL even if the response is pending, and never delete a key for a committed invoice.
- **Verification:** Tests: two concurrent identical requests return the same body/status; simulated crash between commit and response write leaves a retryable state (retry returns the original invoice, not 409/duplicate); after expiry cleanup a new key creates a new invoice while the old committed invoice is untouched.
- **Status:** - [ ] Fixed

---

## BI-19 — `getAuditLog` returns the full audit history with no pagination

- **Severity:** S3
- **Location:** `backend/src/invoices/invoices.service.ts:1000-1006`
- **Evidence:**
  ```ts
      return this.prisma.invoiceAuditLog.findMany({
        where: { invoiceId },
        include: {
          employee: { select: { id: true, name: true } },
        },
        orderBy: { timestamp: 'asc' },
      });
  ```
- **Root cause:** The endpoint returns every audit row for an invoice, joined to `employee`, with no `take`/cursor. Audit rows accumulate on every create (2), confirm (1), scan (1), unscan (1) and deliver (1), plus any other invoice operations, so the row count is unbounded over the invoice lifetime.
- **Impact at scale:** A heavily scanned/edited invoice can return thousands of rows; the endpoint is available to all four roles (`invoices.controller.ts:120-125`) and is typically called by an audit UI that only needs a page. At 5M invoices the aggregate read volume and JSON serialization are avoidable load, and `details` JSON can be large (it embeds the full item list on create/confirm).
- **Reproduction:** Create an invoice, perform 500 scans/uncans, then `GET /invoices/:id/audit-log`; the response contains all ~1,500 rows in one payload with no `meta`/pagination.
- **Fix:** Add `page`/`limit` (validated, capped at 100) or a cursor on `(timestamp, id)`, return `meta`, and default to the newest page. Consider `select` to exclude large `details` blobs from the list view.
- **Verification:** Endpoint returns at most `limit` rows plus `meta.total`; p95 latency is constant regardless of history size; tests cover page 1 and the last page.
- **Status:** - [ ] Fixed

---

## BI-20 — Low-stock notification loop runs sequentially after commit, one model at a time

- **Severity:** S3
- **Location:** `backend/src/invoices/invoices.service.ts:392-418`
- **Evidence:**
  ```ts
      for (const modelInfo of modelInfos) {
        const { modelId, name, minStockAlert, isSerialized } = modelInfo;
        if (isSerialized) {
          const availableCount = await this.prisma.productUnit.count({
            where: { productModelId: modelId, status: ProductUnitStatus.AVAILABLE },
          });
          if (availableCount <= minStockAlert) {
            await this.notificationsService.createLowStockNotification(modelId, name, availableCount, minStockAlert);
          } else {
            await this.notificationsService.resolveLowStockNotification(modelId);
          }
  ```
- **Root cause:** After the invoice commits, the service iterates `modelInfos` sequentially, and for each model performs a stock query plus an awaited notification call (which itself does DB writes). For non-serialized models it issues a `stockLot.aggregate` (405-408) and then another notification call. Nothing is parallelized or deferred.
- **Impact at scale:** A 30-model invoice performs 30+ sequential round-trips after commit, adding hundreds of milliseconds to the user-visible latency; under a notification-provider slowdown the request hangs for seconds. The same sequential pattern is repeated in `rejectInvoice` (687-715) and `scanBarcode` (`invoice-delivery.service.ts:222-238`, once per scan). At 5M invoices, low-stock evaluation should not be on the request path at all.
- **Reproduction:** Create an invoice with 30 distinct models; time the request with Prisma logging. Observe 30 sequential stock queries + 30 notification writes after the `COMMIT`, and linear latency growth with item count.
- **Fix:** Move low-stock evaluation to an asynchronous worker/outbox triggered by a stock-change event, or at minimum run the per-model checks with `Promise.all` and a bounded concurrency, and fire-and-forget notifications with error logging (see BI-12). Batch the stock aggregates into one `groupBy` instead of one query per model.
- **Verification:** Request latency is independent of item count (no post-commit loop on the request path); notifications are eventually delivered once per stock change (assert no duplicates in a test).
- **Status:** - [ ] Fixed

---

## BI-21 — Persisted `discountAmount` is the requested amount, not the applied amount

- **Severity:** S3
- **Location:** `backend/src/invoices/invoices.service.ts:266-278`
- **Evidence:**
  ```ts
            discountPercentage: data.discountPercentage ?? 0,
            discountAmount: data.discountAmount ?? 0,
  ```
- **Root cause:** `calculateInvoiceTotals` clamps the fixed discount to the subtotal (`fixedDiscount: Math.min(safeFixedDiscount, subtotal)`, line 64) and computes `total` from it, but the invoice row stores the raw `data.discountAmount`. `discountPercentage` is stored raw as well. If the requested fixed discount exceeds the subtotal (allowed by the DTO, which has no upper bound on `discountAmount`, `create-invoice.dto.ts:48-52`), the persisted invoice says `discountAmount = 1000` while `currentTotal = 0` and `originalTotal = 500`, so `originalTotal - discountAmount` is negative and does not reconcile with `currentTotal`. The computed `percentageDiscount` (line 58) is never persisted.
- **Impact at scale:** Accounting exports and revenue reports that recompute totals from `originalTotal - discountAmount` disagree with `currentTotal` for any capped-discount invoice, and percentage discounts cannot be audited from the invoice row at all (only the raw percentage is kept). At 5M invoices even a small fraction of such rows makes reconciliation unreliable.
- **Reproduction:** `POST /invoices` with `items: [{ price: 500, quantity: 1 }], discountAmount: 1000`. Response `currentTotal: 0`; DB row has `originalTotal = 500`, `discountAmount = 1000`. `500 - 1000 = -500 ≠ 0`. Repeat with `discountPercentage: 10` and inspect that the applied `50` discount is nowhere persisted.
- **Fix:** Persist the **applied** values returned by `calculateInvoiceTotals` (`fixedDiscount`, `percentageDiscount`) instead of the raw request values, or store both requested and applied in dedicated columns. Add `@Max`/service validation tying `discountAmount` to the subtotal. Add a reconciliation invariant test: `originalTotal - percentageDiscount - fixedDiscount === currentTotal`.
- **Verification:** Test with `discountAmount > subtotal`: stored `discountAmount === subtotal`, and `originalTotal - discountAmount === currentTotal`. Test that a percentage discount is recoverable from the stored row.
- **Status:** - [ ] Fixed

---

## BI-22 — Invoice spec covers only totals/create; confirm, reject, delivery and scanning are untested

- **Severity:** S4
- **Location:** `backend/src/invoices/invoices.service.spec.ts:3-5`
- **Evidence:**
  ```ts
  describe('InvoicesService', () => {
    it('calculates subtotal, percentage discount, fixed discount, and final total', () => {
      const service = new InvoicesService({} as any, {} as any);
  ```
- **Root cause:** The entire suite (306 lines) exercises `calculateInvoiceTotals`, the date filter, and four `createInvoice` paths (sequence creation, serialized race, non-serialized lot race, insufficient stock). There is no test for `confirmInvoice`, `rejectInvoice`, `findOne`, `findAll`, `getAuditLog`, `findPendingReview`, `findDeliveryQueue`, and no spec at all for `InvoiceDeliveryService` (`scanBarcode`, `unscanBarcode`, `deliverInvoice`). The `$transaction` mocks return `tx` objects that silently lack methods, so the tests cannot detect missing conditional updates, and nothing asserts statement counts or concurrency behavior.
- **Impact at scale:** The high-risk paths (money rounding, sequence serialization, over-scan race, silent reservation shortfall, post-commit notification failures) have no regression protection; any refactor can silently reintroduce them. This is a maintainability/quality gap rather than a runtime defect.
- **Reproduction:** `npm test -- invoices.service.spec` runs 7 tests, none of which invoke `confirmInvoice`/`rejectInvoice`; `invoice-delivery` has no `.spec.ts`. Deliberately removing the `remainingToConsume > 0` guard in `confirmInvoice` leaves the suite green.
- **Fix:** Add unit tests for confirm/reject happy paths and conflict paths (already-processed invoice, short reservation), a delivery spec covering scan/unscan/deliver including the concurrency cases from BI-02/BI-13, and a create test asserting `createMany`/bounded statement counts. Add a test that `calculateInvoiceTotals` uses `Decimal` once BI-01 is fixed.
- **Verification:** Coverage for `invoices.service.ts` and `invoice-delivery.service.ts` ≥ 80% lines/branches; the mutation described above (removing the guard) fails a test.
- **Status:** - [ ] Fixed

---
