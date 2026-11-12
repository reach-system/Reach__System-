## Summary
- Severity counts: Critical 1; High 3; Medium 7; Low 2.
- Status counts: CONFIRMED 10; SUSPECTED 3.
- What to fix first:
  1. Prevent concurrent change-request approvals from reserving the same stock.
  2. Reconcile historical refunds and receivables when repairing invoice totals.
  3. Use one cent-rounding path for invoice creation, recomputation, and reporting.
  4. Correct realtime event audience checks and add an authorization regression test.
  5. Patch the vulnerable backend/frontend dependency versions and rerun npm audit.

## Test run summary
- `npm test` from the repository root failed because there is no root `package.json`; the project-scoped commands below were then run.
- `cd frontend && npm test`: 28 passed, 0 failed.
- `cd backend && npm test -- --selectProjects unit`: 92 passed, 0 failed.
- Backend unit suite with the new realtime audit test: 92 passed and 1 expected audit failure (unauthorized event was delivered).
- `node --experimental-strip-types --test src/__audit__/invoiceTotalsParity.audit.test.ts`: 1 passed; 1,000 deterministic randomized cases matched backend and frontend totals.
- Both builds passed: `backend npm run build`; `frontend npm run build`. Vite reported a minified JavaScript chunk of about 2 MB.
- `frontend npm run lint` passed with warnings. Backend lint was not run: the script invokes `eslint --fix`, which could modify source, and the local ESLint executable is absent.
- Read-only DB probe succeeded for `localhost/pallet_pos_audit`; all DB-writing audit tests were directed to that isolated DB, not the configured development database `pallet_pos`.
- PostgreSQL audit suite excluding `repair.audit.spec.ts`: 30 passed and 6 expected-failure cases failed. Failures: A13 (NaN price), C4 (concurrent stock reservation), D1 (rounding), H4 (period attribution), H5 (float precision), and G2 (debt ledger).
- Repair dry-run/scope/invalid-input tests F1, F2, and F4: 3 passed; F3 was skipped and was not run as a separate test. No `--apply` command was intentionally run.
- Important exception: the pre-existing G3 test inside `reports-and-consistency.audit.spec.ts` invoked `repair-invoice-totals.ts --apply` against `pallet_pos_audit`. This violated the supplied no-`--apply` rule. No further `--apply` command was run.
- `backend npm audit`: 49 advisories (1 critical, 15 high, 28 moderate, 5 low). `frontend npm audit`: 5 advisories (3 high, 2 moderate).
- The default backend e2e suite was not run because its global setup truncates tables and the configured `.env` points to the development database. A React component-level test runner is not configured; UI behaviors were checked by code inspection and pure-helper tests.

## Findings

### [SEC-01] Backend dependency tree contains a critical Handlebars advisory
- Severity: Critical
- Status: CONFIRMED
- Category: Security
- Location: `backend/package-lock.json:6442`
- What happens: The lockfile resolves Handlebars 4.7.9, which `npm audit` flags for JavaScript-injection advisories, including GHSA-xw65-4hp5-5hc7. The backend audit reports one critical and 15 high advisories overall; no direct Handlebars call site was found in `backend/src`, so exploitability through the current application was not demonstrated.
- Reproduction: Run `npm audit` from `backend`; the lockfile resolves `handlebars@4.7.9`.
- Impact: If vulnerable template compilation becomes reachable with attacker-controlled templates, the advisories describe JavaScript execution in the server process. The installed vulnerable dependency also expands the impact of future code paths that use it.
- Suggested fix: Remove Handlebars if unused or upgrade it, update the affected backend dependency tree, then rerun the audit.

### [INV-01] Concurrent additions can reserve the same stock repeatedly
- Severity: High
- Status: CONFIRMED
- Category: Data integrity
- Location: `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1512`
- What happens: Each approval checks aggregate availability, then later increments reservations without an atomic availability predicate or shared stock lock. The real-PostgreSQL race test forced eight approvals for different invoices to pass the check against one remaining unit; all eight were approved and reserved it.
- Reproduction: `backend/test/__audit__/invoice-changes.audit.spec.ts:627` (C4); the assertion expected one approval and received eight.
- Impact: The system can reserve eight units when only one exists, causing over-selling and later delivery/stock failures.
- Suggested fix: Make stock validation and reservation atomic across competing invoices, for both lot and serialized stock.

### [FIN-01] Repairing invoice totals leaves historical refunds unreconciled
- Severity: High
- Status: CONFIRMED
- Category: Data integrity
- Location: `backend/scripts/repair-invoice-totals.ts:115`
- What happens: The repair script updates only `Invoice.currentTotal`; it does not recalculate `InvoiceReturn.refundTotal` or `InvoiceReturnItem.refundAmount`. G3 reproduced a 3 × 450 invoice with an old 270 refund: after the total was repaired to 900, refunds plus remaining total were 1,170 instead of 1,350.
- Reproduction: `backend/test/__audit__/reports-and-consistency.audit.spec.ts:252` (G3).
- Impact: In this fixture, the customer is short-refunded by 180, and historical receivables/refund records remain inconsistent even after the invoice total repair.
- Suggested fix: Reconcile historical return/refund records and related receivables as part of a separately reviewed migration or repair process.

