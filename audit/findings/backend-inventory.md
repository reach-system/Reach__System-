# Findings — backend inventory (stock items, receipts, product models, product units)

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `backend/src/stock-items/stock-items.service.ts` | 451 | complete |
| `backend/src/stock-items/stock-items.controller.ts` | 50 | complete |
| `backend/src/stock-items/stock-adjustments.controller.ts` | 73 | complete |
| `backend/src/stock-items/stock-items.module.ts` | 11 | complete |
| `backend/src/stock-items/dto/create-stock-adjustment.dto.ts` | 60 | complete |
| `backend/src/stock-items/dto/reject-stock-adjustment.dto.ts` | 10 | complete |
| `backend/src/stock-receipts/stock-receipts.service.ts` | 549 | complete |
| `backend/src/stock-receipts/stock-receipts.controller.ts` | 91 | complete |
| `backend/src/stock-receipts/stock-receipts.module.ts` | 13 | complete |
| `backend/src/stock-receipts/dto/create-stock-receipt.dto.ts` | 60 | complete |
| `backend/src/stock-receipts/dto/price-receipt.dto.ts` | 44 | complete |
| `backend/src/product-models/product-models.service.ts` | 179 | complete |
| `backend/src/product-models/product-models.controller.ts` | 67 | complete |
| `backend/src/product-models/product-models.module.ts` | 10 | complete |
| `backend/src/product-models/dto/create-product-model.dto.ts` | 32 | complete |
| `backend/src/product-models/dto/update-product-model.dto.ts` | 33 | complete |
| `backend/src/product-units/product-units.service.ts` | 324 | complete |
| `backend/src/product-units/product-units.controller.ts` | 78 | complete |
| `backend/src/product-units/product-units.module.ts` | 10 | complete |

Supporting files read for index/schema and cross-module context (not part of the coverage scope):
`backend/prisma/schema.prisma`, `backend/prisma/migrations/20260915231159_init/migration.sql`,
`backend/src/prisma/prisma.service.ts`, `backend/src/common/quantity.util.ts`,
`backend/src/common/errors/global-exception.filter.ts`, `backend/src/main.ts`,
`backend/src/customer-debts/customer-debts.service.ts`, `backend/src/invoices/invoices.service.ts`.

---

## BV-01 — A receipt can be marked `PRICED` while most of its units/lots have no purchase price

