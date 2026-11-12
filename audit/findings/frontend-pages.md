# Findings — frontend pages (sales, accountant, admin, login)

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `frontend/src/pages/Login.tsx` | 150 | complete |
| `frontend/src/pages/sales/Attendance.tsx` | 277 | complete |
| `frontend/src/pages/sales/Customers.tsx` | 271 | complete |
| `frontend/src/pages/sales/Home.tsx` | 238 | complete |
| `frontend/src/pages/sales/InvoiceDetail.tsx` | 864 | complete |
| `frontend/src/pages/sales/InvoiceSearch.tsx` | 258 | complete |
| `frontend/src/pages/sales/MyRequests.tsx` | 142 | complete |
| `frontend/src/pages/sales/NewChangeRequest.tsx` | 564 | complete |
| `frontend/src/pages/sales/NewInvoice.tsx` | 1050 | complete |
| `frontend/src/pages/accountant/Expenses.tsx` | 215 | complete |
| `frontend/src/pages/accountant/PendingInvoices.tsx` | 445 | complete |
| `frontend/src/pages/admin/Attendance.tsx` | 236 | complete |
| `frontend/src/pages/admin/AuditHistory.tsx` | 455 | complete |
| `frontend/src/pages/admin/ChangeRequests.tsx` | 302 | complete |
| `frontend/src/pages/admin/CustomerDebts.tsx` | 498 | complete |
| `frontend/src/pages/admin/Customers.tsx` | 302 | complete |
| `frontend/src/pages/admin/Dashboard.tsx` | 148 | complete |
| `frontend/src/pages/admin/Employees.tsx` | 442 | complete |
| `frontend/src/pages/admin/Expenses.tsx` | 1864 | complete |
| `frontend/src/pages/admin/InvoiceDetail.tsx` | 1029 | complete |
| `frontend/src/pages/admin/Invoices.tsx` | 163 | complete |
| `frontend/src/pages/admin/Notifications.tsx` | 292 | complete |
| `frontend/src/pages/admin/Reports.tsx` | 0 | complete |
| `frontend/src/pages/admin/Settings.tsx` | 252 | complete |
| `frontend/src/pages/admin/StockPricing.tsx` | 219 | complete |
| `frontend/src/pages/admin/Suppliers.tsx` | 221 | complete |
| `frontend/src/pages/admin/UnitSearch.tsx` | 298 | complete |

---

## FP-01 — Invoice detail race lets the accountant confirm/reject the wrong invoice

- **Severity:** S1
- **Location:** `frontend/src/pages/accountant/PendingInvoices.tsx:60-71`
- **Evidence:**
  ```ts
  const openDetail = async (invoice: Invoice) => {
    setDetailLoading(true);
    setSelectedInvoice(invoice);
    try {
      const { data } = await api.get(`/invoices/${invoice.id}`);
      setSelectedInvoice(data);
    } catch {
      // handle silently
    } finally {
      setDetailLoading(false);
    }
  };
  ```
- **Root cause:** Every row click starts an independent, non-abortable `GET /invoices/:id` and unconditionally writes the response into `selectedInvoice`. There is no request id, no `AbortController`, and no check that the resolved id still equals the row the user last clicked. The confirm/reject footer acts on whatever `selectedInvoice` currently holds (`handleConfirm` → `PATCH /invoices/${selectedInvoice.id}/confirm`, lines 73-86).
- **Impact at scale:** On the unreliable networks this app targets, responses routinely arrive out of order. The accountant clicks invoice A, then B; B resolves first, A resolves second, the modal silently flips to A, and "Confirm" approves A. A wrong invoice is posted to the ledger with a stock/COGS side effect that requires a change request to undo. The same race exists when the realtime refresh fires (`useRealtimeRefresh`, line 56) while a detail request is in flight.
- **Reproduction:** DevTools → Network → throttle to "Slow 3G" (or add a 3 s delay on `/invoices/:id` for the first id). Open Pending Invoices, click invoice A, immediately click invoice B. Watch the modal header: it ends on A. Press Confirm → the `PATCH` URL contains A's id while the user selected B.
- **Fix:** Keep a `detailRequestId` ref (or `AbortController` stored in a ref): abort the previous request, increment the id on each click, and only `setSelectedInvoice` if the id matches the latest. Additionally render the modal only when `selectedInvoice.id === lastClickedId`, disable the footer while `detailLoading`, and clear `selectedInvoice` at the start of each load so stale content can never be actioned.
- **Verification:** With the throttle in place, click A then B and assert (a) only one request is pending after the second click, (b) the modal never shows A after B was clicked, (c) the confirm `PATCH` path id equals the barcode/number visible in the modal. Add a unit test that resolves the two promises in reverse order and asserts the state keeps B.
- **Status:** - [ ] Fixed

---

## FP-02 — Change-request detail race lets an admin approve the wrong request

- **Severity:** S1
- **Location:** `frontend/src/pages/admin/ChangeRequests.tsx:57-67`
- **Evidence:**
  ```ts
  const loadDetail = async (id: number) => {
    setDetailLoading(true);
    try {
      const res = await api.get(`/change-requests/${id}`);
      setSelected(res.data);
    } catch {
      /* empty */
    } finally {
      setDetailLoading(false);
    }
  };
  ```