### [SEC-02] Vulnerable Vite version is exposed by the LAN dev command
- Severity: High
- Status: CONFIRMED
- Category: Security
- Location: `frontend/package-lock.json:3609`
- What happens: The lockfile resolves Vite 8.3.0, which `npm audit` reports with high-severity advisories. The `dev:local` command binds the server to `0.0.0.0`, making the vulnerable development server reachable from other network interfaces when that command is used.
- Reproduction: Run `npm audit` from `frontend`; inspect `frontend/package.json:8` for `vite --host 0.0.0.0`.
- Impact: A network-reachable development server may expose source files or be affected by the reported Vite/launch-editor vulnerabilities.
- Suggested fix: Upgrade Vite and affected transitive packages to patched versions; avoid exposing the dev server to untrusted networks.

### [FIN-02] Invoice creation and recomputation differ by one cent
- Severity: Medium
- Status: CONFIRMED
- Category: Bug
- Location: `backend/src/common/invoice-totals.util.ts:43`
- What happens: Creation rounds the subtotal and percentage discount, while recomputation rounds each outstanding line after applying the discount factor. Three lines at 33.33 with a 10% discount produce 89.99 at creation and 90.00 on a no-change recompute.
- Reproduction: `backend/test/__audit__/invoice-changes.audit.spec.ts:690` (D1); received 90 instead of 89.99.
- Impact: Repricing, return, or repair operations can change an invoice by one cent without a business change; repeated operations can make stored totals inconsistent with creation-time totals.
- Suggested fix: Use the same cent-level aggregation and rounding order for creation and recomputation.

### [FIN-03] Historical price adjustments default to one applied unit
- Severity: Medium
- Status: CONFIRMED
- Category: Data integrity
- Location: `backend/prisma/migrations/20261111000000_price_adjustment_applied_quantity/migration.sql:4`
- What happens: The migration assigns historical adjustment rows `appliedQuantity = 1`, and reports multiply the unit-price delta by that quantity. For a three-unit line changed from 450 to 440, the report records -10 instead of -30.
- Reproduction: `backend/test/__audit__/reports-and-consistency.audit.spec.ts:74` (H2): net sales were 1,340 rather than 1,320.
- Impact: Historical revenue is overstated by 20 for this three-unit, 10-per-unit price reduction; larger quantities and deltas scale the error.
- Suggested fix: Backfill historical applied quantities from reliable adjustment/request history, or explicitly exclude/label rows whose quantity cannot be recovered.

### [FIN-04] Revenue aggregation returns binary floating-point residue
- Severity: Medium
- Status: CONFIRMED
- Category: Bug
- Location: `backend/src/reports/reports.service.ts:80`
- What happens: Monetary values are summed as JavaScript numbers and returned without cent rounding. Two lines priced at 0.10 and 0.20 yield `0.30000000000000004` in `originalSales` and `netSales`.
- Reproduction: `backend/test/__audit__/reports-and-consistency.audit.spec.ts:167` (H5).
- Impact: Revenue totals and exports can display or transmit values that are not valid cent amounts.
- Suggested fix: Aggregate in decimal arithmetic or round to cents at the report boundary using the shared money helper.

### [SEC-03] Realtime role-scoped events are delivered to other roles
- Severity: Medium
- Status: CONFIRMED
- Category: Security
- Location: `backend/src/realtime/realtime.controller.ts:35`
- What happens: The event filter combines failed role and employee checks with `&&`. For an event that specifies only `roles`, an authenticated user outside those roles is not rejected; the same flaw applies to employee-only scopes.
- Reproduction: `backend/src/realtime/realtime.controller.audit.spec.ts:11`; an authenticated SALES user received an ADMIN-only event (two writes instead of the ready event alone).
- Impact: Authenticated users can observe cross-role event metadata such as invoice IDs/statuses and stock-unit identifiers.
- Suggested fix: Reject an event whenever the user matches neither applicable audience, and add tests for role-only, employee-only, and combined scopes.

### [FIN-05] A persisted NaN price is accepted as a zero price
- Severity: Medium
- Status: CONFIRMED
- Category: Bug
- Location: `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1348`
- What happens: `roundMoney` converts non-finite numbers to zero before the approval path checks `Number.isFinite`, so a stored PostgreSQL numeric `NaN` becomes a valid zero price. The ordinary DTO rejects non-numeric requests, but malformed persisted data bypasses that protection.
- Reproduction: `backend/test/__audit__/invoice-changes.audit.spec.ts:328` (A13) writes `NaN` to the request row; approval succeeds instead of returning `INVALID_PRICE`.
- Impact: A corrupted or externally inserted price-change request can reprice remaining units to zero.
- Suggested fix: Validate the raw proposed value for finiteness before passing it to a helper that normalizes non-finite values.

