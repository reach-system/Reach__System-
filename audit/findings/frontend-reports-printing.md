# Findings — frontend reports, printing, inventory & kiosk

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `frontend/src/pages/inventory/CategoriesModels.tsx` | 514 | complete |
| `frontend/src/pages/inventory/Home.tsx` | 616 | complete |
| `frontend/src/pages/inventory/InvoiceDelivery.tsx` | 622 | complete |
| `frontend/src/pages/inventory/ReceiveShipment.tsx` | 419 | complete |
| `frontend/src/pages/inventory/Stock.tsx` | 445 | complete |
| `frontend/src/pages/inventory/StockAdjustments.tsx` | 502 | complete |
| `frontend/src/pages/inventory/UnitSearch.tsx` | 298 | complete |
| `frontend/src/pages/kiosk/KioskLogin.tsx` | 118 | complete |
| `frontend/src/pages/kiosk/KioskPage.tsx` | 278 | complete |
| `frontend/src/features/reports/index.ts` | 12 | complete |
| `frontend/src/features/reports/types.ts` | 175 | complete |
| `frontend/src/features/reports/components/ExcelExportButton.tsx` | 215 | complete |
| `frontend/src/features/reports/components/PrintButton.tsx` | 91 | complete |
| `frontend/src/features/reports/components/PrintHeader.tsx` | 80 | complete |
| `frontend/src/features/reports/components/ReportDetailTable.tsx` | 191 | complete |
| `frontend/src/features/reports/components/ReportKpiCard.tsx` | 203 | complete |
| `frontend/src/features/reports/components/ReportPrintLimitWarning.tsx` | 22 | complete |
| `frontend/src/features/reports/components/ReportsLayout.tsx` | 84 | complete |
| `frontend/src/features/reports/hooks/useReportDetails.ts` | 28 | complete |
| `frontend/src/features/reports/hooks/useReportPrint.ts` | 70 | complete |
| `frontend/src/features/reports/pages/CustomerReportPage.tsx` | 493 | complete |
| `frontend/src/features/reports/pages/EmployeeSalesReportPage.tsx` | 210 | complete |
| `frontend/src/features/reports/pages/ExpensesReportPage.tsx` | 114 | complete |
| `frontend/src/features/reports/pages/InventoryReportPage.tsx` | 310 | complete |
| `frontend/src/features/reports/pages/NetProfitReportPage.tsx` | 84 | complete |
| `frontend/src/features/reports/pages/ProductSalesReportPage.tsx` | 238 | complete |
| `frontend/src/features/reports/pages/ReportsIndexPage.tsx` | 3 | complete |
| `frontend/src/features/reports/pages/ReturnsReportPage.tsx` | 179 | complete |
| `frontend/src/features/reports/pages/RevenueReportPage.tsx` | 843 | complete |
| `frontend/src/features/reports/pages/SupplierReportPage.tsx` | 630 | complete |
| `frontend/src/features/printing/print.css` | 851 | complete |
| `frontend/src/features/printing/components/DisbursementVoucherDocument.tsx` | 376 | complete |
| `frontend/src/features/printing/components/InvoiceDocument.tsx` | 366 | complete |
| `frontend/src/features/printing/components/PrintDocumentLayout.tsx` | 657 | complete |
| `frontend/src/features/printing/utils/disbursementVoucherData.test.ts` | 98 | complete |
| `frontend/src/features/printing/utils/disbursementVoucherData.ts` | 51 | complete |
| `frontend/src/features/printing/utils/formatters.test.ts` | 37 | complete |
| `frontend/src/features/printing/utils/formatters.ts` | 66 | complete |
| `frontend/src/features/printing/utils/invoiceDocumentData.ts` | 102 | complete |
| `frontend/src/features/printing/utils/printDocument.ts` | 49 | complete |
| `frontend/src/i18n/ar.ts` | 1199 | complete |
| `frontend/src/i18n/context.tsx` | 56 | complete |
| `frontend/src/i18n/en.ts` | 1199 | complete |
| `frontend/src/i18n/index.ts` | 22 | complete |
| `frontend/src/index.css` | 884 | complete |

---

## FR-01 — Printed reports silently stop at 1,000 rows

- **Severity:** S2
- **Location:** `frontend/src/features/reports/hooks/useReportPrint.ts:12-23`
- **Evidence:**
  ```ts
  export function useReportPrint(allLimit = 1000) {
    const { t } = useI18n();
    const [printLimit, setPrintLimit] = useState<number | undefined>(undefined);
    const pendingRef = useRef(false);
    const printTimerRef = useRef<number | null>(null);
    const restoreRef = useRef<(() => void) | null>(null);

    const requestPrint = useCallback(() => {
      if (pendingRef.current) return;
      pendingRef.current = true;
      setPrintLimit(allLimit);
    }, [allLimit]);
  ```
