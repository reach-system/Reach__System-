# Quotations (عروض الأسعار) — Final Implementation Report

**Date:** 2026-11-11
**Scope:** End-to-end quotations feature — Prisma schema + migration, NestJS backend, React/Arabic-RTL frontend, tests, and reporting.
**Status:** Implemented and verified locally. All quotation tests, type checks, and the production build pass. Lint passes with warnings only (no errors).

---

## 1. Summary

A complete, non-financial quotation module was added alongside the existing invoice flow.

- **Data:** four new tables (`Quotation`, `QuotationItem`, `QuotationEvent`, `QuotationSequence`) with their own continuous `Q-0001` numbering. Quotations never consume invoice numbers, stock, serials, revenue, COGS, or profit.
- **Lifecycle:** `DRAFT → SENT → ACCEPTED / REJECTED / EXPIRED`, and `SENT / ACCEPTED → CONVERTED`. Only `DRAFT` is editable. Revising a `SENT`, `REJECTED`, or `EXPIRED` quotation creates a linked new `DRAFT`. Soft delete is Admin-only and blocked for converted quotations.
- **Money:** `Decimal(18,2)` in the database; every total is computed server-side by one shared utility; client-supplied totals are ignored; cost/COGS is never exposed.
- **Conversion:** the existing New Invoice page is pre-filled from the quotation and submits `fromQuotationId`. The invoice transaction atomically claims the quotation with a conditional `updateMany`, reuses invoice creation, and a unique `convertedInvoiceId` is the final race-condition defense. The invoice then follows the normal `PENDING_ACCOUNTANT` flow.
- **Access:** Sales can view everything but mutate only their own quotations; Admin has full access plus the report and delete; Accountant/Inventory get `403` and no menu entry.
- **Frontend:** Arabic-first RTL list, split-screen create/edit form with live print preview, detail page with timeline/actions/conversion link, shared print identity for “عرض سعر”, WhatsApp + native share, and an Admin report with KPIs, per-salesperson breakdown, paginated details, and a real `.xlsx` export.
- **Realtime:** create/update/status/revise/convert/delete/expire events are published to Sales and Admin and invalidate the quotation queries live.

---

## 2. Verification run

| Check | Command | Result |
|---|---|---|
| Backend type-check | `cd backend && npx tsc --noEmit` | Pass |
| Backend quotation unit tests | `npx jest src/common/quotation-totals.util.spec.ts src/common/quotation-time.util.spec.ts` | **13/13 pass** |
| Backend quotation e2e | `npx jest --config ./test/jest-e2e.json --runInBand test/quotations.e2e-spec.ts` | **16/16 pass** |
| Frontend tests | `cd frontend && npm test` | **40/40 pass** (includes quotation totals + phone normalization) |
| Frontend type-check/build | `npm run build` (`tsc -b && vite build`) | Pass |
| Frontend lint | `npm run lint` (oxlint) | Pass with warnings only |
| Prisma schema/migration | migration `20261111200233_quotations` applied | Pass |

> Note: the backend e2e global setup truncates the local development database `pallet_pos`. This already happened during verification; do not point e2e at a database you care about.

---

## 3. Backend

### 3.1 Data model

