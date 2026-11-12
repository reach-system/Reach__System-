# Findings — invoice change requests & customer debts

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `backend/src/invoice-change-requests/invoice-change-requests.service.ts` | 1526 | complete |
| `backend/src/invoice-change-requests/invoice-change-requests.controller.ts` | 104 | complete |
| `backend/src/invoice-change-requests/invoice-change-requests.module.ts` | 14 | complete |
| `backend/src/invoice-change-requests/invoice-change-requests.service.spec.ts` | 1246 | complete |
| `backend/src/invoice-change-requests/dto/invoice-change-request.types.ts` | 118 | complete |
| `backend/src/customer-debts/customer-debts.service.ts` | 141 | complete |
| `backend/src/customer-debts/customer-debts.controller.ts` | 80 | complete |
| `backend/src/customer-debts/customer-debts.module.ts` | 9 | complete |
| `backend/src/customer-debts/dto/create-debt-movement.dto.ts` | 26 | complete |

---

## BC-01 — Refund ratio is recomputed from an already-refunded `currentTotal`, so every return after the first is under-refunded

- **Severity:** S1
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:844-855`
- **Evidence:**
  ```ts
      const currentTotal = Number(pricing.currentTotal);
      // Share of each list-price unit that the customer actually paid after discounts.
      const paymentRatio = adjustedSubtotal > 0 ? currentTotal / adjustedSubtotal : 0;
  ```
  ```ts
        const refundAmount = round2(effectivePrice * paymentRatio * plan.quantity);
  ```
- **Root cause:** `adjustedSubtotal` is the immutable sum of *all* invoice lines (`effectivePrice * item.quantity`, lines 836-843), but `currentTotal` is the *mutable* running total that line 937 already decremented by every previous refund. The ratio therefore falls by the refunded share on each approval: it is `paid/subtotal` only on the first return. The denominator is never reduced to the still-returnable quantity, so the ratio is not invariant across returns.
- **Impact at scale:** Systematic under-refund of every partial return after the first, on every invoice, for the life of the system. With 5M invoices and normal partial-return traffic this is a persistent, silent money leak: the customer is refunded less than they paid while `currentTotal` (accounts receivable) is also reduced by the smaller amount, so the ledger stays internally consistent and no reconciliation alert fires. A fully returned invoice that had an earlier partial return ends with `refundTotal < paid` and `currentTotal > 0` — the customer is left owing money for goods they returned.
- **Reproduction:** Invoice `INV-1`: 2 × 100 = 200, no discount, `currentTotal = 200`.
  1. Approve a return of 1 unit → `paymentRatio = 200/200 = 1` → refund 100, `currentTotal = 100`.
  2. Create and approve a second change request returning the last unit → `paymentRatio = 100/200 = 0.5` → refund **50** instead of 100, `currentTotal = 50`.
  3. Customer paid 200, received 150, and still "owes" 50 with zero goods. A third return is impossible, so the 50 is uncollectable and unrecoverable.
  With a 10% invoice discount (paid 180): first return refunds 90, second refunds 45 instead of 90.
- **Fix:** Make the ratio invariant. Either (a) persist the invoice-level discount factor at confirmation (`discountFactor = currentTotal / adjustedSubtotal` stored on `Invoice`) and use it for every refund, or (b) compute the denominator over the *not-yet-returned* quantity: `remainingSubtotal = Σ effectivePrice × (item.quantity − alreadyReturnedQty(item))` for the lines still open, then `ratio = currentTotal / remainingSubtotal`. Both give `refund = effectivePrice × discountFactor × qty` for every return. Add a regression test that approves two sequential partial returns and asserts the total refund equals the amount paid.
- **Verification:** Add a spec that runs two `approveReturnTransaction` calls against the same invoice (200 → 100 → 100) and asserts `refundTotal` is 100 on both and the final `currentTotal` is 0. Replay on staging: `SELECT sum(refund_total), (SELECT original_total FROM "Invoice" WHERE id = X) FROM "InvoiceReturn" WHERE "invoiceId" = X` must match for fully returned invoices.
- **Status:** - [ ] Fixed

---

## BC-02 — `restoreNonSerializedStock` fallback credits 1 unit per lot (not per quantity) and ignores lot capacity

- **Severity:** S1
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1077-1091`
- **Evidence:**
  ```ts
    // Fallback: place any leftover quantity on recent lots of the same model.
    if (remaining > 0) {
      const lots = await tx.stockLot.findMany({
        where: { productModelId },
        orderBy: { createdAt: 'desc' },
      });
      for (const lot of lots) {
        if (remaining <= 0) break;
        await tx.stockLot.update({
          where: { id: lot.id },
          data: { quantityRemaining: { increment: 1 } },
        });
        remaining -= 1;
      }
    }
  ```