- **Root cause:** Every report page passes `printLimit` as `limit` to its list endpoint and forces `page: 1` (e.g. `InventoryReportPage.tsx:42`, `SupplierReportPage.tsx:76-79`, `ExpensesReportPage.tsx:37`). Nothing paginates past the first 1,000 rows, and `ExpensesReportPage` / `NetProfitReportPage` do not render `ReportPrintLimitWarning` at all.
- **Impact at scale:** With 5M invoices or 100k products, any month-end or date-range report over 1,000 rows prints a truncated document that looks complete. On the pages without the warning the truncation is completely silent, so paper records, customer statements and finance totals disagree with the database.
- **Reproduction:** Seed 1,500 invoices in the selected range, open Revenue or Customer report, click Print, and count rows in the print preview (1,000). Repeat on Expenses and confirm no warning is shown.
- **Fix:** Do not print from a single capped fetch. Add a server-side export/PDF endpoint, or implement cursor pagination that fetches all pages with progress and a hard row ceiling. When `total > limit`, fail closed (or print a prominent warning) on every report page.
- **Verification:** Intercept `/reports/*` and assert the `limit`; run with `total = 1500` and confirm the print preview contains all 1,500 rows or refuses to print with an explicit error.
- **Status:** - [ ] Fixed

---

## FR-02 — Detail drill-down loads every detail row into the DOM

- **Severity:** S2
- **Location:** `frontend/src/features/reports/components/ReportDetailTable.tsx:100-104`
- **Evidence:**
  ```tsx
  const detailQuery = useReportDetails<{ items?: T[] }>({
    endpoint: rowId ? `${endpoint}/${rowId}/details` : `${endpoint}/details`,
    params: { from, to },
    enabled: enabled,
  });
  ```
- **Root cause:** The detail query sends only `from`/`to` — no `page`, `limit` or cursor — and the resulting `rows` are rendered by `<Table>` without virtualization (`ReportDetailTable.tsx:159`). `useReportDetails` also has no cap (`useReportDetails.ts:22-24`).
- **Impact at scale:** “Show all details” for a one-year range over 5M invoices can return hundreds of thousands of invoice lines in a single JSON payload, then mount every row. The tab freezes or crashes, and concurrent users multiply backend memory pressure.
- **Reproduction:** Open the Customer report with a one-year range, click “Show all details”, and watch the `/reports/customers/details` response size and DOM row count grow unbounded.
- **Fix:** Paginate or cursor the detail endpoints, virtualize the table, and lazy-load one group at a time. Impose a server-side maximum and show “refine your filters” instead of returning everything.
- **Verification:** Network trace shows a bounded `limit`; DOM contains at most one page of detail rows for any date range.
- **Status:** - [ ] Fixed

---

## FR-03 — Default report dates use UTC `toISOString()` and shift the range

- **Severity:** S2
- **Location:** `frontend/src/features/reports/pages/SupplierReportPage.tsx:32-40`
- **Evidence:**
  ```tsx
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });

  const [dateTo, setDateTo] = useState(
    () => new Date().toISOString().slice(0, 10)
  );
  ```
- **Root cause:** `toISOString()` converts the local instant to UTC. In `Africa/Cairo` (UTC+2/+3), any local time before roughly 02:00/03:00 maps to the previous UTC date, so “today” becomes yesterday. The same pattern exists in `ProductSalesReportPage.tsx:27-32`, `EmployeeSalesReportPage.tsx:27-32`, `ReturnsReportPage.tsx:26-31`, `ExpensesReportPage.tsx:23-28`, `NetProfitReportPage.tsx:21-26`, and `InventoryReportPage.tsx:26`.
- **Impact at scale:** Early-morning users in Egypt (the primary locale) open a report and silently exclude the current day’s sales, returns and expenses; on the 1st of a month the range can start on the previous month’s last day. Printed and exported figures are wrong exactly when daily close is performed.
- **Reproduction:** Run with `TZ=Africa/Cairo`, set the system clock to 00:30, open the Supplier report; `dateTo` renders yesterday’s date.
- **Fix:** Use the local-component formatter already present in `RevenueReportPage.tsx:36-42` (`getFullYear` / `getMonth` / `getDate`) in a shared utility and replace every `toISOString().slice(0, 10)` in the report pages.
- **Verification:** Add a unit test with fake timers at 00:30 in `Africa/Cairo` asserting the default `dateTo` equals the local date.
- **Status:** - [ ] Fixed