### [FIN-06] Returns do not adjust customer debt records (business rule unconfirmed)
- Severity: Medium
- Status: SUSPECTED
- Category: Data integrity
- Location: `backend/src/invoice-change-requests/invoice-change-requests.service.ts:1111`
- What happens: The return path writes return/refund records but does not create a customer-debt movement or reduce `currentDebt`. G2 set the customer balance to 1,000 and returned one 450 unit; the balance remained 1,000 and no movement was written.
- Reproduction: `backend/test/__audit__/reports-and-consistency.audit.spec.ts:217` (G2).
- Impact: If the return is against an outstanding credit sale, receivables can remain overstated by the return amount; whether cash refunds should affect debt is a product rule not encoded in the code.
- Suggested fix: Define the credit-return policy, then link return approvals to a debt credit movement or explicitly distinguish cash refunds from credit adjustments.

### [SEC-04] Public login has no application-level throttling
- Severity: Medium
- Status: SUSPECTED
- Category: Security
- Location: `backend/src/auth/auth.controller.ts:18`
- What happens: The unauthenticated login route invokes password verification without a rate limiter or lockout in the application code; no throttler configuration was found. An ingress proxy could provide protection, but that is not configured in this repository.
- Reproduction: Code inspection of `AuthController.login` and `AuthService.login`; repeated failed requests have no application-level 429/backoff path.
- Impact: Online password guessing and repeated Argon2 verification can enable account attacks or consume backend CPU.
- Suggested fix: Add or document enforced per-IP/account throttling and progressive lockout at the application or trusted ingress layer.

### [TOOL-01] Backend lint script requires an undeclared, absent ESLint binary
- Severity: Low
- Status: CONFIRMED
- Category: Maintainability
- Location: `backend/package.json:16`
- What happens: The lint script runs `eslint ... --fix`, but ESLint is not declared in backend dependencies and the local `.bin/eslint.cmd` is absent. It was not run because it would also auto-fix source files, which the audit rules forbid.
- Reproduction: Inspect the backend manifest and check for `backend/node_modules/.bin/eslint.cmd`.
- Impact: A clean dependency install cannot reliably run the advertised backend lint task, and the configured command would modify files when available.
- Suggested fix: Declare/configure ESLint and provide a non-mutating lint command for CI.

### [FE-01] Approval conflict errors leave the admin request list stale
- Severity: Low
- Status: SUSPECTED
- Category: Logic
- Location: `frontend/src/pages/admin/ChangeRequests.tsx:109`
- What happens: The approval error is shown through `getFriendlyErrorMessage`, but the catch branch does not refetch requests. The server message says to reload after `INVOICE_CONCURRENTLY_MODIFIED`; if that response occurs, the list remains stale until another refresh.
- Reproduction: Inspect `handleApprove`; `fetchRequests()` is called only after success. No UI integration test was available.
- Impact: An administrator may continue seeing a request as pending after a conflict and retry against stale state.
- Suggested fix: Refetch or invalidate the request list after a concurrency conflict.

## Verified OK
- Price changes across quantities, repeated approvals, fixed/percentage discounts, capped discounts, partial returns, full returns, duplicate-line rejection, zero price, and negative-price rejection passed the PostgreSQL audit cases except the NaN case.
- Two successive partial returns kept the refund amount stable; mixed return/price/add actions produced the expected total and stock reservation; over-return and serialized-unit checks passed.
- Same-request concurrent approval had one winner; different approvals on the same invoice serialized; the pending-request uniqueness test passed.
- Insufficient-stock rejection and exact-stock reservation passed. The cross-invoice concurrent stock race did not.
- Repair dry-run detected the corrupted fixtures without changing their totals; invoice scoping and invalid-argument checks passed.
- Backend and frontend invoice-total helpers matched on 1,000 randomized inputs. Frontend helper tests and the `NewChangeRequest` projection/remaining-quantity guards passed or were consistent by inspection.
- Projected-total and fully-returned strings exist in both English and Arabic translations; frontend TypeScript/Vite build passed.
- Money columns inspected in Prisma use Decimal; Float fields found were quantities, coordinates, or the adjustment quantity.
- Static route review found guards/roles on application controllers or explicit JWT authentication in realtime; sales invoice detail access checks invoice ownership. Production source search found no unsafe raw SQL calls.
- The compare-and-set 409 check is effectively unreachable for in-app invoice writers: approval locks the invoice row, rereads its current state, and performs the compare-and-set while holding that lock. The same lock prevents an internal ABA change between read and update. External writers bypassing this locking convention were not tested.

## Open questions for the product owner
- Should a fully returned invoice remain `CONFIRMED`, as it currently does, or transition to a distinct returned status?
- Should returns against credit invoices reduce customer debt/create a debt movement, or should the return only issue a cash refund?
- Should revenue adjustments and returns be attributed to their transaction date or the original invoice date? The current split can produce negative period net sales for an old invoice adjustment.
- When `originalTotal` is zero, the discount factor is 1; should subsequent added/repriced items be charged at full price?

Files created by this audit: `backend/src/realtime/realtime.controller.audit.spec.ts`, `frontend/src/__audit__/invoiceTotalsParity.audit.test.ts`, `problems.md`.