- **Severity:** S1
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:278-385`
- **Evidence:**
  ```ts
      for (const price of prices) {
        if (price.productUnitId) {
          const receiptItem = receipt.items.find((i) => i.productUnitId === price.productUnitId);
          if (!receiptItem) {
            throw new BadRequestException({ code: 'INVALID_RECEIPT_ITEM', message: `Product unit ${price.productUnitId} not in this receipt` });
          }

          await tx.productUnit.update({
            where: { id: price.productUnitId },
            data: { purchasePrice: price.purchasePrice },
          });
  ```
  ```ts
      await tx.stockReceipt.update({
        where: { id: receiptId },
        data: {
          status: StockReceiptStatus.PRICED,
          pricedByEmployeeId: adminId,
          pricedAt: new Date(),
        },
      });
  ```
- **Root cause:** The loop validates only the rows it is given ("this unit belongs to this receipt"). It never asserts the inverse: that every `StockReceiptItem.productUnitId` and every `StockLot.id` of the receipt appears in `prices`. A row with neither `productUnitId` nor `stockLotId` is silently ignored (`if`/`if` with no `else`), duplicate ids are not rejected, and the status update is unconditional. So `PRICED` means "someone called the endpoint", not "everything is priced".
- **Impact at scale:** A 500-unit serialized receipt (the DTO allows `ArrayMaxSize(500)` barcodes) can be priced with a single row. The other 499 units keep `purchasePrice = NULL` permanently: the receipt is no longer `PENDING_PRICING` (line 274) so `priceReceipt` can never run again for it, `cogsStatus` stays `PENDING` for their sales, and every stock/inventory valuation report understates cost. With 100k+ products and thousands of receipts this silently corrupts margin reporting at any scale, and there is no UI/API path to repair it.
- **Reproduction:** `POST /stock-receipts` with `barcodes: ["A","B"]` → returns `receipt.id`; `PATCH /stock-receipts/:id/price` with `{ "prices": [{ "productUnitId": <A>, "purchasePrice": 10 }] }` → 200 `{ status: "PRICED" }`; `GET /stock-receipts/:id` shows unit B with `purchasePrice: null`. A second `PATCH` returns `INVALID_STATUS`.
- **Fix:** Inside the transaction, derive the expected id sets from the receipt (`items.map(i => i.productUnitId)`, `stockLots.map(l => l.id)`), require each row to carry exactly one of `productUnitId`/`stockLotId`, reject duplicate ids, and require `prices` to cover every expected id exactly once. Throw `BadRequestException({ code: 'INCOMPLETE_PRICING', missing: [...] })` before touching any row. Keep the status flip last and make it conditional: `updateMany({ where: { id, status: PENDING_PRICING }, ... })` and assert `count === 1`.
- **Verification:** Unit test: 2-item receipt, price 1 item → 400 `INCOMPLETE_PRICING`, receipt still `PENDING_PRICING`, both `purchasePrice` untouched. Regression SQL must return zero rows:
  ```sql
  SELECT r.id FROM "StockReceipt" r
  JOIN "StockReceiptItem" i ON i."stockReceiptId" = r.id
  JOIN "ProductUnit" u ON u.id = i."productUnitId"
  WHERE r.status = 'PRICED' AND u."purchasePrice" IS NULL;
  ```
- **Status:** - [ ] Fixed

---

## BV-02 — `quantityReceived` under-reports because depleted lots are filtered out before summing

- **Severity:** S1
- **Location:** `backend/src/stock-items/stock-items.service.ts:38-50,132-134`
- **Evidence:**
  ```ts
          stockLots: {
            where: { quantityRemaining: { gt: 0 } },
            select: {
              id: true,
              quantityReceived: true,
              quantityRemaining: true,
              quantityReserved: true,
              purchasePrice: true,
              receivedDate: true,
              supplier: { select: { id: true, name: true } },
            },
            orderBy: { receivedDate: 'asc' },
          },
  ```
  ```ts
      const quantityRemaining = roundQuantity(model.stockLots.reduce((sum, lot) => sum + lot.quantityRemaining, 0));
      const quantityReserved = roundQuantity(model.stockLots.reduce((sum, lot) => sum + lot.quantityReserved, 0));
      const quantityReceived = roundQuantity(model.stockLots.reduce((sum, lot) => sum + lot.quantityReceived, 0));
  ```
- **Root cause:** The `include` is filtered to lots with `quantityRemaining > 0`, and the same filtered array is used to sum `quantityReceived`. `quantityReceived` is a historical figure and must be summed over **all** lots of the model; only the displayed `lots` array needs the "still has stock" filter.
- **Impact at scale:** The inventory screen's "received" column decreases every time stock sells. Receive 100, sell 100 → `quantityReceived: 0`, `quantityRemaining: 0`, while `totalReduced` from adjustments still shows historical damage/loss. The identity `received = remaining + sold + reduced` can never be reconciled, and any report/export built on this endpoint is wrong. At 100k+ products the number of fully depleted lots dominates, so the error is the norm, not an edge case.
- **Reproduction:** Receive 10 units of a non-serialized model (creates one lot), sell all 10 via an invoice, then `GET /stock-items/inventory-count?productModelId=<id>` → `quantityReceived: 0` instead of `10`.
- **Fix:** Stop using one filtered relation for both purposes. Query aggregates over all lots and only the active lots for display:
  ```ts
  const [lotTotals, activeLots] = await Promise.all([
    this.prisma.stockLot.groupBy({
      by: ['productModelId'],
      where: { productModelId: { in: modelIds } },
      _sum: { quantityReceived: true, quantityRemaining: true, quantityReserved: true },
    }),
    this.prisma.stockLot.findMany({
      where: { productModelId: { in: modelIds }, quantityRemaining: { gt: 0 } },
      select: { /* display fields only */ },
      orderBy: { receivedDate: 'asc' },
    }),
  ]);
  ```
  (The same `groupBy` shape is already used in `backend/src/invoices/invoices.service.ts:167`.)
- **Verification:** Test with two lots (one fully consumed, one partially) asserts `quantityReceived = lot1.received + lot2.received` and `quantityRemaining = lot2.remaining`; then assert `received - remaining - reduced` equals the sold quantity for a model with sales and adjustments.
- **Status:** - [ ] Fixed

---

## BV-03 — Switching a model from quantity-based to serialized with stock on hand hides/strands its inventory

- **Severity:** S1
- **Location:** `backend/src/product-models/product-models.service.ts:141-152`
- **Evidence:**
  ```ts
    const unit = data.unit ?? existing.unit;
    const isSerialized = unit === UnitOfMeasure.METER ? false : data.isSerialized ?? existing.isSerialized;

    if (existing.isSerialized && !isSerialized) {
      const unitCount = await this.prisma.productUnit.count({ where: { productModelId: id } });
      if (unitCount > 0) {
        throw new ConflictException({
          code: 'MODEL_HAS_UNITS',
          message: 'This product already has barcode units, so it cannot be switched to quantity-based stock.',
        });
      }
    }
  ```
- **Root cause:** The guard is one-directional. Only `serialized → non-serialized` is checked. The reverse transition (`existing.isSerialized === false` → `isSerialized === true`) is accepted even when the model has `StockLot` rows with `quantityRemaining > 0`. Downstream code branches on `isSerialized`: `stock-items.service.ts:106` takes the unit-counting branch and returns `lots: undefined`, and `invoices.service.ts:152/395` allocates barcode units instead of consuming lots.
- **Impact at scale:** A model with, say, 4,000 meters remaining becomes invisible in `GET /stock-items/inventory-count` (serialized branch reports `available: 0`, `lots: undefined`) and unsellable (sales demand units that do not exist), while the lots and their value remain in the database with no endpoint in this module to convert them back. This is silent inventory/value loss from the operator's point of view, and it is reachable with a single `PATCH /product-models/:id`.
- **Reproduction:** Create a `PIECE` model with `isSerialized: false`, receive `{ quantity: 100 }` (creates a lot), then `PATCH /product-models/:id { "isSerialized": true }` → 200. `GET /stock-items/inventory-count?productModelId=<id>` now returns `isSerialized: true, available: 0, lots: undefined`; attempting to sell the remaining 100 fails with no available units.
- **Fix:** Mirror the existing guard:
  ```ts
  if (!existing.isSerialized && isSerialized) {
    const lotCount = await this.prisma.stockLot.count({
      where: { productModelId: id, quantityRemaining: { gt: 0 } },
    });
    if (lotCount > 0) {
      throw new ConflictException({
        code: 'MODEL_HAS_STOCK_LOTS',
        message: 'This product still has quantity-based stock; consume or adjust it to zero before switching to barcode units.',
      });
    }
  }
  ```
  Do the check and the update in one `$transaction` with `SELECT ... FOR UPDATE` on the model row, or add a DB-level invariant test.
- **Verification:** Unit test for `false → true` with a positive lot asserts 409 and unchanged `isSerialized`; test for `false → true` with only zero-quantity lots asserts success. E2E: after any `PATCH`, assert `SELECT count(*) FROM "StockLot" l JOIN "ProductModel" m ON m.id=l."productModelId" WHERE m."isSerialized" AND l."quantityRemaining" > 0` is `0`.
- **Status:** - [ ] Fixed

---

## BV-04 — Inventory count loads every serialized unit and every active lot into Node memory

- **Severity:** S2
- **Location:** `backend/src/stock-items/stock-items.service.ts:30-57,105-134`
- **Evidence:**
  ```ts
      this.prisma.productModel.findMany({
        where,
        include: {
          category: { select: { id: true, name: true } },
          units: {
            select: { status: true },
          },
          stockLots: {
            where: { quantityRemaining: { gt: 0 } },
            select: {
              id: true,
              quantityReceived: true,
              quantityRemaining: true,
              quantityReserved: true,
              purchasePrice: true,
              receivedDate: true,
              supplier: { select: { id: true, name: true } },
            },
            orderBy: { receivedDate: 'asc' },
          },
        },
        skip,
        take: limit,
  ```
  ```ts
        const available = model.units.filter((u) => u.status === 'AVAILABLE').length;
        const reserved = model.units.filter((u) => u.status === 'RESERVED').length;
        const sold = model.units.filter((u) => u.status === 'SOLD').length;
        const damaged = model.units.filter((u) => u.status === 'DAMAGED').length;
  ```
- **Root cause:** Per-model counts are computed by materializing the `units` relation and filtering in JavaScript. `ProductUnit` rows are never deleted (they go `SOLD`/`DAMAGED` and stay forever), so the relation grows monotonically. `stockLots` is likewise unbounded per model (one lot per non-serialized receipt) and the full lot payload is fetched for every page. The four `.filter()` passes also do four O(n) scans per model.
- **Impact at scale:** With 100k product models and, say, 3M lifetime units, a page of 25 popular models can pull tens of thousands of unit rows plus thousands of lots into memory per request, then serialize only counts. Inventory count is the default inventory screen (polled/refreshed), so this is a steady memory/GC and network cost, and `limit=1000` (see BV-10) makes it an OOM vector. On a 25-model page where each model has 50k units, the response takes seconds and allocates tens of MB for a few integers.
- **Reproduction:** Seed one serialized model with 50,000 `ProductUnit` rows (mixed statuses) and one non-serialized model with 5,000 lots; `GET /stock-items/inventory-count?limit=25` and measure heap/allocation and latency; compare with the same query using `groupBy`. Increase to `limit=500` and observe the response time grow linearly with total units.
- **Fix:** Never fetch child rows just to count them:
  ```ts
  const [unitCounts, lotTotals] = await Promise.all([
    this.prisma.productUnit.groupBy({
      by: ['productModelId', 'status'],
      where: { productModelId: { in: modelIds } },
      _count: { _all: true },
    }),
    this.prisma.stockLot.groupBy({
      by: ['productModelId'],
      where: { productModelId: { in: modelIds } },
      _sum: { quantityReceived: true, quantityRemaining: true, quantityReserved: true },
    }),
  ]);
  ```
  Fetch only the lots that must be displayed (e.g. the 20 most recent per model, or drop the lot breakdown from the list endpoint and serve it from the model detail endpoint). Keep the existing `groupBy` for adjustments (BV-12).
- **Verification:** `EXPLAIN (ANALYZE, BUFFERS)` shows index-only aggregate scans instead of row transfers; load test at 100k models / 3M units with `limit=100` keeps p95 < 300 ms and flat memory; response byte size stays roughly constant as units are sold.
- **Status:** - [ ] Fixed

---

## BV-05 — Duplicate inventory-count endpoint in product-units returns zeros for quantity-based models and has the same memory blow-up

- **Severity:** S2
- **Location:** `backend/src/product-units/product-units.service.ts:146-177`
- **Evidence:**
  ```ts
    const models = await this.prisma.productModel.findMany({
      where,
      include: {
        category: { select: { id: true, name: true } },
        units: {
          select: { status: true },
        },
      },
      skip,
      take: limit,
      orderBy: { name: 'asc' },
    });

    const total = await this.prisma.productModel.count({ where });

    const data = models.map((model) => {
      const available = model.units.filter((u) => u.status === 'AVAILABLE').length;
      const reserved = model.units.filter((u) => u.status === 'RESERVED').length;
      const sold = model.units.filter((u) => u.status === 'SOLD').length;
      const damaged = model.units.filter((u) => u.status === 'DAMAGED').length;
  ```
- **Root cause:** This endpoint re-implements `StockItemsService.getInventoryCount` but only ever counts `ProductUnit` rows: it does not branch on `model.isSerialized` and never looks at `StockLot`. For a non-serialized model it therefore reports `available: 0, totalUnits: 0` no matter how much stock exists. It also loads every unit row for every model on the page (same pattern as BV-04) and runs `findMany` and `count` sequentially instead of in parallel.
- **Impact at scale:** `GET /product-units/inventory-count` is exposed to `ADMIN` and `INVENTORY` (controller lines 17-18). Any client using it instead of `/stock-items/inventory-count` sees all quantity-based stock as zero — a false stock-out that can trigger manual reordering — and the endpoint costs the same O(total lifetime units) memory as BV-04. Two divergent implementations of the same metric guarantee they drift.
- **Reproduction:** Receive 100 pieces of a non-serialized model, then `GET /product-units/inventory-count?productModelId=<id>` → `{ available: 0, reserved: 0, sold: 0, damaged: 0, totalUnits: 0 }`, while `/stock-items/inventory-count` reports `quantityRemaining: 100`.
- **Fix:** Delete this duplicate service method and controller route, or delegate: `return this.stockItemsService.getInventoryCount(params)` (inject `StockItemsService`, which `StockItemsModule` already exports). If the endpoint must stay for compatibility, implement it with the `groupBy` aggregates from BV-04 and branch on `isSerialized`.
- **Verification:** Add a contract test asserting both inventory endpoints return identical `available`/`quantityRemaining` for serialized and non-serialized fixtures; grep the frontend for `/product-units/inventory-count` and remove the call site.
- **Status:** - [ ] Fixed

---

## BV-06 — Up to 1,500 queries are fired with `Promise.all` inside one interactive transaction when receiving barcodes

- **Severity:** S2
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:108-171`
- **Evidence:**
  ```ts
      const units = await Promise.all(
        normalizedBarcodes.map((barcode) =>
          tx.productUnit.create({
            data: {
              productModelId: model.id,
              barcode,
              status: ProductUnitStatus.AVAILABLE,
              receivedDate: new Date(),
            },
          }),
        ),
      );
  ```
  followed by two more `Promise.all(units.map(...))` blocks: `tx.stockReceiptItem.create` (lines 130-139) and `tx.productUnitAuditLog.create` (lines 141-160).
- **Root cause:** `barcodes` is capped at 500 (`create-stock-receipt.dto.ts:47`), so one request issues 3 × 500 = 1,500 statements. They are all launched at once inside a single `$transaction(async (tx) => ...)` callback. Prisma interactive transactions use one pooled connection and a default 5 s timeout (`PrismaService` sets no `transactionOptions`, `backend/src/prisma/prisma.service.ts:5`), so the work is serialized on that connection while 1,500 promises are queued in memory. Any slowness (remote DB, index maintenance on `ProductUnit.barcode`) pushes the transaction past the timeout: the whole batch rolls back with P2028 and the operator must rescan everything.
- **Impact at scale:** A normal shipment of a few hundred serialized units is one of the most common write paths in this system. At ~1 ms round-trip, 1,500 statements already consume the entire 5 s budget; at 10 ms (managed Postgres) the request fails deterministically above roughly 150-200 barcodes. `Promise.all` also holds a pool connection for the full duration, so concurrent receivers exhaust the pool and unrelated requests queue behind them.
- **Reproduction:** On a DB with ≥5 ms latency, `POST /stock-receipts` with `barcodes` of 300 unique values; observe Prisma `P2028: Transaction API error: Transaction already closed` and zero rows created. With 500 barcodes, watch the single connection's query log and count 1,500 statements.
- **Fix:** Replace per-row writes with set-based writes, all in one transaction:
  ```ts
  await tx.productUnit.createMany({ data: normalizedBarcodes.map(...) });
  const created = await tx.productUnit.findMany({
    where: { barcode: { in: normalizedBarcodes } },
    select: { id: true, barcode: true },
  });
  await tx.stockReceiptItem.createMany({ data: created.map(u => ({ stockReceiptId: receipt.id, productUnitId: u.id })) });
  await tx.productUnitAuditLog.createMany({ data: created.map(u => ({ ... })) });
  ```
  That is 4-5 statements instead of 1,500. Also set an explicit `{ timeout: 15000, maxWait: 5000 }` on this transaction, and consider lowering `ArrayMaxSize` to 200 with chunked batches.
- **Verification:** Load test 500 barcodes against a 10 ms-latency DB: one transaction, ≤6 statements, p95 < 1 s, no P2028. Add an integration test asserting `productUnit.count`, `stockReceiptItem.count` and audit-log count all equal `barcodes.length`.
- **Status:** - [ ] Fixed

---

## BV-07 — `priceReceipt` is an O(n²), per-row N+1 workload inside one transaction (up to 10,000 prices)

- **Severity:** S2
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:278-373`
- **Evidence:**
  ```ts
      for (const price of prices) {
        if (price.productUnitId) {
          const receiptItem = receipt.items.find((i) => i.productUnitId === price.productUnitId);
          if (!receiptItem) {
            throw new BadRequestException({ code: 'INVALID_RECEIPT_ITEM', message: `Product unit ${price.productUnitId} not in this receipt` });
          }

          await tx.productUnit.update({
            where: { id: price.productUnitId },
            data: { purchasePrice: price.purchasePrice },
          });

          const affectedItems = await tx.invoiceItem.findMany({
  ```
- **Root cause:** Three compounding problems in one interactive transaction: (1) `receipt.items.find(...)` is a linear scan per price, so matching is O(prices × items); (2) each price does its own `productUnit.update`, `invoiceItem.findMany`, and one `invoiceItem.update` per affected invoice item; (3) the stock-lot branch does `stockConsumption.findMany`, one `update` per consumption, then `aggregate` + `findUnique` + `update` per invoice item (lines 333-371). `PriceReceiptDto` allows `ArrayMaxSize(10000)` (`price-receipt.dto.ts:40`).
- **Impact at scale:** A 10,000-row request performs ~10,000 × 10,000 = 100M in-memory comparisons (blocking the event loop for seconds) plus tens of thousands of sequential round-trips on a single pooled connection. Even a realistic 500-unit receipt issues ~1,500+ statements; a receipt with many prior sales adds several more per unit. The 5 s interactive-transaction budget (no `transactionOptions` in `PrismaService`) is exceeded, the transaction rolls back, and the admin retries the whole receipt. During the attempt one pool connection is pinned, so a few concurrent pricing jobs starve the API.
- **Reproduction:** Create a receipt with 2,000 barcodes, sell 100 of those units, then `PATCH /stock-receipts/:id/price` with 2,000 rows. Observe multi-second CPU in `Array.find`, thousands of queries in the Prisma log, and P2028 on a remote DB. With 10,000 rows the process spends ~100M comparisons before the first write.
- **Fix:** Make it set-based and chunked: build a `Map<number, item>` once for O(1) lookups; validate all ids up front; group prices by target; write purchase prices with `updateMany`/`CASE` or `createMany`-style batching; compute affected invoice-item costs in one SQL statement using `UPDATE ... FROM (SELECT ... GROUP BY "invoiceItemId")`; move COGS recomputation out of the request into a queued job keyed by invoice item id. Cap `prices` to a realistic batch (e.g. 500) and let the client submit multiple batches, each with its own short transaction.
- **Verification:** Benchmark 2,000-row pricing: statement count < 20, p95 < 1 s, no event-loop stall > 50 ms. Add a test that prices a 500-unit receipt and asserts `purchasePrice` and `costAtSale` for every unit/affected invoice item.
- **Status:** - [ ] Fixed

---

## BV-08 — Barcode uniqueness is a check-then-insert race; the loser's entire batch fails with a generic 409

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:89-106`
- **Evidence:**
  ```ts
    const existingUnits = await this.prisma.productUnit.findMany({
      where: { barcode: { in: normalizedBarcodes } },
      select: { barcode: true },
    });

    if (existingUnits.length > 0) {
      throw new ConflictException({
        code: 'BARCODE_ALREADY_REGISTERED',
        message: `These barcodes already exist: ${existingUnits.map((u) => u.barcode).join(', ')}`,
      });
    }
  ```
- **Root cause:** The duplicate check runs outside the transaction (lines 96-106) and the inserts happen later inside it (lines 108-171). Two receivers scanning the same barcode concurrently both pass the check. The database unique index (`ProductUnit_barcode`, `schema.prisma:187`) correctly rejects the second insert, but the resulting `P2002` is mapped by the global filter to a generic `409 CONFLICT` ("A record with this value already exists") with no barcode list, and the whole 500-unit batch rolls back — including the units that were not duplicates. Data integrity is preserved by the unique index; the failure mode is operational.
- **Impact at scale:** With several inventory employees scanning the same returned/duplicated shipment, or a double-submitted request, one operator loses the whole batch and has no way to know which barcode collided. Retrying re-scans everything and can collide again. The error message path is also unbounded: up to 500 barcodes are concatenated into the response.
- **Reproduction:** Fire two identical `POST /stock-receipts` requests concurrently with the same 3 barcodes. One succeeds; the other returns `409` with a generic message, `itemsCreated` lost, and no indication of which barcode caused it (the pre-check cannot catch it because both reads happen before either insert).
- **Fix:** Treat the unique index as the authority and translate the violation in the service:
  ```ts
  try {
    return await this.prisma.$transaction(...);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException({
        code: 'BARCODE_ALREADY_REGISTERED',
        message: 'One or more barcodes were registered by another receiver. Re-scan and retry.',
        barcodes: extractTargets(e),
      });
    }
    throw e;
  }
  ```
  Better: insert with `createMany({ skipDuplicates: true })`, compare `count` with `barcodes.length`, and report exactly the missing barcodes. Keep the pre-check as a fast path only.
- **Verification:** Concurrency test (two parallel requests, same barcodes) asserts exactly one 201 and one structured 409 naming the barcode; assert `ProductUnit` count is unchanged by the loser and that non-duplicate barcodes from the loser are not inserted.
- **Status:** - [ ] Fixed

---

## BV-09 — A soft-deleted product model permanently reserves its name in the category

- **Severity:** S3
- **Location:** `backend/src/product-models/product-models.service.ts:94-101,167-178`
- **Evidence:**
  ```ts
    // Check for duplicate name within category
    const existing = await this.prisma.productModel.findFirst({
      where: { categoryId: data.categoryId, name: data.name },
    });

    if (existing) {
      throw new ConflictException({ code: 'MODEL_DUPLICATE', message: 'A model with this name already exists in this category' });
    }
  ```
  ```ts
  async deactivate(id: number) {
    await this.findOne(id);

    return this.prisma.productModel.update({
      where: { id },
      data: {
        isActive: false,
        deletedAt: new Date(),
      },
  ```
- **Root cause:** `deactivate` is a soft delete, but both the explicit duplicate check and the DB constraint `@@unique([categoryId, name])` (`schema.prisma:180`) ignore `deletedAt`. `update` also refuses to touch a soft-deleted model because `findOne` throws when `model.deletedAt` is set (lines 71-73). Once a name is deactivated it can never be reused or renamed, and the 409 message ("already exists") is misleading because the model is invisible in the default listing.
- **Impact at scale:** Over years of catalog churn (100k+ products, models discontinued and reintroduced), names become a scarce, permanently consumed resource per category. Operators work around it with suffixes like "Samsung 55 (2)", fragmenting reporting and search. It also makes the duplicate check racy in the opposite direction: two concurrent creates for the same new name both pass `findFirst` and one gets a generic P2002 409.
- **Reproduction:** `POST /product-models { categoryId: 1, name: "OLED 55" }` → id X; `DELETE /product-models/X`; `POST /product-models { categoryId: 1, name: "OLED 55" }` → `409 MODEL_DUPLICATE`, although `GET /product-models` no longer shows the model.
- **Fix:** Decide the invariant explicitly. Recommended: replace the hard unique with a partial unique index and filter the app check:
  ```sql
  DROP INDEX "ProductModel_categoryId_name_key";
  CREATE UNIQUE INDEX "ProductModel_categoryId_name_active_key"
    ON "ProductModel" ("categoryId", "name") WHERE "deletedAt" IS NULL;
  ```
  and use `where: { categoryId, name, deletedAt: null }` in `create`. If the DB constraint must stay, rename on deactivate (e.g. `name = name || ' [deleted ' || id || ']'`) in the same transaction. Also catch P2002 in `create`/`update` and return a typed 409.
- **Verification:** Test deactivate → recreate with the same name succeeds and yields a different id; concurrent create test yields exactly one success and one typed 409; `SELECT` confirms at most one non-deleted model per `(categoryId, name)`.
- **Status:** - [ ] Fixed

---

## BV-10 — Pagination is uncapped and unvalidated (`limit`, `page` passed straight to Prisma)

- **Severity:** S3
- **Location:** `backend/src/stock-items/stock-items.service.ts:17-18,52-54` (same pattern in all four modules)
- **Evidence:**
  ```ts
    const { categoryId, productModelId, search, page = 1, limit = 25 } = params;
    const skip = (page - 1) * limit;
  ```
  ```ts
        skip,
        take: limit,
        orderBy: { name: 'asc' },
  ```
- **Root cause:** No service or DTO clamps `limit` or validates `page`. The controllers parse raw query strings with `parseInt` and pass `NaN`/negative/zero values through (`stock-items.controller.ts:36-37`, `stock-adjustments.controller.ts:39-40`, `stock-receipts.controller.ts:54-55,69-70`, `product-models.controller.ts:36-37`, `product-units.controller.ts:36-37`). `take: 1000000` is accepted, `skip` for a negative page becomes negative (Prisma validation error → 500), and `parseInt('abc')` → `NaN` → 500. Other modules already cap this (`customer-debts.service.ts:13` uses `Math.min(Number(params.limit), 100)`), so these four are inconsistent as well as unsafe.
- **Impact at scale:** `GET /stock-items/inventory-count?limit=1000000` combines with BV-04 to load every unit and lot for the whole catalog into one Node process (OOM / event-loop death). Even a modest `limit=5000` produces a multi-megabyte response and seconds of CPU. Deep offset paging (`page=4000` at `limit=25` over 100k models) forces Postgres to scan and discard 100k rows per request. Any authenticated role can call the stock-items inventory endpoint (no `@Roles`), so this is reachable by every user.
- **Reproduction:** `GET /product-models?limit=1000000` returns the entire catalog; `GET /stock-items/inventory-count?page=-1` returns 500; `GET /stock-adjustments?page=abc` returns 500; measure response time/memory growth as `limit` increases.
- **Fix:** Introduce one shared pagination DTO/helper and use it everywhere:
  ```ts
  export class PaginationQueryDto {
    @Type(() => Number) @IsInt() @Min(1) page = 1;
    @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  }
  ```
  Clamp in the service as defence in depth: `const take = Math.min(Math.max(1, limit || 25), 100)`. Return `400` for invalid values. For deep pages, switch the inventory/receipt listings to keyset pagination (`WHERE (name, id) > ($1, $2) ORDER BY name, id LIMIT n`).
- **Verification:** Param tests for `limit=0`, `-1`, `1001`, `abc`, `page=0` return 400 (not 500) on every listing route; load test asserts a hard cap of 100 rows and bounded memory; `EXPLAIN` shows an index scan (not a full sort) for deep pages after the keyset change.
- **Status:** - [ ] Fixed

---

## BV-11 — Product name search (`ILIKE '%term%'`) and `ORDER BY name` have no supporting index

- **Severity:** S3
- **Location:** `backend/src/stock-items/stock-items.service.ts:25-27,54` (duplicated in `product-units.service.ts:141-143,156` and `product-models.service.ts:22-24,42`)
- **Evidence:**
  ```ts
      ...(search && {
        name: { contains: search, mode: 'insensitive' },
      }),
  ```
  ```ts
        orderBy: { name: 'asc' },
  ```
- **Root cause:** Prisma compiles `contains` + `mode: 'insensitive'` to `name ILIKE '%term%'`, which no B-tree index can serve; `ProductModel` only has `@@index([categoryId, isActive])` and `@@unique([categoryId, name])` (`schema.prisma:179-180`). Without a category filter, `ORDER BY name` cannot use the `(categoryId, name)` unique index either, so Postgres sorts the entire filtered set for every page. With a category filter the unique index can help ordering but the `ILIKE` predicate still forces a scan of that category.
- **Impact at scale:** At 100k+ models each keystroke-driven search (the UI calls this endpoint as the user types) scans and sorts the whole table, then applies `OFFSET`. p95 goes from milliseconds to hundreds of ms and the DB CPU is dominated by these scans; concurrent searches stack up. The same pattern exists on three endpoints, so the load is multiplied.
- **Reproduction:** Seed 200k `ProductModel` rows; `EXPLAIN (ANALYZE, BUFFERS) SELECT ... WHERE name ILIKE '%board%' ORDER BY name LIMIT 25 OFFSET 0` shows a seq scan + external sort over all rows; call `GET /product-models?search=board` and observe latency scaling linearly with table size.
- **Fix:** Add a trigram index for substring search and a B-tree for ordering:
  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX "ProductModel_name_trgm_idx" ON "ProductModel" USING GIN (lower(name) gin_trgm_ops);
  CREATE INDEX "ProductModel_active_name_idx" ON "ProductModel" ("isActive", "deletedAt", name);
  ```
  Query with `lower(name) LIKE lower('%' || $1 || '%')` (or `similarity`) so the GIN index is used; keep prefix search (`startsWith`) for the fast path. If full-text semantics are needed, use a `tsvector` column. Also cap `search` length (e.g. 100 chars) to avoid pathological patterns.
- **Verification:** `EXPLAIN` shows a Bitmap Index Scan on the GIN index and no full sort for the active-name index; p95 for `search=` stays < 100 ms at 200k rows; add a test that search is case-insensitive and matches substrings.
- **Status:** - [ ] Fixed

---

## BV-12 — Every inventory page aggregates the model's entire adjustment history

- **Severity:** S3
- **Location:** `backend/src/stock-items/stock-items.service.ts:63-86`
- **Evidence:**
  ```ts
    const reductionTotals = modelIds.length
      ? await this.prisma.stockAdjustment.groupBy({
          by: ['productModelId', 'type'],
          where: {
            productModelId: { in: modelIds },
            status: AdjustmentReviewStatus.APPROVED,
            quantity: { lt: 0 },
          },
          _sum: { quantity: true },
        })
      : [];
  ```
  (and the mirrored `additionTotals` query immediately after)
- **Root cause:** The two `groupBy` calls are unbounded in time and scan all approved adjustments for the 25 models on the page. The only relevant index is `@@index([productModelId, createdAt])` (`schema.prisma:305`); `status` and the sign of `quantity` are not in the index, so every row for those models is read and filtered. There is no date window and no denormalized counter.
- **Impact at scale:** A model that has been adjusted weekly for years has thousands of rows; a page of 25 such models aggregates ~100k rows on every inventory refresh, twice. At 100k models and millions of adjustments this becomes a top DB cost and grows forever, even though the UI only shows lifetime totals that change rarely.
- **Reproduction:** Insert 200k approved `StockAdjustment` rows across 25 models, then `GET /stock-items/inventory-count?limit=25`; `EXPLAIN (ANALYZE)` shows a scan of all 200k rows for each groupBy and latency grows linearly with history length.
- **Fix:** Maintain the totals where they are written, or bound the query:
  - Add `@@index([productModelId, status, type])` and optionally `quantity` so the groupBy is index-only for the 25 ids.
  - Better: store `totalReduced`/`totalAdded` (and per-type counters) on `ProductModel`, updated in `approveAdjustment` inside the same transaction; the list endpoint then reads one column.
  - If lifetime totals are not required, add a `from`/`to` window (e.g. last 12 months) and index `(productModelId, status, createdAt)`.
- **Verification:** After the change, `EXPLAIN` for the inventory page touches only the 25 model rows (or an index-only scan of the composite index); a reconciliation test asserts the denormalized counters equal `SUM(quantity)` of approved adjustments after approve/reject sequences.
- **Status:** - [ ] Fixed

---

## BV-13 — Money is computed with JavaScript floats before being stored as `Decimal(18,2)`

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:307-318,340-348,362-369`
- **Evidence:**
  ```ts
          for (const invoiceItem of affectedItems) {
            const purchasePrices = invoiceItem.unitAssignments.map((assignment) => assignment.productUnit.purchasePrice);
            const hasPendingCost = purchasePrices.some((purchasePrice) => purchasePrice === null);
            const totalCost = purchasePrices.reduce((sum, purchasePrice) => sum + Number(purchasePrice || 0), 0);
            await tx.invoiceItem.update({
              where: { id: invoiceItem.id },
              data: {
                costAtSale: hasPendingCost ? null : totalCost / invoiceItem.quantity,
                cogsStatus: hasPendingCost ? 'PENDING' : 'FINAL',
              },
            });
          }
  ```
  ```ts
            const totalCost = Number(price.purchasePrice) * consumption.quantity;
  ```
  ```ts
                  costAtSale: Number(agg._sum.totalCost) / (invoiceItem.quantity || 1),
  ```
- **Root cause:** The schema stores money as `Decimal(18,2)` (`schema.prisma:190,260,279-280`), but the service converts decimals to IEEE-754 doubles (`Number(...)`), multiplies/divides/sums in floating point, and hands the result back to Prisma. `quantity` is also `Float` (`schema.prisma:278`), and `price.purchasePrice` is an unrounded `number` from the DTO. Binary floating point cannot represent most decimal fractions; `Decimal(18,2)` then rounds whatever imprecision survives.
- **Impact at scale:** Per-row errors are sub-cent, but `costAtSale` is divided per unit and multiplied back over millions of invoice items, so rounding drift accumulates into visible COGS/margin discrepancies and non-reproducible totals (sum of item costs ≠ invoice total). Because `StockConsumption.totalCost` is also computed this way, re-pricing a receipt can change historical COGS by a cent or two, which breaks audit reconciliation. `0.1 * 3` style artifacts are easy to demonstrate.
- **Reproduction:** Price a lot at `0.1` with `quantity: 3` → `totalCost` is `0.30000000000000004` before the DB rounds to `0.30`; price three units at `0.1` each and compare `SUM(StockConsumption.totalCost)` with the invoice-level total computed independently. Re-run the same pricing request and observe a different stored `costAtSale` in some combinations.
- **Fix:** Use `Prisma.Decimal` end to end:
  ```ts
  const price = new Prisma.Decimal(priceDto.purchasePrice).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  const totalCost = price.mul(consumption.quantity);
  const costAtSale = totalCost.div(invoiceItem.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  ```
  Round only at the storage boundary and define the rounding mode once. Prefer computing aggregates in SQL (`SUM(totalCost)`) which already returns `Decimal`. Add `@IsNumber({ maxDecimalPlaces: 2 })` to `purchasePrice` in `PriceReceiptItemDto`.
- **Verification:** Property test: for random prices/quantities, `Decimal` result equals the independently computed exact value and `sum(item costs)` equals the invoice total within one cent; assert no `Number(` conversions remain in the pricing path (`grep -n "Number(" stock-receipts.service.ts`).
- **Status:** - [ ] Fixed

---

## BV-14 — COGS is marked `FINAL` for an invoice item while other lots consumed by that item are still unpriced

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:352-370`
- **Evidence:**
  ```ts
          // Recalculate costAtSale on affected InvoiceItems
          const affectedInvoiceItemIds = [...new Set(consumptions.map((c) => c.invoiceItemId))];
          for (const invoiceItemId of affectedInvoiceItemIds) {
            const agg = await tx.stockConsumption.aggregate({
              where: { invoiceItemId },
              _sum: { totalCost: true },
            });
            const invoiceItem = await tx.invoiceItem.findUnique({
              where: { id: invoiceItemId },
              select: { quantity: true },
            });
            if (invoiceItem && agg._sum?.totalCost) {
              await tx.invoiceItem.update({
                where: { id: invoiceItemId },
                data: {
                  costAtSale: Number(agg._sum.totalCost) / (invoiceItem.quantity || 1),
                  cogsStatus: 'FINAL',
                },
              });
            }
          }
  ```
- **Root cause:** `affectedInvoiceItemIds` comes only from the consumptions just priced for **this** lot. The aggregate sums `totalCost` over all consumptions of the invoice item, but unpriced consumptions contribute `NULL` (ignored by `SUM`) rather than making the result `NULL`. The code then sets `cogsStatus: 'FINAL'` unconditionally, unlike the unit branch above (lines 308-316) which checks `hasPendingCost`. If an invoice item consumed from lot A (this receipt) and lot B (a still-unpriced receipt), pricing A finalizes COGS using only A's cost.
- **Impact at scale:** Multi-lot invoices are normal for quantity-based products (FIFO across receipts). Their COGS is understated and flagged `FINAL`, so downstream margin/valuation reports trust it and no "pending cost" alert fires. It self-heals only if and when the other receipt is priced; if that receipt is never priced (or was priced through a path that does not touch this invoice item), the understatement is permanent.
- **Reproduction:** Receive lot A (10 units) and lot B (10 units) for the same model, sell 15 units (consumes 10 from A, 5 from B), price only receipt A → the invoice item gets `cogsStatus: 'FINAL'` and `costAtSale` based on 10 units' cost while 5 units still have `unitCost = NULL`. `GET` the invoice and compare with `SUM(StockConsumption.totalCost)`.
- **Fix:** Determine pending state explicitly and keep the item `PENDING` until all its consumptions are priced:
  ```ts
  const pending = await tx.stockConsumption.count({
    where: { invoiceItemId, unitCost: null },
  });
  const totalCost = agg._sum.totalCost ?? new Prisma.Decimal(0);
  await tx.invoiceItem.update({
    where: { id: invoiceItemId },
    data: {
      costAtSale: pending > 0 ? null : totalCost.div(invoiceItem.quantity),
      cogsStatus: pending > 0 ? 'PENDING' : 'FINAL',
    },
  });
  ```
  Do this for every affected item even when `_sum.totalCost` is null/zero (drop the truthiness guard).
- **Verification:** Test the A/B scenario above and assert `cogsStatus === 'PENDING'` and `costAtSale === null` after pricing only A; after pricing B assert `FINAL` and `costAtSale === (costA + costB) / quantity`. Add a DB invariant check: no `InvoiceItem` with `cogsStatus = 'FINAL'` has a consumption with `unitCost IS NULL`.
- **Status:** - [ ] Fixed

---

## BV-15 — Unit status change and its audit log are two separate transactions

- **Severity:** S3
- **Location:** `backend/src/product-units/product-units.service.ts:215-248,282-315`
- **Evidence:**
  ```ts
    if (result.count === 0) {
      throw new BadRequestException({
        code: 'CONFLICT',
        message: 'Unit status changed by another operation. Please try again.',
      });
    }

    // Write audit log
    await this.prisma.productUnitAuditLog.create({
      data: {
        productUnitId: unitId,
        action: 'MARKED_DAMAGED',
        employeeId,
        notes: `Marked as damaged by inventory employee`,
        metadata: {
          modelName: unit.productModel.name,
          barcode: unit.barcode,
          from: 'AVAILABLE',
          to: 'DAMAGED',
        },
      },
    });
  ```
  (`restoreAvailable` has the identical shape at lines 282-315.)
- **Root cause:** `updateMany` commits the status transition, then `productUnitAuditLog.create` runs as a separate statement/transaction. There is no `$transaction` wrapper, so a failure between the two (connection drop, audit-log constraint, process restart) leaves a unit whose status changed with no audit trail — or, with retries, two audit rows. The version check protects against concurrent status changes but not against this atomicity gap.
- **Impact at scale:** Inventory auditability is the whole point of `ProductUnitAuditLog` (who damaged/restored a unit, when). Under load, transient DB errors are exactly when this gap opens, and it silently produces untraceable stock discrepancies. Reconciliation between `ProductUnit.status = DAMAGED` and the audit log will not balance, and damage/loss reporting (BV-12) drifts from reality.
- **Reproduction:** Wrap the audit-log insert with a mock that throws once (or kill the connection between the two calls); `PATCH /product-units/:id/mark-damaged` returns 500, but `GET /product-units/barcode/:barcode` shows `DAMAGED` and `GET .../audit-log` is empty.
- **Fix:**
  ```ts
  return this.prisma.$transaction(async (tx) => {
    const result = await tx.productUnit.updateMany({ where: { id: unitId, status: AVAILABLE, version: unit.version }, data: { ... } });
    if (result.count !== 1) throw new BadRequestException({ code: 'CONFLICT', ... });
    await tx.productUnitAuditLog.create({ data: { ... } });
    return tx.productUnit.findUnique({ where: { id: unitId }, include: { productModel: ... } });
  });
  ```
  Keep the pre-read outside only for the error messages, or move it inside with `SELECT ... FOR UPDATE`.
- **Verification:** Fault-injection test: make the audit insert fail and assert the unit status is unchanged and no audit row exists. Invariant query returns zero:
  ```sql
  SELECT u.id FROM "ProductUnit" u
  WHERE u.status = 'DAMAGED'
    AND NOT EXISTS (SELECT 1 FROM "ProductUnitAuditLog" l WHERE l."productUnitId" = u.id AND l.action = 'MARKED_DAMAGED');
  ```
- **Status:** - [ ] Fixed

---

## BV-16 — Receipt lists load all item ids and all lots per receipt, then reduce in JavaScript

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:515-540`
- **Evidence:**
  ```ts
      this.prisma.stockReceipt.findMany({
        where,
        include: {
          employee: { select: { id: true, name: true } },
          supplier: { select: { id: true, name: true } },
          items: { select: { id: true } },
          stockLots: { select: { id: true, quantityReceived: true } },
        },
        skip,
        take: limit,
        orderBy: { date: 'desc' },
      }),
      this.prisma.stockReceipt.count({ where }),
    ]);

    return {
      data: data.map((r) => ({
        ...r,
        itemCount: r.items.length,
        totalQuantity: r.stockLots.length > 0
          ? r.stockLots.reduce((sum, lot) => sum + lot.quantityReceived, 0)
          : r.items.length,
        items: undefined,
        stockLots: undefined,
      })),
  ```
- **Root cause:** Prisma has no N+1 here, but it does over-fetch: every `StockReceiptItem.id` and every `StockLot` row is transferred to Node just to compute a count and a sum, then discarded (`items: undefined`). The receipt detail (`findOne`, lines 462-489) and `findPendingPricing` (lines 405-449) similarly include every item/lot unbounded. `totalQuantity` also has inconsistent semantics: it falls back to `items.length` only when there are no lots, so a mixed/legacy receipt reports a unit count instead of a quantity.
- **Impact at scale:** A receipt can hold up to 500 units (DTO cap) and a non-serialized model accumulates lots per receipt; 25 receipts × hundreds of rows per list page is pure waste on every admin list load. With historical data (hundreds of thousands of receipts) and `limit` uncapped (BV-10), this becomes megabytes per request. The mixed-receipt fallback silently reports the wrong total.
- **Reproduction:** Create 25 receipts with 500 items each; `GET /stock-receipts?limit=25` transfers 12,500 item rows + lots and returns only two derived numbers. Measure response size and DB buffers; compare with `_count`/`groupBy`.
- **Fix:** Push aggregation into SQL:
  ```ts
  const [data, total] = await Promise.all([
    this.prisma.stockReceipt.findMany({
      where,
      select: {
        id: true, date: true, status: true, employeeId: true,
        employee: { select: { id: true, name: true } },
        supplier: { select: { id: true, name: true } },
        _count: { select: { items: true, stockLots: true } },
        stockLots: { select: { quantityReceived: true } }, // or a groupBy below
      },
      skip, take: limit, orderBy: { date: 'desc' },
    }),
    this.prisma.stockReceipt.count({ where }),
  ]);
  ```
  and fetch `SUM(quantityReceived)` grouped by `stockReceiptId` in one `groupBy` for the page's ids. For `findOne`/`findPendingPricing`, paginate the items/lots or add dedicated sub-resource endpoints.
- **Verification:** `EXPLAIN` shows aggregate/count subqueries instead of row transfer; response payload for the 25×500 fixture shrinks by >95%; test asserts `totalQuantity` equals `SUM(StockLot.quantityReceived)` for serialized, non-serialized and mixed receipts.
- **Status:** - [ ] Fixed

---

## BV-17 — A quick-created supplier is committed before the receipt transaction, leaving orphans on failure

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:47-55`
- **Evidence:**
  ```ts
    if (data.newSupplierName) {
      if (supplierId) {
        throw new BadRequestException({ code: 'CONFLICTING_SUPPLIER', message: 'Provide either supplierId or newSupplierName, not both' });
      }
      const newSupplier = await this.prisma.supplier.create({
        data: { name: data.newSupplierName, isActive: true },
      });
      supplierId = newSupplier.id;
    }
  ```
- **Root cause:** The supplier is created with the root Prisma client, outside the `$transaction` that creates the receipt/units/lots (lines 108-171 and 210-235). Any subsequent failure — duplicate barcode (BV-08), transaction timeout (BV-06), validation of barcodes, or a crash — rolls back the receipt but leaves the supplier committed. There is no uniqueness constraint on `Supplier.name` (`schema.prisma:203-217`), so repeated failures accumulate duplicate suppliers.
- **Impact at scale:** In a busy receiving area, retries after a failed scan batch create one orphan supplier per attempt, polluting supplier dropdowns and reporting. With no unique name, the same supplier appears dozens of times and stock is attributed inconsistently across them.
- **Reproduction:** `POST /stock-receipts` with `newSupplierName: "Acme"` and a barcode that already exists → 409; `GET /suppliers` shows "Acme" although no receipt was created. Repeat → multiple "Acme" rows.
- **Fix:** Create the supplier inside the same transaction:
  ```ts
  const transactionResult = await this.prisma.$transaction(async (tx) => {
    const supplier = data.newSupplierName
      ? await tx.supplier.create({ data: { name: data.newSupplierName.trim(), isActive: true } })
      : await tx.supplier.findFirstOrThrow({ where: { id: data.supplierId, isActive: true, deletedAt: null } });
    ...
  });
  ```
  Validate the model/category/barcodes before opening the transaction, and add a case-insensitive unique index on `lower(name)` for suppliers (or use `upsert`).
- **Verification:** Test: invalid/duplicate barcode + `newSupplierName` → 409 and `supplier.count()` unchanged. Concurrent same-name tests produce exactly one supplier after adding the unique index.
- **Status:** - [ ] Fixed

---

## BV-18 — Two concurrent `priceReceipt` calls can both run because status is checked outside the transaction

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/stock-receipts.service.ts:261-276,375-382`
- **Evidence:**
  ```ts
    const receipt = await this.prisma.stockReceipt.findUnique({
      where: { id: receiptId },
      include: {
        items: true,
        stockLots: true,
      },
    });

    if (!receipt) {
      throw new NotFoundException({ code: 'RECEIPT_NOT_FOUND', message: 'Receipt not found' });
    }

    if (receipt.status !== StockReceiptStatus.PENDING_PRICING) {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: 'Receipt is not in PENDING_PRICING status' });
    }
  ```
  ```ts
      await tx.stockReceipt.update({
        where: { id: receiptId },
        data: {
          status: StockReceiptStatus.PRICED,
  ```
- **Root cause:** The guard is a read outside the transaction and the final write is an unconditional `update` by id. There is no compare-and-set (`updateMany` with `status: PENDING_PRICING`) and no row lock. Two admins (or a double-click) both pass the check and both execute the whole pricing loop; the second overwrites the first's prices and re-runs COGS recalculation.
- **Impact at scale:** Double submissions are common on slow pricing requests (BV-07), and the second run holds a second pool connection for the full duration. With different prices, the final state depends on interleaving; `pricedAt`/`pricedBy` flip to the last writer, and notifications/realtime events fire twice. It also defeats the "receipt already priced" protection exactly when the request is slow enough that users retry.
- **Reproduction:** Send two identical `PATCH /stock-receipts/:id/price` requests in parallel; both return 200, both write `pricedByEmployeeId`, and the Prisma log shows the full pricing loop twice.
- **Fix:** Claim the receipt atomically at the start of the transaction:
  ```ts
  const claimed = await tx.stockReceipt.updateMany({
    where: { id: receiptId, status: StockReceiptStatus.PENDING_PRICING },
    data: { status: StockReceiptStatus.PRICING }, // or keep PENDING and use a lock column
  });
  if (claimed.count !== 1) throw new ConflictException({ code: 'RECEIPT_ALREADY_PRICED' });
  ```
  then do the work and set `PRICED` at the end. Alternatively `SELECT ... FOR UPDATE` the receipt row as the first statement. Keep the pre-check for a friendly early error.
- **Verification:** Parallel-request test asserts exactly one 200 and one 409, and that each unit's `purchasePrice`/`costAtSale` reflects exactly one pricing run.
- **Status:** - [ ] Fixed

---

## BV-19 — A reduction adjustment is impossible when no single lot holds the whole amount

- **Severity:** S3
- **Location:** `backend/src/stock-items/stock-items.service.ts:261-279`
- **Evidence:**
  ```ts
    if (signedQuantity < 0) {
      const lot = await this.prisma.stockLot.findFirst({
        where: { productModelId, quantityRemaining: { gte: Math.abs(signedQuantity) } },
        orderBy: { receivedDate: 'asc' },
      });

      if (!lot) {
        throw new BadRequestException({
          code: 'NO_SINGLE_LOT_SUFFICIENT',
          message: 'No single stock lot holds enough remaining quantity for this reduction. Specify stockLotId manually, or split the adjustment across lots.',
        });
      }

      return lot;
    }
  ```
- **Root cause:** FIFO allocation is not implemented for reductions: the code searches for one lot whose remaining quantity alone covers the entire adjustment. Stock is normally spread across many receipts, so `quantityRemaining >= amount` frequently fails even when the model's total available stock is sufficient. The API then demands a manual `stockLotId` or a manual split, neither of which the inventory UI necessarily exposes.
- **Impact at scale:** Damage/loss/count corrections are the core of inventory reconciliation. As soon as a product has been received more than once (i.e. almost always), a write-off larger than the oldest lot's remainder is rejected. Operators either cannot record the loss (stock stays overstated) or pick an arbitrary lot, making per-lot cost and remaining quantity diverge from physical reality. This also interacts with BV-02: reports cannot be reconciled because adjustments are under-recorded.
- **Reproduction:** Receive 5 units (lot A), then 5 units (lot B) of the same model. `POST /stock-adjustments { type: "DAMAGE", quantity: 8 }` with no `stockLotId` → 400 `NO_SINGLE_LOT_SUFFICIENT`, although 10 units exist. Only `quantity <= 5` succeeds.
- **Fix:** Allocate across lots FIFO. Either create one `StockAdjustment` per lot in a transaction (parent `StockAdjustment` + child allocation rows), or add `StockAdjustmentAllocation(stockAdjustmentId, stockLotId, quantity)` and decrement each lot with the same conditional `updateMany` guard used in `approveAdjustment`:
  ```ts
  for (const lot of lotsFifo) {
    const take = Math.min(lot.quantityRemaining, remaining);
    const res = await tx.stockLot.updateMany({
      where: { id: lot.id, quantityRemaining: { gte: take } },
      data: { quantityRemaining: { decrement: take } },
    });
    if (res.count !== 1) throw new ConflictException({ code: 'STOCK_CHANGED' });
    remaining -= take;
    if (remaining <= 0) break;
  }
  ```
  Approve the adjustment only if the full amount was allocated; otherwise roll back.
- **Verification:** Test the 5+5 / damage 8 scenario: succeeds, decrements lot A by 5 and lot B by 3, and `SUM(quantityRemaining)` drops by 8; reject path leaves both lots untouched; concurrent approvals cannot drive any lot below `quantityReserved`.
- **Status:** - [ ] Fixed

---

## BV-20 — Redundant B-tree index on `ProductUnit.barcode` duplicates the unique index

- **Severity:** S4
- **Location:** `backend/prisma/schema.prisma:187,200`
- **Evidence:**
  ```prisma
  barcode            String                   @unique
  ```
  ```prisma
  @@index([barcode])
  ```
- **Root cause:** `@unique` already creates a unique B-tree index (`ProductUnit_barcode_key`, confirmed in `backend/prisma/migrations/20260915231159_init/migration.sql:355`), and `@@index([barcode])` creates a second, identical non-unique index (`...:364`). Both are maintained on every insert/update.
- **Impact at scale:** Every barcode write pays double index maintenance, and the duplicate index consumes disk/RAM proportional to the unit table (millions of rows). Barcode writes are the hot path during receiving (BV-06), so the cost is paid exactly where latency matters. It also confuses index-usage analysis.
- **Reproduction:** `\d "ProductUnit"` in psql shows both `ProductUnit_barcode_key` (unique) and `ProductUnit_barcode_idx`; `EXPLAIN` of a barcode lookup picks one arbitrarily. Compare insert timing with the extra index dropped.
- **Fix:** Remove `@@index([barcode])` from the schema and add a migration:
  ```sql
  DROP INDEX IF EXISTS "ProductUnit_barcode_idx";
  ```
  Keep only the unique index.
- **Verification:** `\d "ProductUnit"` lists exactly one barcode index; `prisma migrate diff` is clean; barcode lookup still uses an index scan.
- **Status:** - [ ] Fixed

---

## BV-21 — Unit audit-log endpoint returns the entire history with no pagination

- **Severity:** S4
- **Location:** `backend/src/product-units/product-units.service.ts:113-121`
- **Evidence:**
  ```ts
    return this.prisma.productUnitAuditLog.findMany({
      where: { productUnitId: unit.id },
      include: {
        employee: { select: { id: true, name: true } },
        invoice: { select: { id: true, invoiceNumber: true } },
      },
      orderBy: { timestamp: 'asc' },
    });
  ```
- **Root cause:** No `take`/`skip`/cursor. Every lifecycle event for the unit (received, reserved, sold, returned, damaged, restored, …) is returned. The endpoint is also called through two routes (`barcode/:barcode/audit-log` and `:id/audit`, controller lines 48-61), and the `:id/audit` route does an extra `findById` query first.
- **Impact at scale:** A long-lived unit that has been returned and resold many times accumulates a large history; the response is unbounded and includes joined employee/invoice data. It is not the dominant cost, but it is an unbounded query exposed to SALES as well as ADMIN/INVENTORY, and it violates the pagination contract used elsewhere.
- **Reproduction:** Insert 5,000 audit rows for one unit; `GET /product-units/barcode/<barcode>/audit-log` returns all 5,000 in one response and takes proportionally longer.
- **Fix:** Add `page`/`limit` (cap 100) or a cursor (`before` timestamp/id) to `getAuditLog`, and have `:id/audit` pass the id directly instead of resolving the barcode:
  ```ts
  const take = Math.min(Math.max(1, limit ?? 50), 100);
  return this.prisma.productUnitAuditLog.findMany({
    where: { productUnitId, ...(cursor && { id: { lt: cursor } }) },
    orderBy: { id: 'desc' }, take,
    include: { ... },
  });
  ```
- **Verification:** Test asserts default page size and that a unit with 5,000 rows returns at most 100; response time is flat regardless of history length.
- **Status:** - [ ] Fixed

---

## BV-22 — Barcode is validated before normalization, so whitespace-only values become an empty barcode; length is unbounded

- **Severity:** S3
- **Location:** `backend/src/stock-receipts/dto/create-stock-receipt.dto.ts:44-50` (normalization at `stock-receipts.service.ts:16-21,89`)
- **Evidence:**
  ```ts
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  barcodes?: string[];
  ```
  ```ts
  normalizeBarcode(barcode: string): string {
    return barcode
      .trim()
      .replace(/[\r\n\t]/g, '')
      .replace(/\s+/g, '');
  }
  ```
- **Root cause:** Validation runs on the raw string (`@MinLength(1)`), then the service strips all whitespace. A value like `" "` or `"\t"` passes validation and normalizes to `""`, which is then inserted as a real barcode (the column is `@unique` but not `NOT EMPTY`). There is also no `@MaxLength`: a multi-kilobyte barcode is accepted by the DTO and only fails later at the B-tree index (Postgres rejects index rows above ~2704 bytes with an error mapped to a 500). `product-units.service.ts:12-17` has the same normalizer and no length guard on lookups.
- **Impact at scale:** One empty barcode poisons the namespace: every subsequent whitespace-only scan collides with it, and any scanner emitting a blank line can never be received again. Oversized barcodes fail the whole batch after the receipt row is created (rolled back, but with an opaque 500), and the error is not actionable. At 100k+ units, barcode hygiene is critical for scanning throughput.
- **Reproduction:** `POST /stock-receipts` with `barcodes: [" "]` → 201, and `GET /product-units/barcode/%20` returns a unit whose `barcode` is `""`. Send a 5,000-character barcode → 500 from the unique-index insert. Send a second `" "` → 409.
- **Fix:** Normalize in a transform, then validate the normalized value:
  ```ts
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/[\r\n\t]/g, '').replace(/\s+/g, '') : value)
  @IsString({ each: true })
  @Matches(/^[\x21-\x7E]{1,128}$/, { each: true, message: 'barcode must be 1-128 printable characters' })
  barcodes?: string[];
  ```
  Apply the same normalizer to `product-units` lookups (a normalized empty string should be rejected before querying). Add a check constraint `barcode <> ''` and consider `varchar(128)` in the schema.
- **Verification:** Tests: `" "`, `"\t"`, `""` → 400; 129-char barcode → 400; valid 1-128 char barcode → 201; `SELECT count(*) FROM "ProductUnit" WHERE barcode = ''` is 0.
- **Status:** - [ ] Fixed

---

## BV-23 — Missing composite indexes for the pending-pricing listing and the FIFO lot lookup

- **Severity:** S4
- **Location:** `backend/prisma/schema.prisma:234-236,267-269`
- **Evidence:**
  ```prisma
  @@index([date])
  @@index([employeeId, date])
  @@index([status])
  ```
  ```prisma
  @@index([productModelId])
  @@index([stockReceiptId])
  @@index([supplierId])
  ```
- **Root cause:** `findPendingPricing` filters `status = PENDING_PRICING` and orders by `date ASC` (`stock-receipts.service.ts:403,446`); the separate `status` and `date` indexes force Postgres to fetch all pending rows and sort them. `resolveStockLot` filters `productModelId` + `quantityRemaining >= x` and orders by `receivedDate ASC` (`stock-items.service.ts:266-269,281-284`); the single-column `productModelId` index returns all lots of the model for a sort, and the aggregate in BV-04 also scans them.
- **Impact at scale:** Pending receipts and lot counts per model are small today, so this is polish rather than a break. At millions of receipts and thousands of lots per popular model, the sorts show up in the pricing queue and in every adjustment; the composite indexes are cheap to add and make the plans stable.
- **Reproduction:** `EXPLAIN (ANALYZE) SELECT * FROM "StockReceipt" WHERE status='PENDING_PRICING' ORDER BY date LIMIT 25` shows a sort; `EXPLAIN` of the FIFO `findFirst` shows a sort over the model's lots.
- **Fix:**
  ```prisma
  // StockReceipt
  @@index([status, date])

  // StockLot
  @@index([productModelId, receivedDate])
  ```
  Consider `@@index([productModelId, quantityRemaining])` if the `gte` filter remains, or fold `receivedDate` into the existing `productModelId` index.
- **Verification:** `EXPLAIN` shows index scans without a Sort node for both queries; `prisma migrate diff` is clean.
- **Status:** - [ ] Fixed

---

## BV-24 — Duplicate adjustment-creation endpoints with different role rules

- **Severity:** S4
- **Location:** `backend/src/stock-items/stock-items.controller.ts:41-49` vs `backend/src/stock-items/stock-adjustments.controller.ts:46-54`
- **Evidence:**
  ```ts
  @Post('adjustments')
  @Roles(Role.INVENTORY)
  @ApiOperation({ summary: 'Create stock adjustment (Inventory only)' })
  async createAdjustment(
    @Request() req: RequestWithUser,
    @Body() body: CreateStockAdjustmentDto,
  ) {
    return this.stockItemsService.createAdjustment(req.user.sub, body);
  }
  ```
  ```ts
    @Post()
    @Roles(Role.INVENTORY, Role.ADMIN)
    @ApiOperation({ summary: 'Submit stock adjustment for review (Inventory/Admin)' })
    async create(
      @Request() req: RequestWithUser,
      @Body() body: CreateStockAdjustmentDto,
    ) {
      return this.stockItemsService.createAdjustment(req.user.sub, body);
    }
  ```
- **Root cause:** The same operation is exposed at `POST /stock-items/adjustments` (INVENTORY only) and `POST /stock-adjustments` (INVENTORY and ADMIN), with different Swagger tags/summaries. Nothing marks one as deprecated.
- **Impact at scale:** Not a scale issue, but it doubles the API surface, splits client usage, and creates a real authorization inconsistency: an ADMIN calling `/stock-items/adjustments` is rejected while the same payload at `/stock-adjustments` is accepted. Future validation/rate-limiting changes must be applied twice and can silently diverge.
- **Reproduction:** `POST /stock-items/adjustments` as ADMIN → 403; identical body to `POST /stock-adjustments` as ADMIN → 201.
- **Fix:** Keep one route. Delete the `@Post('adjustments')` handler from `StockItemsController` (or mark it `@ApiDeprecation` and delegate), and align the role decorator with the intended policy on the remaining route.
- **Verification:** OpenAPI spec lists only one adjustment-creation path; a test matrix (INVENTORY/ADMIN/other) passes identically on the single route; grep for `/stock-items/adjustments` in clients.
- **Status:** - [ ] Fixed

---