---

## FR-04 — Stock status filter fetches 1,000 rows and paginates client-side

- **Severity:** S2
- **Location:** `frontend/src/pages/inventory/Stock.tsx:109-115`
- **Evidence:**
  ```tsx
  // Status filter is not supported server-side; fetch a large window for the
  // active search/category and paginate client-side for that view only.
  if (filterStatus) {
    params.limit = 1000;
  } else {
    params.page = page;
  }
  ```
- **Root cause:** The backend has no `status` filter, so the page fetches only the first 1,000 matching models, filters them in memory (`Stock.tsx:143-151`) and derives `totalPages` / `displayTotal` from the filtered subset (`Stock.tsx:153-167`). Rows after the first 1,000 are unreachable in filtered mode.
- **Impact at scale:** With 100k product models, “damaged” or “sold” filters report incomplete counts and hide most matches; the pagination footer claims a smaller total than reality. Inventory decisions are made from a 1,000-row sample.
- **Reproduction:** Seed 1,200 models, mark a model at position 1,100 as damaged, select the “Damaged” filter — the model is absent and the count is wrong.
- **Fix:** Add a `status` query parameter to `/stock-items/inventory-count` and return a correct filtered `total`; keep server-side pagination in all modes.
- **Verification:** API response `meta.total` matches the filtered count; navigating to the last page shows rows beyond the first 1,000.
- **Status:** - [ ] Fixed

---

## FR-05 — Inventory dashboard totals are computed from the first 1,000 rows

- **Severity:** S2
- **Location:** `frontend/src/pages/inventory/Home.tsx:131-157`
- **Evidence:**
  ```tsx
  const [inventoryRes, attRes, receiptRes] = await Promise.allSettled([
    api.get<InventoryCountResponse>("/stock-items/inventory-count", {
      params: { page: 1, limit: 1000 },
      signal,
    }),
    ...
  ]);

  if (inventoryRes.status === "fulfilled") {
    const totals = inventoryRes.value.data.data.reduce<InventoryTotals>(
      (summary, item) => ({
        available: summary.available + (item.isSerialized ? item.available || 0 : item.quantityAvailable || 0),
        sold: summary.sold + (item.isSerialized ? item.sold || 0 : 0),
        damaged: summary.damaged + (item.isSerialized ? item.damaged || 0 : 0),
        total: summary.total + (item.isSerialized ? item.totalUnits || 0 : item.quantityReceived || 0),
      }),
      { available: 0, sold: 0, damaged: 0, total: 0 },
    );
    setInventoryTotals(totals);
  } else {
    setInventoryTotals({ available: 0, sold: 0, damaged: 0, total: 0 });
  }
  ```
- **Root cause:** The dashboard aggregates inventory counts in the browser from a hard-capped page of 1,000 models. `Promise.allSettled` also turns any inventory failure into all-zero KPIs with no visible error.
- **Impact at scale:** With more than 1,000 models the “available / sold / damaged / total” tiles under-count, and a transient backend error shows a plausible-looking zero dashboard. Users cannot distinguish “no stock” from “request failed”.
- **Reproduction:** Seed 1,500 models, compare the Home totals with the Stock page or a SQL aggregate; then block `/stock-items/inventory-count` and reload to see zeros with no error state.
- **Fix:** Add a dedicated aggregate endpoint (e.g. `/stock-items/inventory-count/summary`) returning server-computed totals, and render an explicit partial-failure state instead of zeroing.
- **Verification:** Dashboard totals equal the database aggregate for 100k models; a forced 500 shows an error tile rather than zeros.
- **Status:** - [ ] Fixed

---

## FR-06 — `window.print()` races the React commit via a fixed 100 ms timer

- **Severity:** S2
- **Location:** `frontend/src/features/reports/hooks/useReportPrint.ts:41-47`
- **Evidence:**
  ```ts
  printTimerRef.current = window.setTimeout(() => {
    printTimerRef.current = null;
    void prepareAndPrint().catch(() => {
      restore();
      notify.error(t.reports.printPrepareFailed);
    });
  }, 100);
  ```