- **Root cause:** The loop iterates over **lots**, not over units, but credits a hard-coded `increment: 1` and decrements `remaining` by 1 per lot. Two consequences: (1) if `remaining > lots.length` the loop exits with `remaining > 0` and line 1093 throws `STOCK_CONFLICT`, aborting the whole approval; (2) the write is unconditional, so a lot can be pushed above the quantity it ever held (`quantityRemaining` is not bounded by the lot's original quantity). The un-reserve branch is also gated on `consumptions.length === 0` (line 1060), so a line with *partial* consumption rows sends its leftover here instead of releasing `quantityReserved`, inventing stock that was never received.
- **Impact at scale:** At 5M invoices, lots are routinely merged/consolidated and consumption rows do not always sum to the sold quantity — exactly the case this fallback was written for. Bulk returns (e.g. 500 units of a model with 3 open lots) restore 3 units and then fail the entire approval with `STOCK_CONFLICT`, permanently blocking the return; when the lot count happens to exceed the leftover, stock is silently inflated. Inflated `quantityRemaining` is then sold again, i.e. inventory corruption that propagates into COGS and availability checks.
- **Reproduction:** Model `Bulk`, one lot `L1` with `quantityRemaining = 0`, no `StockConsumption` rows for the invoice line, invoice line quantity 10. Approve a return of 10: `consumptions.length === 0` → un-reserve branch releases 0 (lot has no reserve), then the fallback credits `L1.quantityRemaining += 1` and exits with `remaining = 9` → `ConflictException STOCK_CONFLICT`; the return, the refund and the audit log all roll back. With three lots and a leftover of 1 the lot grows by 1 even though it may have been fully consumed.
- **Fix:** Credit per lot by the correct amount, bounded by that lot's capacity:
  ```ts
  const credit = Math.min(remaining, lotCapacity); // lotCapacity = max(0, lot.quantity - lot.quantityRemaining) or configured cap
  await tx.stockLot.update({ where: { id: lot.id }, data: { quantityRemaining: { increment: credit } } });
  remaining = roundQuantity(remaining - credit);
  ```
  Better: allocate the leftover in a single pass over `lots` using `Math.min(remaining, lot.quantityRemaining capacity)` with a `remaining > 0` post-check, and run the un-reserve branch whenever `remaining > 0 && lot.quantityReserved > 0` (drop the `consumptions.length === 0` condition). Add `@@check`/guard so `quantityRemaining` never exceeds the received quantity.
- **Verification:** Spec: leftover 10 with 2 lots → either both lots credited exactly 10 total and no throw, or a deterministic domain error; assert `Σ quantityRemaining` increases by exactly `plan.quantity` for every non-serialized return. Add an invariant query run after the test suite: `SELECT count(*) FROM "StockLot" WHERE "quantityRemaining" > "quantityReceived"` must be 0.
- **Status:** - [ ] Fixed

---

## BC-03 — Idempotency is checked *after* the pending-request conflict check, so a legitimate retry returns 409 instead of replaying the stored 201

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:99-118`
- **Evidence:**
  ```ts
    // Check for existing pending requests on same invoice items
    if (invoice.changeRequests.length > 0) {
      throw new ConflictException({
        code: 'CHANGE_REQUEST_CONFLICT',
        message: 'There is already a pending change request on this invoice',
      });
    }
  ```
  ```ts
    const normalizedIdempotencyKey = idempotencyKey?.trim();
    let idempotencyClaimed = false;
    if (normalizedIdempotencyKey) {
      const existingResponse = await this.claimIdempotencyKey(employeeId, normalizedIdempotencyKey);
      if (existingResponse !== null) return existingResponse;
      idempotencyClaimed = true;
    }
  ```
- **Root cause:** `claimIdempotencyKey` (line 115) runs after the invoice-status check (92) and after the "already pending" check (100). The first successful call leaves a `PENDING` change request, so the retry — the exact scenario idempotency keys exist for — is rejected at line 101 before the stored response can be returned. The response is also written *outside* the transaction (line 342), after commit, so a crash or a failed `idempotencyKey.update` between commit and line 342 leaves the key claimed with `responseBody = null`; every subsequent retry then gets `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` for 24h even though the request succeeded.
- **Impact at scale:** At high concurrency and with gateway/mobile retries, the dominant retry window is exactly while the request is `PENDING`. Every such retry produces a user-visible 409 (and client-side error/duplicate-workflow), which defeats the idempotency contract and pushes operators to re-submit manually — creating the duplicates BC-04 describes. The header is also optional (controller line 28), so clients that omit it get no protection at all.
- **Reproduction:** `POST /invoices/100/change-requests` with `Idempotency-Key: K1` → 201, request `#42` PENDING. Replay the identical request with `K1` → `409 CHANGE_REQUEST_CONFLICT` (expected: the same 201 body for `#42`). Separately, kill the process after the transaction commits but before line 342 and retry → `409 IDEMPOTENCY_REQUEST_IN_PROGRESS` until `expiresAt`.
- **Fix:** Make idempotency the *first* operation in `create` (before loading the invoice), and persist the response in the same transaction as the change request:
  ```ts
  const claimed = await this.claimIdempotencyKey(...);      // first line
  if (claimed.hit) return claimed.body;
  ...
  await tx.idempotencyKey.update({ where: { key }, data: { responseStatus: 201, responseBody: request } });
  ```
  (Prisma `tx` write, committed atomically with the request.) Make the header mandatory (or reject without it) for this endpoint, and treat `responseBody = null` older than a few seconds as "abandoned" so retries can proceed.
- **Verification:** Integration test: POST → 201, replay same key → identical 201 body and `count(*) = 1` for that invoice; assert the response row is written in the same `$transaction` (simulate a throw after `invoiceChangeRequest.create` and assert no idempotency row with a body remains).
- **Status:** - [ ] Fixed

---

## BC-04 — No database uniqueness for "one PENDING request per invoice"; concurrent creates both succeed and the P2002 handler is dead code

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:100-105` (and `333-337`)
- **Evidence:**
  ```ts
    if (invoice.changeRequests.length > 0) {
      throw new ConflictException({
        code: 'CHANGE_REQUEST_CONFLICT',
        message: 'There is already a pending change request on this invoice',
      });
    }
  ```
  ```ts
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'CHANGE_REQUEST_CONFLICT', message: 'There is already a pending change request on this invoice' });
      }
  ```
- **Root cause:** The "one pending request per invoice" invariant is enforced only by a read at line 100, outside any transaction and with no lock. `InvoiceChangeRequest` has no unique constraint — `backend/prisma/schema.prisma:478-480` defines only `@@index([invoiceId, status])`, `@@index([status, createdAt])`, `@@index([requestedByEmployeeId, createdAt])`. Two concurrent `create` calls (different keys, or no key at all) both read zero pending rows and both insert. The `P2002` branch at 335 therefore can never fire for this invariant, which is why the race was not caught in tests.
- **Impact at scale:** At high concurrency, duplicate pending requests per invoice are easy to produce (double-click, retry without a key, two salespeople). `approve`/`reject` themselves are correctly single-winner (`updateMany` with `status: PENDING`, lines 544-550 / 583-594), so each duplicate can be approved independently. Duplicate `ADD_ITEM` requests each reserve stock and add invoice items; duplicate `CHANGE_PRICE` requests approved concurrently both read the pre-approval price and each apply their delta to `currentTotal` (increment, line 1185), so the discount/price change is applied twice. Returns are partially protected by the over-return guard, but the invoice's `currentTotal` and audit trail are still corrupted.
- **Reproduction:** Fire two `POST /invoices/100/change-requests` in parallel (no `Idempotency-Key`), both with `{action:'ADD_ITEM', productModelId: 9, quantity: 1, proposedPrice: 40}`. Both return 201. `SELECT count(*) FROM "InvoiceChangeRequest" WHERE "invoiceId" = 100 AND status = 'PENDING'` → 2. Approve both concurrently → two `InvoiceItem` rows and `currentTotal += 80`.
- **Fix:** Add a partial unique index and let the database enforce it:
  ```sql
  CREATE UNIQUE INDEX "InvoiceChangeRequest_one_pending_per_invoice"
    ON "InvoiceChangeRequest" ("invoiceId") WHERE status = 'PENDING';
  ```
  In Prisma, add it via a migration (partial indexes are not expressible in `schema.prisma`). Keep the read check as a fast path and map the now-reachable `P2002` to 409. Also create the request inside the same transaction that re-checks the invariant, or rely solely on the index.
- **Verification:** Run the two-parallel-POST reproduction against staging and assert exactly one 201 and one 409, and `count(*) = 1`. Add a spec that mocks `create` to throw `P2002` and asserts 409 `CHANGE_REQUEST_CONFLICT`.
- **Status:** - [ ] Fixed

---

## BC-05 — Low-stock notifications are written through a separate Prisma client from inside the approval transaction

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1009-1013` (same pattern at `1507-1516`)
- **Evidence:**
  ```ts
        if (availableCount <= model.minStockAlert) {
          await this.notificationsService.createLowStockNotification(productModelId, model.name, availableCount, model.minStockAlert);
        } else {
          await this.notificationsService.resolveLowStockNotification(productModelId);
        }
  ```