- **Root cause:** Same unguarded last-write-wins pattern as FP-01, but the payload mutates invoices: `handleApprove` (lines 69-81) sends `PATCH /change-requests/${selected.id}/approve` and the backend applies price changes, returns and added items. `selected` is overwritten by whichever detail response resolves last, and the list highlight (`selected?.id === req.id`, line 156) follows that stale object, so the screen can look "correct" while targeting the wrong request.
- **Impact at scale:** A mis-approval permanently changes invoice totals, refunds money, and returns stock — a financial correction that requires manual reconciliation. On a slow link the window is seconds wide; admins processing a queue click rows rapidly, which is exactly the workload here.
- **Reproduction:** Throttle the network, open `/admin/change-requests` (status Pending), click request #1 then request #2 quickly. When the detail panel settles, press Approve. Inspect the `PATCH` URL in the Network tab — it is `#1`, not `#2`.
- **Fix:** Same guard as FP-01: abort/invalidate in-flight detail loads, key the detail panel by the clicked id, and pass the id explicitly to `handleApprove(id)` from a "currently loaded" check (`if (selected?.id !== requestedId) return`). Disable Approve/Reject while `detailLoading`.
- **Verification:** Reverse-order resolution test (resolve request 1 after request 2) asserting `selected.id` stays 2 and the approve call uses 2. Manual: throttled double-click must produce a single request and the approve URL must match the visible request number.
- **Status:** - [ ] Fixed

---

## FP-03 — Invoice screen downloads 10,000 customers and renders them in one dropdown

- **Severity:** S2
- **Location:** `frontend/src/pages/sales/NewInvoice.tsx:173-174`
- **Evidence:**
  ```ts
  const invalidateOptions = useInvalidateOptions();
  const { data: customerOptions = [] } = useCustomerOptions(customerSearch);
  ```
- **Root cause:** `useCustomerOptions` defaults to `ALL_OPTIONS_LIMIT = 10_000` (`frontend/src/hooks/queries.ts:11,73`) and issues `GET /customers?page=1&limit=10000` immediately on mount (empty search). The result is kept whole in memory and every row is mapped to a `<button>` in the dropdown (lines 440-469). It is a full dump, not a search-as-you-type query.
- **Impact at scale:** At 100k customers each keystroke either re-requests up to 10k rows or filters a 10k array; the response is multi-megabyte on a phone network, and opening the picker mounts up to 10k DOM nodes with inline hover handlers. Memory, parse time and INP all degrade, and the 10k cap silently hides customers beyond the first page — the cashier cannot bill them.
- **Reproduction:** Seed 100k customers, open `/sales/new-invoice` with the Network panel open: observe a single `/customers?...limit=10000` request, several MB of JSON, and a visible freeze when focusing the customer field. Search for a customer whose id is > 10000 — no result.
- **Fix:** Use a small page size (e.g. 20) with server-side `search` and only fetch when the input has ≥2 characters or the field is focused; add `enabled: trimmed.length >= 2` to the query, keep `placeholderData` for flicker-free typing, and cap rendered results. For walk-in flows keep a "create customer" path instead of a full list.
- **Verification:** Network tab shows `limit=20` (or no request before typing); typing "أحم" returns matching customers including ones ranked beyond 10k; `Performance` profile of focusing the field shows no long task > 100 ms; DOM node count for the dropdown stays < 100.
- **Status:** - [ ] Fixed

---

## FP-04 — Invoice screen loads the entire product catalog once, with no cache and no error state

- **Severity:** S2
- **Location:** `frontend/src/pages/sales/NewInvoice.tsx:177-189`
- **Evidence:**
  ```ts
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    api
      .get("/product-models", { params: { page: 1, limit: ALL_OPTIONS_LIMIT }, signal })
      .then((res) => {
        if (signal.aborted) return;
        const payload = res.data?.data ?? res.data;
        setAllModels(Array.isArray(payload) ? payload : []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  ```
- **Root cause:** Raw `api.get` inside a mount-only effect, `limit: 10000`, no TanStack Query key, no `staleTime`, no retry, and a bare `.catch(() => {})`. The catalog is rebuilt from scratch on every visit and is never refreshed after an admin adds a model; a failed request is indistinguishable from an empty catalog.
- **Impact at scale:** With 100k products the request exceeds the 10k cap, so newer models are simply absent; the payload is large and duplicated on every navigation back to the screen. On a dropped packet the "model" and "category" selects render empty, `addDisabled` stays true (line 253) and the cashier cannot add a single line, with no error message or retry.
- **Reproduction:** Block `/product-models` in DevTools → open `/sales/new-invoice`: both selects are empty, no error is shown, Add is disabled. Create a product model in another tab, return to the invoice screen: it is not in the list. Watch the request fire again on every mount.
- **Fix:** Move to `useQuery` keyed `["product-models","options"]` with `staleTime` and expose `isError`/`refetch`; render an inline retry ("تعذر تحميل المنتجات — إعادة المحاولة"). Load models per category (server-side `categoryId`) or via a searchable endpoint instead of the whole catalog, and invalidate the key from the admin model mutations.
- **Verification:** Offline test shows an error + retry instead of empty selects; adding a model in admin and returning shows it without a hard reload; only one request is made across repeated navigations (React Query devtools).
- **Status:** - [ ] Fixed

---

## FP-05 — Change-request picker fetches 10,000 of 5M invoices and filters eligibility client-side

- **Severity:** S2
- **Location:** `frontend/src/pages/sales/NewChangeRequest.tsx:97-114`
- **Evidence:**
  ```ts
  async function loadPicker() {
    setPickerLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Invoice>>("/invoices", {
        params: { page: 1, limit: ALL_OPTIONS_LIMIT },
        signal,
      });
      const eligible = (data.data ?? []).filter(
        (row) => row.status === "CONFIRMED" || row.status === "DELIVERED",
      );
      setInvoices(eligible);
    } catch (err) {
      if (isAbortError(err)) return;
      setInvoices([]);
    } finally {
      if (!signal.aborted) setPickerLoading(false);
    }
  }
  ```