- **Root cause:** Pages call `notifyReady()` immediately after `setData(res)` (e.g. `InventoryReportPage.tsx:46-47`), and this hook waits an arbitrary 100 ms before printing. That delay is not synchronized with React’s commit or the browser’s paint, and `prepareAndPrint` only waits for fonts/images, not for layout of newly mounted rows.
- **Impact at scale:** On a slow device or with the 1,000-row print table, the commit can exceed 100 ms; the print dialog captures the previous page, a partially rendered table, or blank space. The failure is intermittent and environment-dependent, making support reports hard to reproduce.
- **Reproduction:** Throttle CPU 6× in DevTools, open a report with 1,000 rows, click Print; the preview sometimes shows the old paginated table or an incomplete first page.
- **Fix:** Drive printing from an effect that runs after the print dataset has committed (e.g. a `useLayoutEffect` keyed on the resolved data/limit), then await two `requestAnimationFrame`s plus `document.fonts.ready` before calling `window.print()`. Remove the magic 100 ms timer.
- **Verification:** Under 6× CPU throttling, print previews consistently contain all rows; repeat 20 times with no stale frame.
- **Status:** - [ ] Fixed

---

## FR-07 — Aborting the print re-fetch leaves the page stuck in 1,000-row mode

- **Severity:** S2
- **Location:** `frontend/src/features/reports/pages/InventoryReportPage.tsx:48-51`
- **Evidence:**
  ```tsx
  } catch (err) {
    if (isAbortError(err)) return;
    if (printLimit) notifyFailed();
    setData(null);
  }
  ```
- **Root cause:** Every report page returns early on `AbortError` before calling `notifyFailed()`. If the user changes a filter/date (or the effect is re-run) while the print re-fetch is in flight, `pendingRef` stays `true` and `printLimit` stays `1000`. `useReportPrint` only clears them in `notifyReady` / `notifyFailed` (`useReportPrint.ts:25-55`).
- **Impact at scale:** A single filter change during a slow print leaves the report permanently in 1,000-row mode with no print dialog; subsequent Print clicks are ignored because `pendingRef.current` is still `true`. Users must reload the page, and on large datasets the window for this race is seconds.
- **Reproduction:** Click Print on a report, immediately change the date range; no dialog appears and the table stays on the print limit. Click Print again — nothing happens.
- **Fix:** Add a `notifyCancelled` path that resets `pendingRef` and `printLimit` when the print fetch is aborted, and distinguish abort from a real failure in every report page.
- **Verification:** Abort the print fetch by changing filters mid-flight; `printLimit` returns to `undefined` and a second Print click works.
- **Status:** - [ ] Fixed

---

## FR-08 — Invoice delivery queue is fetched and rendered without pagination

- **Severity:** S2
- **Location:** `frontend/src/pages/inventory/InvoiceDelivery.tsx:83-87`
- **Evidence:**
  ```tsx
  const fetchInvoices = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Invoice>>("/invoices/delivery-queue", { signal });
      setInvoices(data.data || []);
    } catch (err) {
      if (isAbortError(err)) return;
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  ```
- **Root cause:** `/invoices/delivery-queue` is called with no `page` or `limit`, and the full array is passed straight to `<Table>` (`InvoiceDelivery.tsx:357-361`). `useRealtimeRefresh` re-runs the same unbounded fetch for every `invoice.confirmed`, `invoice.delivery.scan` and `invoice.delivered` event (`InvoiceDelivery.tsx:130-133`).
- **Impact at scale:** With 5M invoices and thousands pending delivery, each load and each realtime event transfers and mounts the entire queue. The page becomes unresponsive, and a busy warehouse generates a refetch storm across every open delivery station.
- **Reproduction:** Seed 5,000 pending-delivery invoices, open Invoice Delivery, and observe response size/render time; fire several realtime events and watch repeated full-queue requests.
- **Fix:** Add server-side pagination and status filtering to the delivery queue, virtualize the table, and debounce/coalesce realtime refreshes (or patch the affected row locally).
- **Verification:** Network requests carry a bounded `limit`; DOM row count never exceeds one page; a burst of 50 realtime events produces at most one refetch.
- **Status:** - [ ] Fixed

---

## FR-09 — Model pickers load up to 10,000 rows and render them all

- **Severity:** S2
- **Location:** `frontend/src/pages/inventory/CategoriesModels.tsx:66-73`
- **Evidence:**
  ```tsx
  const fetchModels = React.useCallback(async (signal?: AbortSignal) => {
    setModelLoading(true);
    try {
      const res = await api.get<PaginatedResponse<ProductModel>>("/product-models", {
        params: { page: 1, limit: ALL_OPTIONS_LIMIT },
        signal,
      });
      setModels(res.data.data);
    } catch (err) {
      if (isAbortError(err)) return;
      setModels([]);
    } finally {
      if (!signal?.aborted) setModelLoading(false);
    }
  }, []);
  ```