- **Root cause:** `applyReturnActions`/`applyAddActions` run inside `this.prisma.$transaction(async (tx) => …)`, but `NotificationsService` is injected with the root `PrismaService` (`backend/src/notifications/notifications.service.ts:9`), not `tx`. `createLowStockNotification` performs `employee.findMany` plus one `notification.upsert` per admin (lines 49-80) and `resolveLowStockNotification` performs an `updateMany` — all on a *different* connection, committed immediately and independently of the surrounding transaction.
- **Impact at scale:** Two effects. Correctness: if the approval later throws (another planned add fails in Phase 1, the invoice update fails, a `STOCK_CONFLICT` from BC-02), the stock change rolls back but the "Low Stock Alert" was already created — or an existing alert was already marked `resolvedAt` — leaving the alert state permanently out of sync with actual stock. Performance: the extra round-trips (1 + N admins) execute while the transaction still holds row locks on `ProductUnit`, `StockLot` and `Invoice`; with 5M invoices and many admins, each approval's lock window grows by the full notification fan-out, multiplying contention and deadlock exposure on the hot lots.
- **Reproduction:** Create an add-item change request whose first planned add succeeds and whose second fails validation (e.g. second model `deletedAt` set between create and approve). Approve → the transaction rolls back, but `SELECT * FROM "Notification" WHERE "dedupeKey" = 'LOW_STOCK:PRODUCT_MODEL:<firstModel>'` shows the new/updated alert.
- **Fix:** Never write through the root client from inside a transaction. Two acceptable options: (a) pass `tx` into the notification helpers (`createLowStockNotification(tx, …)`) so alerts commit/rollback with the stock change; or (b) collect `touchedModelIds` and run the low-stock recalculation **after** the transaction commits (post-commit hook / outbox), which also removes the fan-out from the lock window. Option (b) is preferable because alerts are derived state and must be idempotent.
- **Verification:** Spec: make the second add fail and assert `notificationsService.createLowStockNotification` was not called (or was called only after a successful commit). Integration: assert no `Notification` row exists for a rolled-back approval.
- **Status:** - [ ] Fixed

---