- **Root cause:** The "which invoice do you want to edit/return?" picker is implemented as "download the first 10,000 invoices of the whole company, then filter in the browser". Eligibility is a server-side property (`status`) but is evaluated client-side over an arbitrary, unsorted page.
- **Impact at scale:** With 5M invoices the first 10k are almost all old/cancelled rows, so the filtered list is frequently empty and the user sees "no eligible invoices" (line 295) while thousands exist. The 10k payload also blocks the page for seconds, and the `<Select>` (line 298) receives up to 10k `<option>`s.
- **Reproduction:** On a database with >10k invoices, open `/sales/change-request` with no id. Observe one `limit=10000` request and an empty or unrelated short list. Search for a recent confirmed invoice in Invoice Search — it exists but is absent from this picker.
- **Fix:** Add a server endpoint/params (`status=CONFIRMED,DELIVERED`, `search`, `limit=20`, `page`) and drive the picker from debounced server search (or require the user to arrive from the invoice detail page, which already knows the id). Never filter eligibility client-side over a truncated page.
- **Verification:** With >10k invoices, the picker request carries the status filter and a small limit; searching a recent invoice number returns it; the request payload is < 100 KB; no client-side `.filter(...status...)` remains.
- **Status:** - [ ] Fixed

---

## FP-06 — Change-request screen loads 10,000 product models and linearly searches them per row per render

- **Severity:** S2
- **Location:** `frontend/src/pages/sales/NewChangeRequest.tsx:116-127`
- **Evidence:**
  ```ts
  async function loadModels() {
    try {
      const { data } = await api.get<PaginatedResponse<ProductModel>>("/product-models", {
        params: { page: 1, limit: ALL_OPTIONS_LIMIT },
        signal,
      });
      setModels(data.data ?? []);
    } catch (err) {
      if (isAbortError(err)) return;
      setModels([]);
    }
  }
  ```
- **Root cause:** Full-catalog dump into component state, then used both as a 10k-option `<Select>` (lines 508-511) and as a lookup table via `models.find(...)` inside the `.map` of add-rows (line 497) and again in `buildPayload` (line 219). Every keystroke in any quantity/price input re-renders the whole form and re-runs the linear scans.
- **Impact at scale:** O(rows × 10k) work per render, a 10k-node option list, multi-MB JSON per visit, and models beyond the cap are unselectable. On the low-end Android devices used at the counter this is a multi-hundred-ms freeze per keystroke.
- **Reproduction:** Seed 100k product models, open a change request, click "add line", then type digits into the quantity field while profiling: long tasks on each keypress; the select opens with a visible delay.
- **Fix:** Replace the dump with a searchable model picker (server `search` + `limit=20`) and build a `Map<number, ProductModel>` with `useMemo` for O(1) lookups. Reuse the same query key/invalidation as FP-04.
- **Verification:** Profiling shows no long task while typing; select contains only the current search results; `models.find` no longer appears in render paths (`Map.get` instead).
- **Status:** - [ ] Fixed

---