- **Root cause:** `ALL_OPTIONS_LIMIT` is `10_000` (`frontend/src/hooks/queries.ts:11`). `CategoriesModels` renders every fetched model in a `<Table>` with no search or pagination (`CategoriesModels.tsx:346-350`). The same pattern loads 10,000 models for the adjustment form (`StockAdjustments.tsx:89-95`) and for the receive-shipment picker via `useProductModelsByCategory` (`ReceiveShipment.tsx:82`).
- **Impact at scale:** With 100k product models, every picker silently truncates at 10,000 — models beyond the cap cannot be selected, edited or received — and each page mounts a 10k-row table plus a 10k-option `<select>`, freezing the UI.
- **Reproduction:** Seed 20,000 models, open Inventory → Categories & Models: only the first 10,000 are listed and search cannot find the rest. Open Stock Adjustments and try to select a model created after the cap.
- **Fix:** Replace “load all” with server-side typeahead/search (`limit ≈ 50`) and paginate the models table. Never use a 10k-option select.
- **Verification:** Picker issues a search request per keystroke; no request exceeds 100 rows; every model is reachable by name.
- **Status:** - [ ] Fixed

---

## FR-10 — Excel export writes only the current page

- **Severity:** S3
- **Location:** `frontend/src/features/reports/pages/CustomerReportPage.tsx:319`
- **Evidence:**
  ```tsx
  <ExcelExportButton filename="customer-report" rows={data?.items ?? []} />
  ```
- **Root cause:** Each page passes the currently loaded page of rows (default `limit` 10–25) to `ExcelExportButton`, which writes exactly those rows (`ExcelExportButton.tsx:73-100`). The print path re-fetches with a larger limit, but export does not. The same bug exists in `EmployeeSalesReportPage.tsx:81`, `ProductSalesReportPage.tsx:123`, `ReturnsReportPage.tsx:66`, `InventoryReportPage.tsx:257`, `SupplierReportPage.tsx:311-314`, and `ExpensesReportPage.tsx:66`.
- **Impact at scale:** A user exports a 5M-invoice report and receives 10–25 rows, believing the workbook is complete. Downstream reconciliation and audits are based on a page-sized sample.
- **Reproduction:** Open the Customer report with more than one page, click “Export Excel”, and compare the workbook row count with `meta.total`.
- **Fix:** Export through a dedicated server endpoint, or fetch all pages (with the same cap/warning as print) before building the workbook. If page-only export is intentional, label the button accordingly.
- **Verification:** Exported row count equals the report total (or the export is explicitly labelled and disabled beyond the cap).
- **Status:** - [ ] Fixed

---

## FR-11 — Malformed orphan `@page` declarations in `print.css`

- **Severity:** S3
- **Location:** `frontend/src/features/printing/print.css:1-24`
- **Evidence:**
  ```css
  @page report-landscape {
    size: A4 landscape;
    margin: 12mm;

    @bottom-center {
      content: counter(page) " / " counter(pages);
      color: #555;
      font-family: "Manrope", "Cairo", Arial, sans-serif;
      font-size: 9pt;
    }
  }

  /* Default @page is provided by PrintDocumentLayout (4mm margin) for invoices/vouchers.
     Reports use the named 'report-landscape' page above. */
    size: A4 landscape;
    margin: 12mm;

    @bottom-center {
      content: counter(page) " / " counter(pages);
      color: #555;
      font-family: "Manrope", "Cairo", Arial, sans-serif;
      font-size: 9pt;
    }
  }
  ```
- **Root cause:** Lines 15–23 duplicate the `@page` body outside any at-rule, and line 24 is a stray `}`. CSS error recovery discards the whole malformed qualified rule, so this block is dead code. Any future edit to the “second copy” has no effect.
- **Impact at scale:** Not a runtime data bug, but it makes page geometry fragile: a minifier, CSS parser upgrade or well-meaning edit can change the effective `@page` rules, altering landscape margins for every printed report. It also hides the fact that there is exactly one valid page definition.
- **Reproduction:** Run a CSS parser or `npx stylelint frontend/src/features/printing/print.css`; it reports a parse error at line 15/24.
- **Fix:** Delete lines 15–24 and keep a single `@page report-landscape` block.
- **Verification:** Stylelint/CSS parser reports no errors; printed report retains A4 landscape and 12 mm margins.
- **Status:** - [ ] Fixed

---

## FR-12 — Date-only strings print one day early in negative UTC offsets

- **Severity:** S3
- **Location:** `frontend/src/features/printing/utils/formatters.ts:43-52`
- **Evidence:**
  ```ts
  export function formatPrintDate(
    value: string | Date,
    locale = "en-GB",
  ): string {
    return new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(assertValidDate(value));
  }
  ```