- `Quotation` — customer + author, snapshot of customer name/phone, status, `date`, `validUntil`, notes, money fields (`subtotal`, `lineDiscountTotal`, `discountPercentage`, `discountAmount`, `total`), lifecycle timestamps, `convertedInvoiceId` (**unique**), `revisedFromId`, `deletedAt`, timestamps.
- `QuotationItem` — `productModelId` + snapshots (`productName`, `categoryName`, `unit`), `quantity`, `price`, `lineDiscount`.
- `QuotationEvent` — the audit timeline (`CREATED`, `UPDATED`, `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `REVISED`, `CONVERTED`, `DELETED`) with actor, message, JSON metadata.
- `QuotationSequence` — single row (`id = 1`) holding `currentNumber`, incremented inside the create transaction and formatted as `Q-0001`.

Indexes cover `status + validUntil`, `date`, `createdById + date`, `customerId + date`, `deletedAt`, item `quotationId`, and event `quotationId + createdAt`.

### 3.2 Money rules

One shared function (`backend/src/common/quotation-totals.util.ts`) computes:

1. line gross = `quantity × price`, rounded to 2 decimals;
2. line discount is capped at the line gross;
3. net subtotal = `subtotal − lineDiscountTotal`;
4. percentage discount applies to the net subtotal;
5. fixed discount applies after the percentage;
6. the total is floored at zero.

Totals are always recomputed from normalized items/customer data. The create/update DTOs accept only item/product inputs and discounts, never totals.

### 3.3 Expiry

- `validUntil` is stored as the **inclusive end-of-day instant in `Africa/Cairo`** (`23:59:59.999`), computed with `Intl`-based offset handling (DST-safe, no extra dependency).
- Reads return an **effective** status: a `SENT` quotation past `validUntil` is shown as `EXPIRED` even before persistence.
- `send`, `accept`, `reject`, and conversion re-check expiry and lazily persist `EXPIRED`, so a delayed sweep cannot let an expired quote advance.
- `QuotationExpiryService` runs a sweep 15 s after boot and every 15 minutes. It uses one `unref`’d interval because the project does not depend on `@nestjs/schedule`.

### 3.4 Conversion integration

Inside the existing invoice transaction in `invoices.service.ts`:

- quotation must exist, not be soft-deleted, be `SENT`/`ACCEPTED`, not expired, and belong to the same customer;
- invoice lines and discounts are taken from the submitted invoice form, so a converted quotation can be edited or extended like any new invoice (the quotation is a prefill, not a locked basket);
- `updateMany({ where: { id, status: { in: [...] }, convertedInvoiceId: null }, data: { status: CONVERTED, ... } })` claims the quotation atomically;
- insufficient stock returns `INSUFFICIENT_STOCK` with `productName`, `available`, and `requested` in the error payload, so the UI can show exactly which item is short (the same detail used by normal invoice creation);
- `convertedInvoiceId` is `@unique`, so a second concurrent conversion cannot succeed;
- the invoice form collapses the quotation's line + percentage + fixed discounts into a single fixed invoice discount before saving, so an untouched conversion still carries the quoted total;
- a `CONVERTED` event is recorded and `quotation.converted` is published.

Stock, serials, and invoice numbering remain the invoice flow’s responsibility. Insufficient stock still returns `INSUFFICIENT_STOCK`.

### 3.5 API surface (`/api/quotations`)

| Method | Path | Access | Purpose |
|---|---|---|---|
| POST | `/quotations` | Sales, Admin | Create draft |
| GET | `/quotations` | Sales, Admin | Server-side pagination, search, status/customer/employee/date filters, sorting |
| GET | `/quotations/:id` | Sales, Admin | Details + items + timeline + revisions + converted invoice |
| PATCH | `/quotations/:id` | Sales (owner), Admin | Edit a DRAFT only |
| PATCH | `/quotations/:id/send` | Sales (owner), Admin | `DRAFT → SENT` |
| PATCH | `/quotations/:id/accept` | Sales (owner), Admin | `SENT → ACCEPTED` |
| PATCH | `/quotations/:id/reject` | Sales (owner), Admin | `SENT → REJECTED` (+ reason) |
| POST | `/quotations/:id/revise` | Sales (owner), Admin | Linked new DRAFT from `SENT`/`REJECTED`/`EXPIRED` |
| DELETE | `/quotations/:id` | Admin only | Soft delete, never a converted quotation |
| GET | `/quotations/report` | Admin only | Summary KPIs + by-status + by-salesperson |
| GET | `/quotations/report/details` | Admin only | Paginated detail rows; `all=1` for export (cap 5000) |

Ownership is enforced in the service (`assertCanMutate`) in addition to the role guard. Accountant and Inventory roles have no route access.

### 3.6 Realtime and audit

- Events: `quotation.created`, `quotation.updated`, `quotation.status`, `quotation.revised`, `quotation.converted`, `quotation.deleted`, `quotation.expired`.
- Payloads are scoped to Sales and Admin through the existing `RealtimeService`.
- `UPDATED` events store a before/after snapshot in metadata; the detail page renders the same records as a timeline.

### 3.7 Report semantics

- Date filters resolve to Cairo start/end-of-day; soft-deleted rows are excluded everywhere.
- Summary returns counts by status, quoted value, converted value, converted count, and conversion rate.
- Conversion rate denominator = all quotations excluding `DRAFT` (a quote that was never sent cannot inflate the denominator).
- The report sweep moves overdue `SENT` rows into `EXPIRED` before aggregating, so KPIs and details agree.
- When a status filter is applied, converted KPIs are zeroed unless that status is `CONVERTED` (prevents a DRAFT-only view from showing every historical conversion).

---

## 4. Frontend

### 4.1 Routes and navigation

- Sales: `/sales/quotations`, `/sales/quotations/new`, `/sales/quotations/:id`, `/sales/quotations/:id/edit`
- Admin: `/admin/quotations`, `/admin/quotations/new`, `/admin/quotations/:id`, `/admin/quotations/:id/edit`, `/admin/reports/quotations`
- Nav entries added for Sales/Admin only; Accountant/Inventory never see them.

### 4.2 List page (`pages/sales/Quotations.tsx`)

- Server-side pagination, sorting, status/customer/employee/date filters.
- Debounced search and `AbortController` cancellation.
- Status badges plus an effective-expiry indicator for overdue `SENT` rows.
- Row navigation, loading/error/empty states; realtime invalidation.

### 4.3 Create/edit (`pages/sales/QuotationForm.tsx`)

- Split-screen layout: fields on one side, live print preview on the other.
- Customers loaded via the existing customer options hook; products exclusively from existing product models (no free-text lines).
- “+ إنشاء عميل جديد” under the customer select opens the same create-customer modal used by invoice creation, then selects the new customer immediately.
- Line quantity/price/discount and overall percentage/fixed discount; totals mirror the backend rules.
- `validUntil` is a date input (`YYYY-MM-DD`); preview falls back to today when empty.
- Draft-only editing is enforced by the page and the API.
- Responsive: preview stacks under the form on small screens; print CSS removes the preview chrome.

### 4.4 Detail (`pages/sales/QuotationDetail.tsx`)

- Shared `QuotationDocument` inside `.print-area`; toolbar and timeline are `.no-print`.
- Actions are explicit per status: edit, mark sent, accept, reject (with reason), revise, convert, delete (Admin).
- “Mark as sent” is always an explicit action — downloading/printing/sharing never mutates the status.
- Timeline, revision links, and converted-invoice link (correct Admin/Sales path).
- Print/download via browser print; WhatsApp via normalized `wa.me`; Web Share for text/url where supported.
- The shared WhatsApp/share message itemizes every line as `unit price × quantity = line total`, then shows the quotation total (plus a subtotal/discount row when the quotation is discounted). Monetary values are rounded to whole numbers; quantities keep their decimals only when they are genuinely fractional (e.g. meters).

### 4.5 Conversion UX (`pages/sales/NewInvoice.tsx`)

- Loads the quotation, validates `SENT`/`ACCEPTED` and not expired, then pre-fills customer, items, discounts, and note.
- Shows a conversion banner; blocks saving if the quotation cannot be loaded.
- Submits `fromQuotationId`; the backend re-validates everything.
- Applies the prefill once, then removes `fromQuotationId` from the URL after success/reset.

### 4.6 Admin report (`features/reports/pages/QuotationsReportPage.tsx`)

- Date range, salesperson, status, and search filters.
- KPI cards (counts by status, quoted value, converted value, conversion rate).
- By-status and per-salesperson tables, paginated detail table, print header/limit warning.
- `ExcelExportButton` gained an optional `loadRows` callback so “export” fetches the full `all=1` dataset instead of exporting only the visible page.
- Added as an Admin-only tab in `ReportsLayout`.

### 4.7 Shared frontend utilities

- `lib/quotationTotals.ts` — the exact client-side mirror of backend math (used by form + preview + tests).
- `lib/quotationPhone.ts` — normalizes `0xxxxxxxxxx`, `+20…`, `0020…` to `20xxxxxxxxxx`; rejects non-Egyptian-mobile values; builds the encoded `wa.me` URL.
- `features/quotations/*` — document/labels/columns/status badge/preview data.
- `QuotationStatusBadge` was added separately rather than broadening the generic `StatusChip`.
- i18n: full `quotations` and `quotationReport` blocks in `ar.ts`/`en.ts`, status labels, page titles/subtitles, `errors.quotation` messages, and friendly-error mapping for quotation API codes.
- CSS: `.quotation-form-layout`, `.quotation-form-fields`, `.quotation-form-preview`, `.quotation-live-preview` (zoom scaling), `.quotation-detail-layout`, `.quotation-document-scroll`, responsive breakpoints, and print overrides. No physical `left/right`-only RTL hacks.

---

## 5. Files

### 5.1 Created — backend

```
backend/prisma/migrations/20261111200233_quotations/migration.sql
backend/src/common/quotation-totals.util.ts
backend/src/common/quotation-totals.util.spec.ts
backend/src/common/quotation-time.util.ts
backend/src/common/quotation-time.util.spec.ts
backend/src/quotations/quotations.module.ts
backend/src/quotations/quotations.controller.ts
backend/src/quotations/quotations.service.ts
backend/src/quotations/quotation-expiry.service.ts
backend/src/quotations/quotation-state.util.ts
backend/src/quotations/quotation-state.util.spec.ts
backend/src/quotations/dto/create-quotation.dto.ts
backend/src/quotations/dto/update-quotation.dto.ts
backend/src/quotations/dto/reject-quotation.dto.ts
backend/src/quotations/dto/revise-quotation.dto.ts
backend/test/quotations.e2e-spec.ts
```

### 5.2 Changed — backend

```
backend/prisma/schema.prisma                 # status/event enums + four models + relations
backend/src/app.module.ts                    # register QuotationsModule
backend/src/invoices/dto/create-invoice.dto.ts  # optional fromQuotationId
backend/src/invoices/invoices.service.ts     # conversion validation + atomic claim + event
backend/test/global-setup.ts                 # truncate quotation tables
backend/test/setup.ts                        # truncate quotation tables
```

### 5.3 Created — frontend

```
frontend/src/pages/sales/Quotations.tsx
frontend/src/pages/sales/QuotationForm.tsx
frontend/src/pages/sales/QuotationDetail.tsx
frontend/src/features/quotations/index.ts
frontend/src/features/quotations/quotationLabels.ts
frontend/src/features/quotations/quotationDocumentData.ts
frontend/src/features/quotations/quotationShareText.ts
frontend/src/features/quotations/quotationShareText.test.ts
frontend/src/features/quotations/useQuotationColumns.tsx
frontend/src/features/quotations/components/QuotationDocument.tsx
frontend/src/features/quotations/components/QuotationStatusBadge.tsx
frontend/src/features/reports/pages/QuotationsReportPage.tsx
frontend/src/lib/quotationTotals.ts
frontend/src/lib/quotationTotals.test.ts
frontend/src/lib/quotationPhone.ts
frontend/src/lib/quotationPhone.test.ts
```

### 5.4 Changed — frontend

```
frontend/src/App.tsx                         # Sales/Admin quotation + report routes
frontend/src/components/Sidebar.tsx          # nav entries (Sales/Admin only)
frontend/src/types/index.ts                  # quotation/report types
frontend/src/i18n/ar.ts                      # quotations + report copy
frontend/src/i18n/en.ts                      # quotations + report copy
frontend/src/lib/messages.ts                 # friendly quotation error codes
frontend/src/index.css                       # layouts, live preview, responsive + print rules
frontend/src/hooks/useRealtimeEvents.ts      # invalidate ["quotations"] on events
frontend/src/pages/sales/NewInvoice.tsx      # quotation prefill + fromQuotationId
frontend/src/features/reports/index.ts       # export report page
frontend/src/features/reports/components/ReportsLayout.tsx  # Admin report tab
frontend/src/features/reports/components/ExcelExportButton.tsx  # full-dataset loadRows
frontend/package.json                        # quotation tests in npm test
```

> The working tree also contains many unrelated pre-existing uncommitted changes (dashboard, change requests, printing, docs deletions, `.rar` files, audit artifacts). They were not modified or reverted as part of this feature.

---

## 6. Decisions and assumptions

1. **Admin conversion permission (please confirm).** The brief’s permission matrix lists Sales as converter and Admin as “all + report + delete,” but does not explicitly grant/deny Admin conversion. I allowed **Admin to create/edit/send/accept/reject/revise/convert** (Admin is a superset), while **delete stays Admin-only**. If Admin should not be able to convert, change the service `assertCanMutate`/status checks and hide the convert action for Admin.
2. **Sales can view all quotations but only mutate their own.** This matches the brief. Object ownership is checked in the service, not just the controller.
3. **Expiry is inclusive end-of-day in `Africa/Cairo`.** Storing the end-of-day instant keeps all comparisons as UTC and avoids the classic “expired at 00:00” bug. `validUntil` submitted as `YYYY-MM-DD` is converted server-side.
4. **Effective expiry on read.** Reads never require the sweep to have run; `SENT` + past validity is displayed as `EXPIRED`.
5. **Discount order:** line discounts first, then percentage on the net subtotal, then fixed discount, floored at zero.
6. **Conversion preserves the quoted total** by collapsing all quotation discounts into one invoice-level fixed discount. This avoids re-deriving invoice math and guarantees the customer pays exactly what was quoted. It means the invoice does not display the quotation’s per-line discount breakdown.
7. **Conversion rate denominator excludes DRAFT.** Only quotations that were actually issued can convert.
8. **Report KPIs respect the status filter.** Converted KPIs are zero unless the selected status is `CONVERTED`; otherwise a DRAFT filter would display historical conversions unrelated to the filtered set.
9. **Own quotation numbering** via `QuotationSequence`, independent of `InvoiceSequence`.
10. **No new scheduler library.** An `unref`’d interval is sufficient for a single-process deployment; it is not a distributed scheduler.
11. **No new frontend libraries.** Reused the existing printing layout, table, pagination, Excel export, realtime hooks, and UI primitives.
12. **WhatsApp uses `wa.me`** with Egyptian mobile normalization. Invalid numbers produce no link rather than a broken URL.
13. **Native share is text/url only.** The project has no PDF generator, so “download” is the browser’s print-to-PDF path; the Web Share API is offered only where the browser supports text/url sharing.
14. **Soft-deleted quotations are excluded from every list, detail, report, totals, and conversion path.**
15. **`UPDATED` audit events store before/after metadata** rather than a human-only message, so the timeline can show what changed.

---

## 7. Schema deviations from the brief

- **No `customerCompany` snapshot.** The existing `Customer` model has no company field, so only `customerName` and `customerPhone` are snapshotted.
- **`validUntil` is a `TIMESTAMP`, not a date.** It stores the inclusive Cairo end-of-day instant (documented above).
- **No quotation currency column.** The system uses one configured currency (as invoices do); adding a per-quotation currency would have introduced a second source of truth.
- **`convertedInvoiceId` is nullable + unique + `onDelete: SetNull`.** Uniqueness is the concurrency guard; `SetNull` keeps historical quotations readable if an invoice is ever removed by an admin path.
- **`QuotationSequence` is a table, not a database sequence.** This mirrors `InvoiceSequence` and keeps numbering transactional and continuous.
- **`revisedFromId` is a self-relation with `SetNull`.** A revision stays linked while the source exists and is not orphan-deleted with it.

---

## 8. How to run

### 8.1 Backend

```powershell
cd backend
npm install
npx prisma migrate deploy      # or: npx prisma migrate dev
npx prisma generate
npm run start:dev
```

The API is served under the existing prefix (for example `http://localhost:3000/api`). `QuotationExpiryService` starts automatically and performs its first sweep after 15 seconds.

### 8.2 Frontend

```powershell
cd frontend
npm install
npm run dev
```

Log in as a Sales or Admin user. Sales/Admin see **عروض الأسعار** in the sidebar; Admin also sees the quotation report tab under Reports.

### 8.3 Tests

```powershell
# backend unit
cd backend
npx jest src/common/quotation-totals.util.spec.ts src/common/quotation-time.util.spec.ts
npx jest src/quotations/quotation-state.util.spec.ts

# backend e2e (WARNING: truncates the configured test/dev database)
npx jest --config ./test/jest-e2e.json --runInBand test/quotations.e2e-spec.ts

# frontend
cd frontend
npm test
npm run build
npm run lint
```

### 8.4 Manual test checklist

**Sales**
1. Create a draft with multiple products, a line discount, a percentage discount, and a fixed discount; confirm the live preview and saved total match.
2. Edit the draft; confirm only DRAFT is editable.
3. Mark it sent; confirm the badge changes and the timeline records the event.
4. Open the print view: title says **عرض سعر**, totals match, browser print-to-PDF works, and printing does **not** change the status.
5. Try WhatsApp/share with a valid and an invalid Egyptian number.
6. Accept it, then convert from the detail page; confirm New Invoice is pre-filled and the invoice is created as `PENDING_ACCOUNTANT`.
7. Re-open the quotation; confirm it is `CONVERTED`, links to the invoice, and cannot be edited/deleted/converted again.
8. Revise a sent/rejected/expired quotation; confirm a linked new DRAFT is created.
9. As a second Sales user, open another user’s quotation: read-only actions should be rejected by the API.
10. Confirm Accountant/Inventory have no quotation nav entry and receive `403` on direct API calls.

**Expiry**
11. Create a quotation with `validUntil` = today, then verify it is still valid until 23:59 Cairo and converts successfully that day.
12. Create one with a past date; confirm it displays `EXPIRED`, cannot be accepted/converted, and can be revised.
13. Wait for/trigger the sweep; confirm the persisted status becomes `EXPIRED` and a realtime update arrives.

**List/report**
14. Verify pagination, sorting, status/customer/employee/date filters, and debounced search.
15. Confirm an overdue `SENT` row appears under `EXPIRED`, not `SENT`.
16. As Admin, open Reports → Quotations; verify KPIs, per-salesperson rows, and that soft-deleted quotations are absent.
17. Export `.xlsx`; confirm it contains the full filtered dataset (not just the visible page).
18. Open two browser tabs, create/update/convert in one, and confirm the other updates without a refresh.

**Responsive/RTL**
19. Check the list, split-screen form, preview, detail, and report at mobile width in Arabic RTL; no horizontal overflow, controls remain reachable, and the preview stacks under the form.
20. Print from a narrow viewport; confirm the print layout is full-width A4 and the toolbar/banners are hidden.

---

## 9. Limitations, risks, and follow-ups

1. **Sweep is process-local.** `QuotationExpiryService` works for one backend process. If the API is scaled horizontally, either ensure only one instance sweeps or add a DB-level lock/advisory lock. Reads and lifecycle re-checks make stale expiry non-critical, but persisted `EXPIRED` events may be delayed or duplicated.
2. **Conversion is only reachable through the UI/API invoice path.** There is no standalone “convert” endpoint; that is intentional so invoice creation stays single-source. Any future bulk-conversion tool must reuse the same atomic claim.
3. **Invoice discount presentation.** Conversion collapses quotation discounts into one invoice fixed discount, so the invoice won’t show the original per-line discount split. The total is exact; only the presentation differs. If the accountant needs the breakdown, add an invoice line-discount field (a broader invoice change).
4. **No standalone PDF file.** “Download” is the browser’s print-to-PDF. Web Share therefore shares text/url, not a PDF attachment. Adding a PDF generator is a separate infrastructure decision.
5. **Product picker uses `ALL_OPTIONS_LIMIT`.** Very large catalogs could hit that limit; the existing product-model endpoint has no remote search integration in the quotation form. Reuse the existing paginated search if the catalog grows.
6. **DTO validation is not exercised by e2e.** The e2e app does not install the global `ValidationPipe`, so invalid-payload rejection is covered by types and service guards, not by runtime DTO validation in tests. Production wiring does install it; add e2e coverage if this area becomes security-sensitive.
7. **Report detail export cap.** `all=1` is capped at 5000 rows. For larger date ranges the export is intentionally bounded; add streaming/chunked export if needed.
8. **No currency column.** If multi-currency quotations become a requirement, this needs a schema + pricing decision, not just a UI field.
9. **Admin conversion permission is an assumption** (see §6.1) and should be confirmed with the product owner.
10. **Pre-existing test failure (not fixed, reported):** `backend/src/realtime/realtime.controller.audit.spec.ts` expects one audit write but observes two. It is unrelated to quotations and was left untouched per the “report, don’t fix unrelated issues” rule. All quotation suites pass.
11. **Pre-existing lint warnings.** The frontend linter reports `set-state-in-effect`, unused imports, and fast-refresh warnings across the codebase, including three new quotation files. They follow existing patterns and are not errors; no lint errors were introduced.
12. **Bundle-size warning.** Vite reports a chunk over 500 kB (pre-existing app size); the quotation feature adds to the main chunk. Route-level lazy loading would be the follow-up if bundle size matters.
13. **Working tree hygiene.** The repository has many unrelated uncommitted changes (including deleted docs and `.rar` artifacts). The quotation feature was kept isolated logically but is not committed; review/stage it deliberately before committing.

---

## 10. Suggested follow-ups (priority order)

1. Confirm the Admin-conversion permission decision; adjust guards/UI if needed.
2. Add a distributed lock (or single-sweeper deployment note) if the API runs multiple instances.
3. Decide whether invoices need the original quotation discount breakdown.
4. Add a real PDF generator if WhatsApp/Web Share must attach a file.
5. Add e2e payload-validation tests once the test app mirrors production pipes.
6. Triage the pre-existing `realtime.controller.audit.spec.ts` failure separately.