## FP-07 — Customer debts screen paginates the entire customer table in parallel (1000 requests at 100k)

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/CustomerDebts.tsx:106-126`
- **Evidence:**
  ```ts
  const firstPage = await api.get<PaginatedResponse<Customer>>("/customers", {
    params: { page: 1, limit: 100 },
    signal,
  });
  const allCustomers = firstPage.data.data;
  const totalPages = firstPage.data.meta.totalPages;
  if (totalPages > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, index) =>
        api.get<PaginatedResponse<Customer>>("/customers", {
          params: { page: index + 2, limit: 100 },
          signal,
        }),
      ),
    );
    allCustomers.push(...remainingPages.flatMap((response) => response.data.data));
  }
  setCustomerOptions(allCustomers);
  ```
- **Root cause:** The customer filter needs options, so the page discovers `totalPages` and immediately fires **all remaining pages at once** with `Promise.all`, then concatenates them into one array. `Promise.all` is all-or-nothing, so a single failed page (very likely at 1000 parallel requests on a flaky link) discards every successfully loaded page and disables the filter (line 353).
- **Impact at scale:** 100k customers ÷ 100 = **1000 concurrent GETs** on every mount of the page (and again on every language toggle, because the effect depends on `t` via `fetchAllCustomers`, line 135/141). This saturates the browser connection pool, hammers the API, blocks the main thread while parsing ~100k records, and holds the whole list in memory — for a filter dropdown.
- **Reproduction:** Seed 100k customers, open `/admin/customer-debts` with the Network panel open: observe ~1000 requests and a multi-second freeze. Throttle to Slow 3G and abort one request: the filter becomes disabled with an error toast even though most pages loaded.
- **Fix:** Delete the eager dump. Use a debounced server-side searchable select (`useCustomerOptions` pattern, small limit) and/or filter debts server-side by `search`; the debts table already accepts `customerId`. If a full list is truly required, page sequentially with a hard cap and `Promise.allSettled` + partial results.
- **Verification:** Opening the page issues 1–2 small requests instead of ~1000; the customer filter returns matches beyond the first page; failing one request does not wipe the options; memory/heap after mount is flat versus page count.
- **Status:** - [ ] Fixed

---

## FP-08 — Accountant expense date defaults to UTC and is frozen at module load

- **Severity:** S2
- **Location:** `frontend/src/pages/accountant/Expenses.tsx:26`
- **Evidence:**
  ```ts
  const emptyForm: ExpenseForm = { categoryId: "", amount: "", date: new Date().toISOString().slice(0, 10), description: "" };
  ```
- **Root cause:** Two independent bugs in one line. (1) `toISOString()` converts to UTC, so in `Africa/Cairo` (UTC+2, UTC+3 under DST) any local time between 00:00 and 02:00/03:00 yields the **previous** calendar day. (2) `emptyForm` is a module-level constant evaluated once when the bundle loads, so the "today" default never advances; the same object is reused by `useState<ExpenseForm>(emptyForm)` (line 37) and by `openCreate` (`setForm(emptyForm)`, line 77).
- **Impact at scale:** Expenses get posted to the wrong accounting day — at month end this moves amounts between periods and breaks the daily/monthly expense totals on the dashboard. Because the date is frozen, a tab left open overnight (normal for a shop counter) keeps defaulting to yesterday for every new expense until a full reload. There is no server-side correction: the value is sent as-is (line 114).
- **Reproduction:** Set the OS timezone to `Africa/Cairo` and the clock to 00:30 → open the page → the date field shows yesterday. Separately, open the page at 23:59, wait past midnight, click "Add expense" → the field still shows the previous day.
- **Fix:** Replace the constant with a factory that formats the **local** date, e.g. `const getToday = () => { const d = new Date(); return \`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}\`; }` and call it inside `openCreate` / `useState(() => createEmptyForm())` — exactly the pattern already used in `frontend/src/pages/admin/Expenses.tsx:40-59`.
- **Verification:** Unit test with `TZ=Africa/Cairo` and a mocked clock at `2026-11-05T00:30:00+02:00` expects `2026-11-05`; a second test that advances the mocked clock by 24h and calls `openCreate` expects the new date. Manual: leave the tab open across midnight and confirm the field rolls over.
- **Status:** - [ ] Fixed

---

## FP-09 — Admin attendance filter defaults to the UTC date (off-by-one in Cairo)

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/Attendance.tsx:31`
- **Evidence:**
  ```ts
  const [dateFilter, setDateFilter] = useState(() => new Date().toISOString().slice(0, 10));
  ```
- **Root cause:** `toISOString()` formats in UTC while the page (and the backend's `startDate`/`endDate` contract) is in local `Africa/Cairo` time. Between local midnight and 02:00/03:00 the initializer produces yesterday's date.
- **Impact at scale:** The admin opens Attendance in the early morning — the busiest check-in window — and sees yesterday's rows or an empty table (`EmptyState`, line 177) while staff are actively checking in. It also drives the "total hours" footer (lines 104-108) from the wrong day, and the wrong day is then sent as both `startDate` and `endDate` (lines 45-48).
- **Reproduction:** `TZ=Africa/Cairo`, clock 00:30, open `/admin/attendance`: the date input shows the previous day and the request is `?startDate=<yesterday>&endDate=<yesterday>`. Compare with a check-in performed a minute ago — it is not listed.
- **Fix:** Format the local date (same helper as FP-08) or use the app's timezone-aware date util; also consider an explicit "Today" button and `max` on the input. Do not send a date derived from `toISOString()`.
- **Verification:** Mocked clock test at `2026-11-05T00:30+02:00` expects `2026-11-05` and a request for that day; manual check that a just-recorded check-in appears.
- **Status:** - [ ] Fixed

---

## FP-10 — Pending-invoice queue is hard-capped at 50 with no pagination or overflow indicator

- **Severity:** S2
- **Location:** `frontend/src/pages/accountant/PendingInvoices.tsx:34-41`
- **Evidence:**
  ```ts
  const fetchInvoices = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<Invoice>>("/invoices", {
        params: { status: "PENDING_ACCOUNTANT", limit: 50 },
        signal,
      });
      setInvoices(data.data || []);
  ```
- **Root cause:** A fixed `limit: 50` with no `page`, no `Pagination`, and `meta` discarded. The UI presents the result as the complete queue ("no pending invoices to review", line 170-172) rather than "page 1 of N".
- **Impact at scale:** During a backlog (or after a network outage that queues invoices) only 50 items are ever reachable from this screen. Once those 50 are confirmed they disappear from the list, so the queue technically advances — but the accountant has no count, no ordering control, and no way to jump; with 500 pending they must approve 50 at a time with no progress indicator, and any item that fails to refresh is invisible.
- **Reproduction:** Create 60 invoices (or stub the endpoint to return 60 and honour `limit`), open Pending Invoices: exactly 50 rows, no pagination controls, no total. Approve all 50: the remaining 10 only appear after the refetch, and the header never says how many are left.
- **Fix:** Add `page` state and the shared `<Pagination>` using `meta.total/totalPages`, plus a visible "N pending" badge. Better: keyset pagination ordered oldest-first so the queue is stable while items are removed.
- **Verification:** With 60 pending, the screen shows "60" and page 1/2; navigating pages reaches all 60; approving on page 1 keeps the user on a valid page and the count decrements.
- **Status:** - [ ] Fixed

---

## FP-11 — Approval screen mislabels the combined discount as a percentage discount

- **Severity:** S2
- **Location:** `frontend/src/pages/accountant/PendingInvoices.tsx:362-378`
- **Evidence:**
  ```ts
  Discount ({Number(selectedInvoice.discountPercentage || 0).toFixed(0)}%)
  ...
  {(
    Number(selectedInvoice.originalTotal || 0) -
    Number(selectedInvoice.currentTotal || 0)
  ).toFixed(2)}
  ```
- **Root cause:** The label prints only `discountPercentage`, but the amount is computed as `originalTotal − currentTotal`, which includes **both** the percentage discount and any fixed `discountAmount`. When an invoice has a fixed discount (or both), the row reads e.g. "Discount (0%) − 150.00" or "Discount (10%) − 250.00" — numbers that cannot both be true. The "Subtotal" label is also bound to `originalTotal`, which is the pre-discount total, not the sum of lines.
- **Impact at scale:** This is the accountant's only numeric evidence before pressing Confirm, and it is the last gate before an invoice is posted. A reviewer who checks the arithmetic sees an inconsistency and either blocks a valid invoice or approves one with an unintended discount. Because the values are `.toFixed(2)`-ed independently, the discrepancy is not a rounding artefact that can be explained away.
- **Reproduction:** Create an invoice with `discountPercentage = 10` **and** `discountAmount = 50` (allowed by `NewInvoice`), send it for review, open it in Pending Invoices: the row shows "Discount (10%)" next to an amount that is 10% + 50, and the percentage no longer explains the amount.
- **Fix:** Render the same breakdown the creation screen shows: `subtotal`, `percentageDiscount` (with its %), `fixedDiscount` (amount), `totalDiscount`, `total` — reading the persisted fields rather than deriving a single number. If the backend does not persist the split, compute `percentageDiscount = subtotal * pct/100` and `fixedDiscount = totalDiscount − percentageDiscount` and label them separately.
- **Verification:** For an invoice with 10% + 50 fixed, the modal shows three rows whose sum equals `originalTotal − currentTotal`; a component test asserts the labels and values for percentage-only, fixed-only and combined cases.
- **Status:** - [ ] Fixed

---

## FP-12 — Confirm/reject buttons re-enable before the refresh lands, allowing a duplicate action

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/InvoiceDetail.tsx:136-148`
- **Evidence:**
  ```ts
  const handleConfirm = async () => {
    if (!invoice) return;
    setPendingAction("confirm");
    try {
      await api.patch(`/invoices/${invoice.id}/confirm`);
      notify.success(SUCCESS_MESSAGES.invoice.confirmed);
      refresh();
    } catch (err) {
      notify.error(getFriendlyErrorMessage(err, t));
    } finally {
      setPendingAction(null);
    }
  };
  ```
- **Root cause:** `refresh()` is fire-and-forget (`void loadInvoice(); void loadAudit();`, lines 76-79) and `pendingAction` is cleared in `finally` as soon as the PATCH resolves. The rendered `invoice` object is still the old one with `status === "PENDING_ACCOUNTANT"`, so `isPending` stays true and both buttons become enabled again while the refresh is in flight. There is no optimistic status update and no guard on `invoice.status` inside the handler.
- **Impact at scale:** On a slow link (or when the follow-up GET is retried), the window between "PATCH ok" and "GET ok" is seconds. A double click, or an impatient second press, sends a second `confirm`/`reject` for an already-decided invoice; at best it produces a 409 toast that looks like a failure, at worst the backend records a conflicting transition. The same window exists after reject: the invoice still renders as Pending with a live Reject button.
- **Reproduction:** Throttle the network, open a pending invoice as admin, click Confirm twice in quick succession (or click Confirm, then click Reject during the refresh). Observe two PATCH requests and a misleading error toast on the second.
- **Fix:** Apply an optimistic local status (`setInvoice(prev => prev && { ...prev, status: "CONFIRMED" })`) before awaiting the refresh, and keep the action disabled until the refreshed invoice actually reports the new status (`pendingAction` cleared only after `await refresh()`), or track `decidedIds` to block re-submission. Make `refresh` return its promises so the handler can await them.
- **Verification:** Throttled test: after one click the buttons disappear/disable immediately and stay disabled until the new status renders; the Network panel shows exactly one PATCH regardless of double clicks. Add a test that resolves the PATCH but delays the GET and asserts no second PATCH is possible.
- **Status:** - [ ] Fixed

---

## FP-13 — Settings "save" buttons submit every section, so one section overwrites another with stale data

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/Settings.tsx:54-69`
- **Evidence:**
  ```ts
  const handleSave = async (section?: string) => {
    setSaving(true);
    setFeedback(null);
    try {
      await api.patch("/settings", form);
      await refresh();
  ```
- **Root cause:** Both buttons call the same handler (`handleSave("business")` line 208, `handleSave("invoices")` line 246) and the `section` argument is never used — the whole `form` (`businessName`, `address`, `phone`, `invoicePrefix`) is PATCHed every time. The form is seeded exactly once from the context (`seededRef`, lines 48-52), so it can be arbitrarily old.
- **Impact at scale:** This is a lost-update generator. Admin B opens Settings, admin A changes `invoicePrefix`; B then edits only the business phone and saves — the PATCH carries B's stale `invoicePrefix` and silently reverts A's change. Conversely, saving invoice settings with unsaved business-name edits commits them without the user asking. On a shared back-office this happens routinely, and nothing in the UI signals that other fields are being written.
- **Reproduction:** Two browsers, both admins. A changes the invoice prefix to `SAL-` and saves. B (page loaded before A's save) edits only the phone number and clicks "Save business info". Reload: the prefix is back to the old value; B's response returned 200.
- **Fix:** Send only the section's fields (`handleSave` should build `{businessName, address, phone}` or `{invoicePrefix}`), re-seed the form when `settings` changes and the form is pristine, and surface `updatedAt`/version-based conflict detection (409) rather than blind last-write-wins.
- **Verification:** Network payload for "Save invoice settings" contains only `invoicePrefix`; a two-browser test preserves A's prefix after B saves the phone; changing `settings` externally while the form is untouched updates the inputs.
- **Status:** - [ ] Fixed

---

## FP-14 — Stock-pricing work queue is capped at 50 rows with no pagination

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/StockPricing.tsx:29-36`
- **Evidence:**
  ```ts
  const fetchReceipts = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const { data } = await api.get<PaginatedResponse<StockReceipt>>("/stock-receipts/pending-pricing", {
        params: { limit: 50 },
        signal,
      });
      setReceipts(data.data || []);
  ```
- **Root cause:** Fixed `limit: 50`, no `page`, `meta` ignored, and the empty branch claims "all receipts priced" (line 200-202) whenever the returned page is empty.
- **Impact at scale:** A delivery of 200 unpriced receipts leaves 150 invisible; after the visible 50 are priced the list refills, but there is no count or navigation, so the operator cannot tell whether the queue is clear. Because pricing drives COGS, unpriced receipts silently distort profit reporting until someone happens to revisit the page.
- **Reproduction:** Seed 60 pending receipts, open `/admin/stock-pricing`: 50 rows, no pagination, no total. Price all 50 and observe the remaining 10 appear only after refetch with no indication that they existed.
- **Fix:** Add pagination/keyset with `meta.total` and show "N receipts awaiting pricing"; if the queue is meant to be drained, expose a "next batch" action and a count badge in the nav.
- **Verification:** With 60 receipts the header shows 60 and both pages are reachable; after pricing, the count decrements; an empty response is only shown when `meta.total === 0`.
- **Status:** - [ ] Fixed

---

## FP-15 — Unit search has no request ordering, so a fast re-scan can display and act on the previous unit

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/UnitSearch.tsx:50-73`
- **Evidence:**
  ```ts
  const handleScan = async (barcode: string) => {
    setSearching(true);
    setError("");
    setFound(false);
    setUnit(null);
    setAuditLog([]);

    try {
      const res = await api.get<ProductUnit>(`/product-units/barcode/${barcode}`);
      setUnit(res.data);
      setFound(true);
  ```
- **Root cause:** Each scan fires two un-abortable requests (unit + audit) and writes the response unconditionally. There is no request id and no `AbortController`; `executeAction` (lines 75-95) then mutates `unit.id` from whatever state won the race. `barcode` is also interpolated into the path without `encodeURIComponent`.
- **Impact at scale:** Barcode scanners emit a new code immediately after a failed or corrected scan. Scanning A then B on a slow link can end with A rendered (its barcode visible) while the operator believes B is loaded; pressing "Mark damaged" then damages the wrong physical unit. The audit fetch failing separately also leaves the lifecycle timeline empty without telling the user it failed (lines 62-67).
- **Reproduction:** Throttle to Slow 3G, scan unit A then immediately unit B. The panel settles on A. Press "Mark as damaged" and inspect the PATCH URL — it targets A.
- **Fix:** Abort the previous request (ref-held controller) and stamp each scan with an incrementing id; apply only the latest. Use `encodeURIComponent(barcode)`. Fetch the audit independently with its own error state, and disable action buttons while `searching`.
- **Verification:** Reverse-order test (A resolves after B) asserts the rendered barcode stays B and the action PATCH targets B; scanning a barcode containing `/` or `#` returns the correct unit.
- **Status:** - [ ] Fixed

---

## FP-16 — No error boundary anywhere, plus an unguarded `summary` access that white-screens the app

- **Severity:** S2
- **Location:** `frontend/src/pages/admin/CustomerDebts.tsx:328-340`
- **Evidence:**
  ```ts
  <div style={{ marginTop: 8, color: "var(--ink)", fontSize: 25, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
    {t.currency} {formatMoney(debtData?.summary.totalDebt)}
  </div>
  ...
  {debtData?.summary.customersWithDebt ?? "—"}
  ```
- **Root cause:** The optional chain stops at `debtData`; `summary` is not optional even though it is a page-specific extension of `PaginatedResponse` (`interface CustomerDebtResponse extends PaginatedResponse<CustomerDebt> { summary: ... }`, lines 25-30) that the generic list endpoint need not return. A 200 response shaped `{ data, meta }` (older backend, proxy, or a partial rollout) throws `Cannot read properties of undefined (reading 'totalDebt')` during render. `grep` over `frontend/src` finds no `ErrorBoundary` / `componentDidCatch`, so the throw unmounts the whole React tree and the user gets a blank page with no way back except reload.
- **Impact at scale:** Any unexpected payload shape or render-time exception in a page takes down the entire SPA, including navigation and unsaved invoice forms. In a shop with intermittent deploys this is a full-workflow outage, and the user cannot tell whether their data was saved.
- **Reproduction:** In DevTools, override the `/customer-debts` response to `{"data":[],"meta":{"page":1,"limit":20,"total":0,"totalPages":1}}` and open the page: the screen goes blank and the console shows a TypeError. The same happens for any render throw because there is no boundary.
- **Fix:** Use `debtData?.summary?.totalDebt` (and derive the numbers from `data` when `summary` is absent), then add route-level and app-level error boundaries that render a translated fallback with "reload"/"back" actions and report the error. Audit other nested chains (`row.items[0]?.productUnit.productModel` in `StockPricing.tsx:107`, `row.type.toLowerCase()` in `sales/Customers.tsx:134`) at the same time.
- **Verification:** The overridden payload renders zeros/em-dashes instead of blanking; a deliberate `throw` in a child page shows the fallback UI while the shell/nav stays usable; add a test that renders the page with a summary-less response.
- **Status:** - [ ] Fixed

---

## FP-17 — Network/server failures are rendered as "no data" or "not found" across the list pages

- **Severity:** S3
- **Location:** `frontend/src/pages/sales/Customers.tsx:50-55`
- **Evidence:**
  ```ts
  } catch (err) {
    if (isAbortError(err)) return;
    // handle silently
  } finally {
    if (!signal?.aborted) setLoading(false);
  }
  ```
- **Root cause:** The same pattern — `catch` that swallows everything except aborts, leaving the previous/empty state — is repeated in `frontend/src/pages/admin/Customers.tsx:51-56`, `frontend/src/pages/admin/Invoices.tsx:49-53`, `frontend/src/pages/admin/Suppliers.tsx:51-54`, `frontend/src/pages/admin/Employees.tsx:70-72`, `frontend/src/pages/admin/ChangeRequests.tsx:40-42`, `frontend/src/pages/accountant/Expenses.tsx:49-51`, `frontend/src/pages/sales/InvoiceSearch.tsx:51-56`, `frontend/src/pages/sales/MyRequests.tsx:30-32`, and `frontend/src/pages/sales/Attendance.tsx:30-32`. Because `loading` flips to `false`, the render falls into the empty branch ("no customers/invoices/requests"), which is a factual claim about the data, not about the request.
- **Impact at scale:** On an unreliable network a failed GET is indistinguishable from a genuinely empty result. Staff conclude the record does not exist and create duplicates (new customer, new invoice), or believe a just-created invoice vanished. `Attendance.tsx` is the sharpest case: a failed load sets `attendance` to `null` and the page confidently says "not checked in", inviting a second check-in. The invoice detail pages go further and show "invoice not found" for any error (`sales/InvoiceDetail.tsx:43-46`, `admin/InvoiceDetail.tsx:51-53`), including timeouts.
- **Reproduction:** DevTools → Offline (or block `GET /customers`) → open Customers: the screen shows the "no customers yet" empty state with a "create first customer" CTA, and no retry or error is offered. Repeat on Invoice Search: "no invoices" is shown for a timeout.
- **Fix:** Give each fetch an explicit `error` state (`isError`, message) and render a retryable error panel distinct from the empty state; only show "not found" on HTTP 404 and only show the empty state after a successful response. A shared `usePaginatedQuery`/`useApiQuery` wrapper (TanStack Query already installed) would remove the duplicated boilerplate.
- **Verification:** Offline test on each listed page shows an error + retry, never the empty state; restoring the network and pressing retry renders the data without a reload; a 500 on invoice detail shows "could not load", not "not found".
- **Status:** - [ ] Fixed

---

## FP-18 — Deleting the last row of the last page leaves the user trapped on an empty page

- **Severity:** S3
- **Location:** `frontend/src/pages/admin/Expenses.tsx:1013-1023`
- **Evidence:**
  ```ts
  try {
    await api.delete(
      `/expenses/${id}`
    );

    await fetchExpenses();

    notify.warning(
      SUCCESS_MESSAGES.expense
        .deleted
    );
  ```
- **Root cause:** The mutation refetches the **current** page and never reconciles `page` with the new `meta.totalPages`. If the deleted row was the last one on page N, the refetch returns an empty array, and the empty branch (`expenses.length === 0`, lines 1474-1500) renders *instead of* the table and pagination (pagination is inside the non-empty branch, lines 1513-1551), so there is no control to go back to page N−1. The same shape exists in `sales/Customers.tsx:111-120`, `admin/Customers.tsx:122-131`, `admin/Suppliers.tsx:104-113`, `accountant/Expenses.tsx:84-125`, and `admin/Employees.tsx:185-196`. Creating a record while on page > 1 has the mirror problem: the new row lands on page 1 and the user sees nothing change (`admin/Expenses.tsx:991-995`, `accountant/Expenses.tsx:117-118`).
- **Impact at scale:** With thousands of pages, a user who removes the last item of a filtered page is stuck on "no expenses found" while the list is not empty; the only escape is to change a filter or reload. It looks like a data-loss bug to the operator and generates support tickets.
- **Reproduction:** With 21 expenses, go to page 2 (1 row), delete it. The table disappears and "no expenses found" is shown with no pagination; the 20 rows on page 1 are unreachable from this screen.
- **Fix:** After the refetch, clamp the page: `if (meta.totalPages > 0 && page > meta.totalPages) setPage(meta.totalPages)`, and render pagination in the empty branch when `meta.total > 0`. For creates, reset to page 1 (or sort newest-first and keep page 1).
- **Verification:** Delete the only row on the last page → the view lands on the previous page with rows visible. Create an expense while on page 3 → the page resets to 1 and the new row is visible. Add a test for `page > totalPages` clamping.
- **Status:** - [ ] Fixed

---

## FP-19 — Sales home makes a redundant invoice request whose result is never rendered, and one failure blanks the whole page

- **Severity:** S3
- **Location:** `frontend/src/pages/sales/Home.tsx:31-45`
- **Evidence:**
  ```ts
  const [attRes, dashRes, invRes, pendingRes] = await Promise.all([
    api.get("/attendance/me/today", { signal }),
    api.get("/dashboard", { signal }),
    api.get<PaginatedResponse<Invoice>>("/invoices", { params: { page: 1, limit: 10, sort: "desc" }, signal }),
    api
      .get<PaginatedResponse<Invoice>>("/invoices", { params: { status: "PENDING_ACCOUNTANT", limit: 1 }, signal })
      .catch((err) => {
        if (isAbortError(err)) throw err;
        return { data: { meta: { total: 0 } } };
      }),
  ]);
  ...
  setPendingCount(pendingRes.data.meta?.total ?? 0);
  ```
- **Root cause:** `pendingCount` is declared (line 22) and set (line 45) but never read anywhere in the file — a second `/invoices` request is paid on every mount for a value that is discarded. Meanwhile `Promise.all` couples four independent endpoints: a 403 from `/dashboard` for the SALES role, or any transient failure on `/attendance/me/today`, rejects the whole batch, the `catch` swallows it (lines 46-48), `loading` becomes false, and the page renders the attendance card as "not checked in" plus "no invoices yet".
- **Impact at scale:** Duplicate work on the hottest landing page (every sales user, every login) and an all-or-nothing render that turns one flaky request into a page that misreports attendance and history. The same `Promise.all` pattern amplifies latency: the page waits for the slowest of four endpoints, including one that is not needed.
- **Reproduction:** Log in as SALES and block `/dashboard` (or return 403): the home page shows "not checked in" and "no invoices yet" even though both other endpoints succeeded. In the Network panel, two `/invoices` calls fire on each mount, and `pendingCount` never appears in the DOM.
- **Fix:** Delete the `pendingRes` request and `pendingCount` state (or render it), and decouple the remaining loads with `Promise.allSettled` (or separate queries with independent loading/error states) so attendance and recent invoices survive a dashboard failure. Show a per-card retry.
- **Verification:** Network panel shows three requests, not four; blocking `/dashboard` still renders attendance and recent invoices; each failed section shows its own error/retry instead of a false empty state.
- **Status:** - [ ] Fixed

---

## FP-20 — Realtime invalidation targets query keys no page registers, so lists stay stale after other users approve/reject

- **Severity:** S3
- **Location:** `frontend/src/pages/admin/Invoices.tsx:62-64`
- **Evidence:**
  ```ts
  useRealtimeRefresh(() => {
    void fetchInvoices();
  }, ["invoice.created", "invoice.confirmed", "invoice.rejected", "invoice.delivery.scan", "invoice.delivered"]);
  ```
- **Root cause:** All audited list/detail pages keep server data in `useState` and fetch with raw `api.get` (no `useQuery` in any of the 27 files except `NewInvoice`'s indirect `useCustomerOptions`). The global realtime handler invalidates React Query keys `["invoices"]`, `["notifications"]`, `["stock-receipts"]`, `["change-requests"]` (`frontend/src/hooks/useRealtimeEvents.ts:30-33`), but no query is registered under those keys — the detail cache key is `["invoice", id]` (`hooks/queries.ts:21`) — so invalidation is a no-op. The only refresh path is the window event, which calls `fetchInvoices()` **without an AbortController** while the effect-driven fetch may already be in flight.
- **Impact at scale:** Two cashiers/accountants working concurrently: A confirms an invoice, B's Pending list still shows it as pending (until remount) and B can press Confirm again. Two overlapping `fetchInvoices()` calls (realtime event + filter change) can resolve out of order and the older response overwrites the newer one, showing a list that matches neither moment. There is no optimistic update anywhere, so every mutation depends on a refetch that can silently fail (FP-17) and leave stale, actionable rows.
- **Reproduction:** Two browsers on `/admin/invoices` and `/admin/invoices/:id`. Confirm an invoice in browser A; browser B's list does not change (and React Query devtools shows no query under `["invoices"]`). Then on B, change the status filter while a realtime event fires: occasionally the pre-filter rows reappear.
- **Fix:** Register list queries with `useQuery` (`["invoices", filters, page]`) and invalidate that namespace on realtime events and after mutations; or, if keeping local state, route realtime refreshes through the same abortable, request-id-guarded fetch used by the effect, and add optimistic status updates with rollback.
- **Verification:** Confirming in A updates B within one event without remount; React Query devtools shows the list query being invalidated; a rapid filter change during a realtime event never renders the previous filter's rows.
- **Status:** - [ ] Fixed

---

## FP-21 — `admin/Reports.tsx` is a zero-byte dead module

- **Severity:** S4
- **Location:** `frontend/src/pages/admin/Reports.tsx:1`
- **Evidence:**
  ```
  // (verified: file is empty — 0 lines, 0 bytes; no imports, no export, no JSX)
  ```
- **Root cause:** The file is a leftover placeholder. Reports are actually served from `frontend/src/features/reports` (`ReportsLayout` / `ReportsIndexPage`, wired in `App.tsx:225-226` and `248-249`), so this module is never imported — but it sits in the admin pages directory and any future `import Reports from "./Reports"` produces an empty component and a build/type error (`File is not a module`).
- **Impact at scale:** No runtime impact today; it is a trap for the next developer and makes the admin page inventory lie about which screens exist. A zero-byte `.tsx` also breaks tooling that assumes a default export per page.
- **Reproduction:** `Get-Item frontend/src/pages/admin/Reports.tsx` reports `Length 0`; `grep -r "pages/admin/Reports" frontend/src` returns nothing. Importing it in a scratch file fails to compile.
- **Fix:** Delete the file, or replace it with a re-export of the real page (`export { default } from "../../features/reports/pages/ReportsIndexPage";`) if the path is meant to be the canonical entry point.
- **Verification:** `tsc --noEmit` and `vite build` pass; no zero-byte `.tsx` remains under `src/pages`; a repo-wide import of the path resolves.
- **Status:** - [ ] Fixed

---

## FP-22 — Login error is never cleared while retrying and is not announced to assistive tech

- **Severity:** S4
- **Location:** `frontend/src/pages/Login.tsx:70-80`
- **Evidence:**
  ```tsx
  {error && (
    <div
      className="p-3 rounded-lg text-sm"
      style={{
        backgroundColor: "var(--accent-bg)",
        color: "var(--accent)",
      }}
    >
      {error}
    </div>
  )}
  ```
- **Root cause:** `error` is only reset on submit (line 24), so a failed attempt leaves the red banner visible while the user edits the username/password — it reads as if the new credentials are already rejected. The banner has no `role="alert"`/`aria-live`, so a screen-reader user is not told that the attempt failed (the only feedback is the disabled button returning to normal).
- **Impact at scale:** Minor, but login is the first screen for every user, including on the flaky networks where failures are common; a stale error plus silent failure is a confusing retry loop.
- **Reproduction:** Submit wrong credentials → banner appears. Type a corrected password: the banner remains unchanged until the next submit. With a screen reader, the error is not announced.
- **Fix:** Clear `error` in the `onChange` of both fields (or when `username`/`password` change), and add `role="alert"` (or `aria-live="polite"`) to the banner; also focus the banner or the first field on failure.
- **Verification:** Typing after a failed attempt hides the banner immediately; axe/NVDA announces the message on failure; a component test asserts the banner disappears on input change.
- **Status:** - [ ] Fixed