- **Root cause:** `assertValidDate` does `new Date(value)`. A date-only string such as `"2026-11-04"` is parsed as UTC midnight; `Intl.DateTimeFormat` then renders it in the local timezone. In any UTC-negative offset (e.g. `America/New_York`) that is the previous local day.
- **Impact at scale:** Invoices, disbursement vouchers and report rows print with the wrong calendar date for users in the Americas or any negative-offset locale. Dates on signed financial documents disagree with the database and with local expectations.
- **Reproduction:** Run with `TZ=America/New_York` and call `formatPrintDate("2026-11-04")`; it returns `11/03/2026`.
- **Fix:** Detect `YYYY-MM-DD` strings and format them from their components (or construct a local `Date(year, month - 1, day)`), rather than relying on `new Date(string)`.
- **Verification:** Unit test under `TZ=America/New_York` asserts `formatPrintDate("2026-11-04") === "04/11/2026"` (locale-adjusted).
- **Status:** - [ ] Fixed

---

## FR-13 — `formatPrintNumber` throws during render on a single bad value

- **Severity:** S3
- **Location:** `frontend/src/features/printing/utils/formatters.ts:3-9`
- **Evidence:**
  ```ts
  function toFiniteNumber(value: PrintableValue): number {
    const number = value == null ? 0 : Number(value);
    if (!Number.isFinite(number)) {
      throw new RangeError(`Cannot format non-finite printable value: ${value}`);
    }
    return number;
  }
  ```
- **Root cause:** The formatter throws for `NaN`/`Infinity`/non-numeric strings, and it is called directly inside render functions (e.g. `fmt(data.totals.stockValue)` and every table cell). React has no error boundary around report tables, so one bad value unmounts the whole report.
- **Impact at scale:** With 5M rows and data imported from multiple sources, a single `"N/A"`, `"Infinity"` or malformed numeric field blanks the entire report and its print output. The user sees a generic crash instead of the other 999 valid rows.
- **Reproduction:** Render `formatPrintNumber("N/A" as any)` or feed a report row with a non-numeric amount; the page throws.
- **Fix:** Return a placeholder (`"—"`) or `0` and log the anomaly; never throw from a display formatter. If strictness is required, validate at the data boundary, not during render.
- **Verification:** Unit test passes `"N/A"`, `NaN`, `Infinity` and asserts a placeholder without throwing; a report with one bad row still renders.
- **Status:** - [ ] Fixed

---

## FR-14 — Hard-coded Arabic/English UI strings bypass i18n

- **Severity:** S3
- **Location:** `frontend/src/features/reports/pages/InventoryReportPage.tsx:98-126`
- **Evidence:**
  ```tsx
  {
  key: "type",
  label: "Serial",
  ...
      {row.isSerialized ? "بسيريال" : "بدون سيريال"}
  ```
  ```tsx
  // RevenueReportPage.tsx:708-709
  {t.reports.clearFilters ??
    "مسح الفلاتر"}
  ```
  ```tsx
  // PrintButton.tsx:88
  {isPrinting ? "Preparing..." : label ?? t.reports.print}
  ```
  ```tsx
  // ExcelExportButton.tsx:212
  {exporting ? "Preparing workbook..." : "Export Excel"}
  ```
  ```tsx
  // DisbursementVoucherDocument.tsx:359,363
  <span>{labels.name ?? "الاسم"}</span>
  <span>{labels.deliveryDate ?? "التاريخ"}</span>
  ```
- **Root cause:** Literal strings are used instead of translation keys. Some are Arabic-only (`بسيريال` / `بدون سيريال`, `مسح الفلاتر`), others English-only (`Serial`, `Preparing...`, `Export Excel`), and the voucher fallbacks are Arabic even in English mode.
- **Impact at scale:** The UI is not actually bilingual: English users see Arabic serial labels and voucher fields, Arabic users see English print/export states. New locales cannot be added, and translators cannot find these strings.
- **Reproduction:** Switch language in the header, open Inventory report and the invoice/voucher print preview, and observe mixed-language labels.
- **Fix:** Add keys for `serialized`, `notSerialized`, `clearFilters`, `preparing`, `preparingWorkbook`, `exportExcel`, `name`, `deliveryDate`, and use `t.*` everywhere. Remove the `|| "..."` fallbacks that duplicate existing keys.
- **Verification:** `grep` for Arabic characters and quoted UI literals under `features/reports`, `features/printing` and `pages/inventory` returns none; both locales render consistently.
- **Status:** - [ ] Fixed