## BC-06 — Price changes can target already-returned lines and are applied as a raw delta with no floor, driving `currentTotal` negative

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1157-1159` and `1181-1189`
- **Evidence:**
  ```ts
        const newPrice = Number(priceItem.proposedPrice);
        const delta = newPrice - currentEffectivePrice;
        totalDelta += delta;
  ```
  ```ts
      // 6. Update Invoice.currentTotal by the delta
      await tx.invoice.update({
        where: { id: request.invoiceId },
        data: {
          currentTotal: {
            increment: totalDelta,
          },
        },
      });
  ```
- **Root cause:** `applyPriceActions` loads the invoice item and its latest price adjustment (1131-1140) but never checks whether the line has been returned or how much of it remains. The delta is computed against the *effective price* and applied as an unfloored `increment`, so a price decrease on a line whose value is no longer in `currentTotal` (because a return already removed it) subtracts value that isn't there. Duplicate `CHANGE_PRICE` rows for the same `invoiceItemId` are also accepted at create time (no dedupe/unique constraint on `(requestId, invoiceItemId, action)`), so one request can create several adjustments and several deltas for the same line.
- **Impact at scale:** Negative `currentTotal` on real invoices breaks receivables reporting, the `paymentRatio` in BC-01 (which divides by it), and any downstream accounting/export. At 5M invoices, the return-then-reprice sequence is a normal workflow (customer returns an item, admin later corrects the price), so this is reachable in production, not an edge case. Because the write is an `increment`, it also races with the absolute write in BC-08.
- **Reproduction:** Invoice with one line: 1 × 100, `currentTotal = 100`. Approve a return of that unit → `currentTotal = 0`. Create a `CHANGE_PRICE` request for the same `invoiceItemId` with `proposedPrice: 50` → `delta = 50 - 100 = -50` → `currentTotal = -50`. `GET /invoices/:id` returns a negative total; the customer now appears to be owed 50 for goods already refunded.
- **Fix:** In `applyPriceActions`, reject (or clamp) price changes on lines with `Σ returned quantity >= invoiceItem.quantity` and cap the applied delta at the line's remaining contribution to `currentTotal`. Floor the result with a compare-and-set:
  ```ts
  const newTotal = Math.max(0, round2(Number(fresh.currentTotal) + totalDelta));
  await tx.invoice.updateMany({ where: { id: request.invoiceId, currentTotal: fresh.currentTotal }, data: { currentTotal: newTotal } });
  ```
  Reject duplicate `CHANGE_PRICE` rows per `invoiceItemId` at create time (and add a partial unique index on `(requestId, invoiceItemId)` where `action = 'CHANGE_PRICE'`).
- **Verification:** Spec: return the only line, then approve a price change on it → expect 400/409, and in no case a negative `currentTotal`. Property test: `currentTotal >= 0` after any sequence of return/price/add approvals.
- **Status:** - [ ] Fixed

---

## BC-07 — Stock availability is a read-then-increment with no conditional guard, so concurrent approvals oversell

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1310-1317` and `1390-1403`
- **Evidence:**
  ```ts
          const lotAgg = await tx.stockLot.aggregate({
            where: { productModelId: model.id, quantityRemaining: { gt: 0 } },
            _sum: { quantityRemaining: true, quantityReserved: true },
          });
          const totalRemaining = Number(lotAgg._sum?.quantityRemaining) || 0;
          const totalReserved = Number(lotAgg._sum?.quantityReserved) || 0;
          available = totalRemaining - totalReserved;
  ```
  ```ts
          const lots = await tx.stockLot.findMany({
            where: { productModelId: model.id, quantityRemaining: { gt: 0 } },
            orderBy: { receivedDate: 'asc' },
          });
          let remainingToReserve = quantity;
          for (const lot of lots) {
            if (remainingToReserve <= 0) break;
            const availableInLot = lot.quantityRemaining - lot.quantityReserved;
            const toReserve = Math.min(availableInLot, remainingToReserve);
            if (toReserve > 0) {
              await tx.stockLot.update({
                where: { id: lot.id },
                data: { quantityReserved: { increment: toReserve } },
              });
  ```
- **Root cause:** Phase 1 reads availability (`aggregate` / `productUnit.count`) and Phase 2 increments `StockLot.quantityReserved` / `ProductModel.reservedQuantity` unconditionally. There is no row lock (`SELECT … FOR UPDATE`), no `updateMany` predicate on the current reserved value, and no serializable isolation. Under READ COMMITTED, two transactions can both read `available = 1` and both increment, producing `quantityReserved > quantityRemaining` (or `reservedQuantity > AVAILABLE` units). The comment at 1407-1408 ("guard against races") only re-checks the *local* `remainingToReserve` counter, not the database state.
- **Impact at scale:** At high concurrency on hot models (the realistic case at 5M invoices) this is the classic oversell: two approved change requests both promise the same units, invoices are approved against stock that does not exist, and confirmation later fails or ships short. `quantityReserved` permanently exceeding `quantityRemaining` also corrupts the availability number used by every subsequent `create` check (line 228) and by `applyAddActions` itself, so the error compounds.
- **Reproduction:** Model with one lot: `quantityRemaining = 1, quantityReserved = 0`. Fire two `approve` calls in parallel for two add-item requests of quantity 1 (each on a different invoice). Both pass Phase 1, both increment → `quantityReserved = 2` while `quantityRemaining = 1`. `SELECT * FROM "StockLot"` shows the impossible state and both invoices are approved.
- **Fix:** Make the reservation a compare-and-set / locked operation:
  ```ts
  const updated = await tx.stockLot.updateMany({
    where: { id: lot.id, quantityReserved: { lte: lot.quantityRemaining - toReserve } },
    data: { quantityReserved: { increment: toReserve } },
  });
  if (updated.count !== 1) throw new ConflictException({ code: 'STOCK_CONFLICT', … });
  ```
  and for serialized models lock the `ProductModel` row (`SELECT … FOR UPDATE`) before recomputing `available`, or use `updateMany({ where: { id, reservedQuantity: { lte: available - quantity } } })`. Reserve lots in a deterministic `id` order to avoid deadlocks, and retry the whole approval on conflict.