---

## FR-15 — English net-profit formula omits cost of goods sold

- **Severity:** S3
- **Location:** `frontend/src/i18n/en.ts:213`
- **Evidence:**
  ```ts
  netProfitFormula: "Net profit = Net sales - expenses",
  ```
  ```ts
  // frontend/src/i18n/ar.ts:213
  netProfitFormula: "صافي الربح = صافي المبيعات - تكلفة البضاعة المباعة - المصروفات",
  ```
- **Root cause:** The Arabic string correctly subtracts COGS; the English string omits it. The two locales describe different accounting formulas for the same report.
- **Impact at scale:** English-speaking finance users read a definition that overstates net profit by the entire cost of goods sold. Decisions based on the on-screen formula (and printed report header) are materially wrong.
- **Reproduction:** Switch to English, open Net Profit report, and compare the formula hint with the Arabic version.
- **Fix:** Align the English string: `"Net profit = Net sales - COGS - expenses"`.
- **Verification:** Both locale strings contain the COGS term; a snapshot test asserts parity of the formula semantics.
- **Status:** - [ ] Fixed

---

## FR-16 — Kiosk cannot recover from a failed context load

- **Severity:** S2
- **Location:** `frontend/src/pages/kiosk/KioskPage.tsx:58-69`
- **Evidence:**
  ```tsx
  (async () => {
    try {
      const { data } = await api.get<KioskContext>("/attendance/kiosk/me", { signal });
      if (!signal.aborted) setContext(data);
    } catch {
      if (!signal.aborted) setError(t.kiosk.notConfigured);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  })();
  ```
- **Root cause:** The context request runs once per mount. On failure it sets `error` and leaves `context` null; the render path (`KioskPage.tsx:118-137`) only offers a sign-out button — there is no retry, backoff, or revalidation on `online`/`visibilitychange`.
- **Impact at scale:** A single transient 500, proxy timeout or network blip at shift start leaves the attendance kiosk unusable until a human reloads the browser. With many kiosks, one backend hiccup can take them all offline at the busiest time.
- **Reproduction:** Block `/attendance/kiosk/me` once (DevTools “Block request URL”), load `/kiosk`, then unblock; the page stays on the error/sign-out screen.
- **Fix:** Add exponential-backoff retry with a visible “Retry” button, and re-fetch when the tab becomes visible or the browser comes back online. Distinguish “not configured” (permanent) from transport errors (retryable).
- **Verification:** A simulated 500 followed by success recovers automatically without a reload; the retry button also works.
- **Status:** - [ ] Fixed

---

## FR-17 — Kiosk schedules two independent QR refreshes at expiry

- **Severity:** S3
- **Location:** `frontend/src/pages/kiosk/KioskPage.tsx:84-111`
- **Evidence:**
  ```tsx
  useEffect(() => {
    if (!qr) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const remaining = Math.max(
        0,
        Math.floor((new Date(qr.expiresAt).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        void fetchQr(action);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [qr, action, fetchQr]);

  useEffect(() => {
    if (!qr) return;
    const ms = Math.max(
      POLL_MARGIN_MS,
      new Date(qr.expiresAt).getTime() - Date.now(),
    );
    const timeout = setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      void fetchQr(action);
    }, ms);
    return () => clearTimeout(timeout);
  }, [qr, action, fetchQr]);
  ```
- **Root cause:** Two effects independently trigger `fetchQr` at (or after) `expiresAt`: the 1-second interval when `remaining <= 0`, and a separate `setTimeout` at the expiry margin. `inFlightRef` only blocks concurrent calls; once the first completes, the other timer can still fire and request a second QR.
- **Impact at scale:** Every kiosk generates roughly twice the QR-generation requests per cycle, churning tokens and load on the attendance backend. A just-issued QR can be replaced by a second response, confusing a user who is already scanning.
- **Reproduction:** Instrument `POST /attendance/kiosk/qr` with a slow response and observe two requests around each expiry.
- **Fix:** Use one scheduler: a `setTimeout` at `expiresAt + margin` that is cleared and re-armed when `qr` changes. Keep the 1-second interval only for the countdown display, with no fetch side effect.
- **Verification:** Exactly one `POST /attendance/kiosk/qr` per QR cycle in the network log.
- **Status:** - [ ] Fixed

---

## FR-18 — Global print rule hides every `<header>`, including print-document headers

- **Severity:** S4
- **Location:** `frontend/src/index.css:690-695`
- **Evidence:**
  ```css
  /* Hide app chrome, reveal only the print-area subtree */
  aside,
  header,
  .no-print {
    display: none !important;
  }
  ```
  ```tsx
  // frontend/src/features/printing/components/PrintDocumentLayout.tsx:597-608
  const headerClass = [
    "print-document__header",
    headerVisibility === "print" ? "print-document__header--print-only" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={`print-document ${className}`.trim()} dir={dir}>
      <style>{PRINT_DOCUMENT_CSS}</style>

      <header className={headerClass}>
  ```
- **Root cause:** The global `header { display: none !important }` is unscoped. `headerVisibility="print"` happens to survive only because `.print-document__header--print-only { display: block !important }` has higher specificity. `headerVisibility="always"` (used by `InvoiceDocument` when `mode === "preview"`, `InvoiceDocument.tsx:178`) has no override, so its `<header>` is hidden when printing.
- **Impact at scale:** Printing an invoice preview drops the branded header (logo, business name, document type) while the rest of the invoice prints — an inconsistent official document. Any future `<header>` placed inside `.print-area` silently disappears as well.
- **Reproduction:** Render `InvoiceDocument` with `mode="preview"`, invoke print, and observe the missing header band; the same document with `mode="saved"` prints correctly.
- **Fix:** Scope the chrome-hiding rule to the app shell (e.g. `body > #root > .app-shell > header`, `aside`, `.no-print`) or explicitly restore `.print-area header, .print-document__header { display: block !important; }`.
- **Verification:** Preview-mode print shows the header; the app sidebar/topbar remain hidden in print.
- **Status:** - [ ] Fixed

---

## FR-19 — Print preparation can wait forever on a hanging image

- **Severity:** S3
- **Location:** `frontend/src/features/printing/utils/printDocument.ts:1-38`
- **Evidence:**
  ```ts
  function waitForImage(image: HTMLImageElement): Promise<void> {
    if (image.complete) {
      return image.naturalWidth > 0
        ? Promise.resolve()
        : Promise.reject(new Error("A print document image failed to load."));
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        image.removeEventListener("load", onLoad);
        image.removeEventListener("error", onError);
      };
      ...
      image.addEventListener("load", onLoad, { once: true });
      image.addEventListener("error", onError, { once: true });
    });
  }

  export async function prepareAndPrint(): Promise<void> {
    ...
    await document.fonts.ready;
    const images = Array.from(
      document.querySelectorAll<HTMLImageElement>(
        ".print-area img, [data-print-root] img",
      ),
    );
    await Promise.all(images.map(waitForImage));
  ```
- **Root cause:** `waitForImage` settles only on `load` or `error`. An image request that stalls (CDN/proxy that accepts the connection but never responds) leaves the promise pending forever, so `Promise.all` and `prepareAndPrint` never reach `window.print()`. There is no timeout or abort.
- **Impact at scale:** A single hanging logo/brand asset blocks every print for that user with no feedback beyond “Preparing…”. At scale, a CDN incident turns into a fleet-wide printing outage.
- **Reproduction:** Point `brand.logoUrl` at a server that accepts the request but never responds, click Print, and observe that the dialog never opens and no error toast appears.
- **Fix:** Race each image wait against a short timeout (e.g. 3–5 s), resolve on timeout (optionally log/skip), and add an overall timeout around font/image preparation so `window.print()` always runs.
- **Verification:** With a hanging image, print opens within the timeout; broken images are skipped rather than blocking.
- **Status:** - [ ] Fixed

---

## FR-20 — Page-number margin box is unsupported in browser print engines

- **Severity:** S4
- **Location:** `frontend/src/features/printing/print.css:5-10`
- **Evidence:**
  ```css
  @bottom-center {
    content: counter(page) " / " counter(pages);
    color: #555;
    font-family: "Manrope", "Cairo", Arial, sans-serif;
    font-size: 9pt;
  }
  ```
- **Root cause:** `@bottom-center` is a CSS Paged Media margin box. Chrome and Firefox do not implement margin boxes, so the declaration is ignored; only dedicated paged-media renderers honor it.
- **Impact at scale:** Multi-page reports print without “page X / Y”, making assembly, verification and photocopying error-prone. The CSS suggests page numbers exist, so the omission is easy to miss.
- **Reproduction:** Print a report that spans three pages in Chrome and inspect the footer — no page numbers appear.
- **Fix:** Render page numbers in the document itself (e.g. a repeating footer with CSS counters per printed page) or generate the PDF server-side with a renderer that supports margin boxes. Remove the misleading rule if browser printing is the target.
- **Verification:** A three-page print/PDF contains “1 / 3”, “2 / 3”, “3 / 3”.
- **Status:** - [ ] Fixed