- **Verification:** Add a concurrency test (two parallel `approve` calls against one lot) asserting one succeeds, one 409s, and `quantityReserved <= quantityRemaining`. Add the invariant query `SELECT count(*) FROM "StockLot" WHERE "quantityReserved" > "quantityRemaining"` = 0 to CI.
- **Status:** - [ ] Fixed

---

## BC-08 — `currentTotal` is overwritten with an absolute value computed from a stale snapshot, losing concurrent updates

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:811-846` and `936-943`
- **Evidence:**
  ```ts
      const pricing = await tx.invoice.findUnique({
        where: { id: request.invoiceId },
        select: {
          currentTotal: true,
  ```
  ```ts
      // 12. Update Invoice.currentTotal, floored at 0 (ISS-022)
      const newTotal = Math.max(0, round2(currentTotal - refundTotal));
      await tx.invoice.update({
        where: { id: request.invoiceId },
        data: {
          currentTotal: newTotal,
        },
      });
  ```
- **Root cause:** The return path reads `currentTotal` once (line 811-844) and later writes `currentTotal = snapshot − refundTotal` as an absolute value with a plain `update`. The `Invoice` row is never locked (`SELECT … FOR UPDATE`) and the write is not a compare-and-set, so any concurrent modification between the read and the write — a payment, another approval's `increment` in `applyAddActions`/`applyPriceActions`, a manual invoice edit — is silently discarded. Because BC-04 allows two pending requests per invoice and two admins can approve different requests concurrently, this is reachable with the module's own flows.
- **Impact at scale:** Lost updates on the single most important financial column. Under high concurrency, approvals of mixed requests on the same invoice (or a return racing a price change) overwrite each other's deltas; the invoice total no longer equals `originalTotal − refunds + adjustments`, and the audit log records a `newTotal` that was never persisted. Reconciliation is impossible after the fact because both transactions report success.
- **Reproduction:** Invoice `currentTotal = 1000`. In parallel: (a) approve a return with `refundTotal = 100`, (b) approve an add-item request with `totalDelta = +200`. Both read 1000. Depending on commit order, the final value is 900 (add lost) or 1200 (refund lost); in neither case 1100.
- **Fix:** Lock the invoice row at the start of every approval transaction:
  ```ts
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${request.invoiceId} FOR UPDATE`;
  ```
  or use a compare-and-set on the exact snapshot and retry on `count === 0`. Prefer expressing the return as an atomic decrement with a floor rather than an absolute write:
  ```ts
  await tx.$executeRaw`UPDATE "Invoice" SET "currentTotal" = GREATEST(0, "currentTotal" - ${refundTotal}) WHERE id = ${request.invoiceId}`;
  ```
- **Verification:** Concurrency test with two parallel approvals on one invoice; assert the final `currentTotal` equals the arithmetic sum of both effects and that neither response claims a value that differs from the DB. Assert `currentTotal = originalTotal − Σ refunds + Σ add deltas + Σ price deltas` for a seeded invoice.
- **Status:** - [ ] Fixed

---

## BC-09 — Change-request list accepts an unvalidated, unbounded `limit`/`page`

- **Severity:** S2
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.controller.ts:67-73` (consumed at `invoice-change-requests.service.ts:372-396`)
- **Evidence:**
  ```ts
    return this.invoiceChangeRequestsService.findAll({
      status: status ? (status as ChangeRequestStatus) : undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 25,
      scope: resolvedScope,
      user: req.user,
    });
  ```
- **Root cause:** `page` and `limit` are raw query strings parsed with `parseInt` and passed straight through. The service uses `take: limit` and `skip: (page - 1) * limit` with no clamp (`invoice-change-requests.service.ts:372-396`) and no `Number.isInteger`/range check. `?limit=1000000` requests every change request with nested `items`, `invoice`, `requestedBy` and `reviewedBy`; `?limit=abc` yields `NaN` and a Prisma validation error (500); `?page=-5` yields a negative `skip` (500). Compare `customer-debts.service.ts:12-14`, which correctly clamps to 100.
- **Impact at scale:** A single authenticated ADMIN/SALES/INVENTORY request can force the API to materialise millions of rows plus nested relations (5M+ invoices ⇒ millions of change requests), exhausting memory/connection pool and taking down the endpoint for everyone. Even honest large pages produce deep `OFFSET` scans (`skip = 5000000`) that read and discard millions of rows. Because `items` is included per row, the payload amplification is roughly `limit × items`.
- **Reproduction:** `GET /change-requests?limit=1000000` as an ADMIN → attempts to load the whole table with `items`; observe memory spike / timeout. `GET /change-requests?limit=abc` → 500. `GET /change-requests?page=-1` → 500.
- **Fix:** Validate with a DTO + `ValidationPipe` (`@Type(() => Number) @IsInt() @Min(1) @Max(100)`) and clamp defensively in the service:
  ```ts
  const limit = Math.min(Math.max(Number.isInteger(params.limit) ? params.limit! : 25, 1), 100);
  const page = Math.max(Number.isInteger(params.page) ? params.page! : 1, 1);
  ```
  Reject `NaN` with a 400 `INVALID_PAGINATION` instead of letting Prisma throw. For deep pages, switch to keyset pagination on `(createdAt, id)`.
- **Verification:** Tests: `limit=1000000` → at most 100 rows; `limit=abc` → 400 (not 500); `page=0`/`-1` → 400 or clamped to 1. Load test the endpoint with the max page size and confirm p95 latency and memory stay flat.
- **Status:** - [ ] Fixed

---

## BC-10 — Debt payments have no idempotency key, so a retried POST decrements the balance twice

- **Severity:** S1
- **Location:** `backend/src/customer-debts/customer-debts.service.ts:103-113` (endpoint at `customer-debts.controller.ts:68-79`)
- **Evidence:**
  ```ts
        if (data.type === DebtMovementType.PAYMENT) {
          const updated = await transaction.customer.updateMany({
            where: { id: data.customerId, currentDebt: { gte: amount } },
            data: { currentDebt: { decrement: amount } },
          });
          if (updated.count !== 1) {
            throw new BadRequestException({
              code: 'PAYMENT_EXCEEDS_CUSTOMER_DEBT',
              message: 'Payment cannot exceed the customer debt balance',
            });
          }
        }
  ```
  ```ts
  createMovement(
    @Body() body: CreateDebtMovementDto,
    @Req() req: RequestWithUser,
  ) {
  ```
- **Root cause:** `POST /customer-debts/movements` has no `Idempotency-Key` header, no request id, and no unique constraint tying a movement to a client operation. `createMovement` unconditionally decrements `currentDebt` and inserts a `CustomerDebtMovement` for every request that passes the `currentDebt >= amount` guard. The guard only prevents overdraw; it does not detect a replay. The DTO (`create-debt-movement.dto.ts`) has no idempotency field, and the module does not import or use `IdempotencyKey`.
- **Impact at scale:** Money. A client timeout, a proxy retry, a double-click, or an operator re-submitting after a slow response records two payments: `currentDebt` drops by `2 × amount` and two ledger rows appear. With 100k customers and manual payment entry at branch level, this is a routine occurrence; the customer's balance is then wrong and the only recovery is a compensating INCREASE entry, which corrupts the audit trail. Unlike invoice creation, there is not even an optional key.
- **Reproduction:** `POST /customer-debts/movements {"customerId":12,"type":"PAYMENT","amount":500,"note":"cash"}` twice (simulating a retry) with `currentDebt = 1000`. Both return 201, balance becomes 0, and `SELECT count(*) FROM "CustomerDebtMovement" WHERE "customerId"=12` = 2. If `currentDebt = 700`, the second call succeeds too (200 left) and the customer is now credited 300 they never paid.
- **Fix:** Require `Idempotency-Key` on the POST and make the claim + movement write atomic:
  ```ts
  await tx.idempotencyKey.create({ data: { key, employeeId, operation: 'CREATE_DEBT_MOVEMENT', expiresAt } });
  // … decrement + movement …
  await tx.idempotencyKey.update({ where: { key }, data: { responseStatus: 201, responseBody: movement } });
  ```
  Return the stored body on replay (see BC-03 for the correct ordering). Alternatively add `idempotencyKey String? @unique` on `CustomerDebtMovement` and use `create` with `P2002 → return existing`.
- **Verification:** Integration test: same key twice → one 201, one replay with the identical movement id, `currentDebt` decremented once, `count(*) = 1`. Test with two concurrent identical requests and assert exactly one movement.
- **Status:** - [ ] Fixed

---

## BC-11 — `isFullReturn` compares returned row count to invoice line count, mislabelling partial returns as full

- **Severity:** S3
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:946`
- **Evidence:**
  ```ts
      const isFullReturn = plans.length === request.invoice.items.length;
  ```
- **Root cause:** `plans.length` is the number of return *rows* in this request (one per returned line/unit), while `request.invoice.items.length` is the number of invoice lines. Quantities and prior returns are ignored, and `ADD_ITEM`/`CHANGE_PRICE` rows in the same request are not considered at all.
- **Impact at scale:** The audit log (`FULL_RETURNED` vs `PARTIAL_RETURNED`) is the primary forensic record for returns. An invoice with 1 line of 10 units where 1 unit is returned is logged as `FULL_RETURNED`; an invoice with 5 lines where 2 lines are returned by 3 unit rows is logged as `FULL_RETURNED` as well. With 5M invoices, reports built on `InvoiceAuditLog.action` (full-return rate, restocking volumes, fraud review) are systematically wrong, and the wrong action cannot be corrected after the fact.
- **Reproduction:** Invoice with one line: `quantity = 10`. Return 1 unit → `plans.length = 1`, `invoice.items.length = 1` → audit log action `FULL_RETURNED` while 9 units remain sold.
- **Fix:** Derive it from quantities, including prior returns:
  ```ts
  const fullyReturned = request.invoice.items.every((item) => {
    const returned = returnedQtyByInvoiceItem(item.id); // prior + this request
    return roundQuantity(returned) >= roundQuantity(item.quantity);
  }) && groups.adds.length === 0;
  ```
  where `returnedQtyByInvoiceItem` aggregates `InvoiceReturnItem` (serialized rows count 1).
- **Verification:** Specs: 1-of-10 return → `PARTIAL_RETURNED`; full quantity across two requests → second logs `FULL_RETURNED`; multi-line partial → `PARTIAL_RETURNED`.
- **Status:** - [ ] Fixed

---

## BC-12 — `InvoiceReturnItem.invoiceItemId` has no index although it is filtered on every return (inside the approval transaction)

- **Severity:** S3
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:794-797` (also `178-181`), schema `backend/prisma/schema.prisma:443-456`
- **Evidence:**
  ```ts
      const priorRows = await tx.invoiceReturnItem.findMany({
        where: { invoiceItemId },
        select: { quantity: true },
      });
  ```
  ```ts
  @@index([invoiceReturnId])
  @@index([productUnitId])
  ```
- **Root cause:** `InvoiceReturnItem` indexes `invoiceReturnId` and `productUnitId` only. Every non-serialized return checks prior rows by `invoiceItemId` (twice: at create, line 178, and at approve, line 794) and the serialized check at line 740 filters `invoiceItemId + productUnitId`, which the `productUnitId` index can serve but without the composite selectivity. Postgres must sequentially scan the whole returns table for each returned line.
- **Impact at scale:** With 5M invoices, `InvoiceReturnItem` reaches tens of millions of rows. Each approval performs at least one full scan *while holding the change-request row lock and the transaction open*, so approval latency grows linearly with table size and the lock window widens, cascading into contention on `Invoice`/`StockLot`. The create path (line 178) does the same scan on every submission.
- **Reproduction:** `EXPLAIN (ANALYZE, BUFFERS) SELECT quantity FROM "InvoiceReturnItem" WHERE "invoiceItemId" = 12345;` on a seeded 10M-row table → `Seq Scan on "InvoiceReturnItem"`. The same plan appears in the approval transaction.
- **Fix:** Add `@@index([invoiceItemId])` (or `@@index([invoiceItemId, productUnitId])` to cover both checks) and regenerate the migration. Change the serialized check to `findFirst({ where: { invoiceItemId, productUnitId } })` so it uses the composite index.
- **Verification:** Re-run `EXPLAIN` → `Index Scan using "InvoiceReturnItem_invoiceItemId_idx"`. Assert p95 approval latency is independent of `InvoiceReturnItem` row count in a seeded benchmark.
- **Status:** - [ ] Fixed

---

## BC-13 — Customer balances are sorted and aggregated on an unindexed `currentDebt`

- **Severity:** S3
- **Location:** `backend/src/customer-debts/customer-debts.service.ts:33-42`, schema `backend/prisma/schema.prisma:311-328`
- **Evidence:**
  ```ts
        orderBy: [{ currentDebt: 'desc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.customer.count({ where }),
      this.prisma.customer.aggregate({
        _sum: { currentDebt: true },
        _count: { _all: true },
        where: { currentDebt: { gt: 0 }, deletedAt: null },
      }),
  ```
  ```ts
  @@index([name])
  @@index([phone])
  @@index([isActive])
  ```
- **Root cause:** `Customer` has no index on `currentDebt` (nor on `deletedAt`), yet the list endpoint sorts the entire customer table by `currentDebt desc, name asc` and then applies `OFFSET/LIMIT`, and the summary aggregate scans all rows with `currentDebt > 0`. Both run on every page load, in parallel.
- **Impact at scale:** With 100k customers this is a full sort (or top-N heapsort) plus a full aggregate per request; deep pages (`skip = 50000`) get progressively slower. The dashboard that shows total receivables therefore has latency proportional to the customer table and consumes a connection for the duration, which at high concurrency starves the pool used by the payment path.
- **Reproduction:** `EXPLAIN (ANALYZE) SELECT … FROM "Customer" WHERE "deletedAt" IS NULL ORDER BY "currentDebt" DESC, "name" ASC LIMIT 20 OFFSET 40000;` → `Seq Scan` + `Sort`, and the `_sum` query → `Seq Scan` over all customers.
- **Fix:** Add a covering index for the list and a partial one for the summary:
  ```sql
  CREATE INDEX "Customer_currentDebt_name_idx" ON "Customer" ("currentDebt" DESC, "name" ASC) WHERE "deletedAt" IS NULL;
  CREATE INDEX "Customer_with_debt_idx" ON "Customer" ("currentDebt") WHERE "deletedAt" IS NULL AND "currentDebt" > 0;
  ```
  Cache the summary (`totalDebt`, `customersWithDebt`) in a small aggregate table updated on each movement, or recompute it on a schedule instead of per request.
- **Verification:** `EXPLAIN` shows an index scan with no `Sort` for the first page and no `Seq Scan` for the aggregate; measure p95 of `GET /customer-debts` before/after at 100k rows.
- **Status:** - [ ] Fixed

---

## BC-14 — `restoreNonSerializedStock` performs one `findUnique` + one `update` per consumption row inside the approval transaction

- **Severity:** S3
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1041-1056`
- **Evidence:**
  ```ts
    const consumptions = await tx.stockConsumption.findMany({
      where: { invoiceItemId },
      orderBy: { createdAt: 'desc' },
    });

    for (const consumption of consumptions) {
      if (remaining <= 0) break;
      const credit = Math.min(Number(consumption.quantity), remaining);
      if (credit <= 0) continue;
      const lot = await tx.stockLot.findUnique({ where: { id: consumption.stockLotId } });
      if (!lot) continue;
      await tx.stockLot.update({
        where: { id: consumption.stockLotId },
        data: { quantityRemaining: { increment: credit } },
      });
      remaining -= credit;
    }
  ```
- **Root cause:** N+1 access pattern: an unbounded `findMany` (no `take`) followed by two round-trips per row (`findUnique` then `update`), all inside the `$transaction` that also holds the change-request claim and (after line 938) the invoice row. The fetched `lot` is only used as an existence check — the update does not use any of its fields.
- **Impact at scale:** Bulk returns are the normal case for a wholesaler: a 1,000-unit return over 1,000 consumption rows issues ~2,000 sequential queries while holding locks, so the transaction runs for seconds and blocks every other approval touching the same lots/invoice. At high concurrency this is the main driver of lock timeouts and pool exhaustion in the module.
- **Reproduction:** Seed an invoice line with 1,000 `StockConsumption` rows and approve a return of all 1,000 units; count queries (Prisma `query` event) → ~2,000, and measure transaction duration.
- **Fix:** Aggregate per lot and issue one update per distinct lot, or a single raw update:
  ```ts
  const byLot = new Map<number, number>();
  for (const c of consumptions) { /* accumulate credit per stockLotId */ }
  await tx.$executeRaw`
    UPDATE "StockLot" AS l SET "quantityRemaining" = l."quantityRemaining" + v.qty
    FROM (VALUES ${Prisma.join([...byLot].map(([id, qty]) => Prisma.sql`(${id}::int, ${qty}::float)`))}) AS v(id, qty)
    WHERE l.id = v.id`;
  ```
  Also add `take`/aggregate (`groupBy: ['stockLotId']`) to bound the read.
- **Verification:** Query-count test asserts the return path issues a constant number of statements (independent of consumption rows); benchmark p95 approval latency for a 1,000-unit return.
- **Status:** - [ ] Fixed

---

## BC-15 — `create` validates each item with 2-5 sequential queries and the DTO has no upper bound on item count

- **Severity:** S3
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:146-158` (loop starts at `124`), DTO `backend/src/invoice-change-requests/dto/invoice-change-request.types.ts:98-103`
- **Evidence:**
  ```ts
          const assignment = await this.prisma.invoiceItemUnitAssignment.findFirst({
            where: { invoiceItemId: item.invoiceItemId, productUnitId: item.productUnitId, reversedAt: null },
            select: { id: true },
          });
          if (!assignment) {
            throw new BadRequestException({
              code: 'ASSIGNMENT_NOT_FOUND',
              message: 'The requested unit is not actively assigned to this invoice item',
            });
          }
          const existingReturn = await this.prisma.invoiceReturnItem.findFirst({
            where: { productUnitId: item.productUnitId },
          });
  ```
  ```ts
  @ApiProperty({ type: [InvoiceChangeRequestItemInput] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => InvoiceChangeRequestItemInput)
  items: InvoiceChangeRequestItemInput[];
  ```
- **Root cause:** `for (const item of data.items)` (line 124) performs per-item queries: `invoiceItemUnitAssignment.findFirst` (146), `invoiceReturnItem.findFirst` (156), `invoiceReturnItem.findMany` (178), `productModel.findFirst` (216) and `productUnit.count` (225). `items` is only bounded below (`ArrayMinSize(1)`); there is no `ArrayMaxSize`. The loop also runs before the idempotency claim, so every retry repeats all of it.
- **Impact at scale:** A single request with 1,000 items issues ~3,000 queries, serially, before any write; the API worker is blocked for seconds and the pool is consumed. With no maximum, a malicious or buggy client can submit 100k items and pin a connection indefinitely — a cheap DoS that needs only a valid SALES token.
- **Reproduction:** `POST /invoices/100/change-requests` with 1,000 `RETURN_ITEM` rows for distinct serialized units → measure ~3,000 queries / multi-second latency; with 100,000 rows the request times out and holds a pool connection.
- **Fix:** Add `@ArrayMaxSize(50)` (a realistic business cap) and batch the lookups:
  ```ts
  const ids = data.items.map(i => i.invoiceItemId).filter(Boolean);
  const assignments = await this.prisma.invoiceItemUnitAssignment.findMany({ where: { invoiceItemId: { in: ids }, reversedAt: null } });
  const priorReturns = await this.prisma.invoiceReturnItem.groupBy({ by: ['invoiceItemId'], where: { invoiceItemId: { in: ids } }, _sum: { quantity: true } });
  ```
  Validate membership in memory against the already-loaded `invoice.items`, and load product models with one `findMany({ where: { id: { in: modelIds } } })`.
- **Verification:** Query-count test: item count 1 vs 50 issues the same number of statements. Test that 51 items → 400 `TOO_MANY_ITEMS`.
- **Status:** - [ ] Fixed

---

## BC-16 — Rejections can be recorded with an empty reason

- **Severity:** S4
- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.controller.ts:102` (DTO at `dto/invoice-change-request.types.ts:106-111`, service at `invoice-change-requests.service.ts:562-638`)
- **Evidence:**
  ```ts
    return this.invoiceChangeRequestsService.reject(id, req.user.sub, body?.reason ?? '');
  ```
  ```ts
  @ApiPropertyOptional({ example: 'Approved after review' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
  ```
- **Root cause:** `reason` is optional in `ChangeRequestDecisionDto` and the controller defaults it to `''`. `reject()` accepts the empty string, stores it as `adminNote`, writes it into the `CHANGE_REQUEST_REJECTED` audit log (`reason: adminNote`) and into the requester notification (`Reason: ${adminNote || 'N/A'}`). There is no `@IsNotEmpty`/`@Matches(/\S/)` and no service-side check.
- **Impact at scale:** Rejection reasons are the only explanation a salesperson gets for a refused return/price change. At 5M invoices, empty reasons accumulate in the audit log and in notifications, making disputes unresolvable and the audit trail incomplete — while the record still looks valid.
- **Reproduction:** `PATCH /change-requests/42/reject` with body `{}` (or no body) → 200, request `REJECTED`, `adminNote = ''`, audit log `details.reason = ''`, notification text "Reason: N/A".
- **Fix:** Require a non-blank reason for reject: `@IsString() @MinLength(3) @Matches(/\S/) @MaxLength(500)` on a dedicated `RejectChangeRequestDto` (do not reuse the approve DTO), and assert in `reject()`:
  ```ts
  if (!adminNote?.trim()) throw new BadRequestException({ code: 'REJECTION_REASON_REQUIRED', … });
  ```
- **Verification:** Tests: reject without body → 400 `REJECTION_REASON_REQUIRED`; reject with `'   '` → 400; with a valid reason → 200 and the reason is persisted in `adminNote`, the audit log and the notification payload.
- **Status:** - [ ] Fixed
