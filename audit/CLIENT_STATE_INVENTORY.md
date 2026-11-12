# Client-State Inventory

> Read-only audit artifact. Describes every piece of client state, where it lives,
> who owns it, and whether it can recover from failure without a full reload.

## 1. Persistence map (browser storage)

| Key | Type | Written by | Read by | Cleared by | Contains secrets? |
|---|---|---|---|---|---|
| `accessToken` | string (JWT, 15 min) | `lib/auth.tsx:59`, `lib/api.ts:157` | `lib/api.ts:76`, `lib/settings.tsx:48`, `lib/api.ts:189` | `lib/api.ts:45`, `lib/auth.tsx:72` | Yes — bearer token |
| `refreshToken` | string (7 days) | `lib/auth.tsx:60`, `lib/api.ts:158` | `lib/api.ts:113`, `lib/auth.tsx:81` | `lib/api.ts:46`, `lib/auth.tsx:73` | Yes — long-lived credential |
| `user` | JSON `AuthUser` **including both tokens** | `lib/auth.tsx:61,105,117` | `lib/api.ts:28`, `lib/auth.tsx:38,85` | `lib/api.ts:47`, `lib/auth.tsx:74` | Yes — duplicate tokens |
| `pallet-lang` | `"ar" \| "en"` | `i18n/context.tsx:29` | `i18n/context.tsx:16` | never | No |
| `pallet-theme` | `"light" \| "dark" \| "system"` | `lib/theme.tsx:87` | `lib/theme.tsx:28` | never | No |

**Observations**

- Tokens are stored in **two places** (`accessToken`/`refreshToken` and inside
  `user`). The Axios refresh path updates only the dedicated keys
  (`lib/api.ts:157-158`), so `localStorage.user.accessToken` becomes stale after
  the first silent refresh. Any code that trusts `user.accessToken` (e.g.
  `isAuthenticated` at `lib/auth.tsx:42`, realtime effect dependency at
  `hooks/useRealtimeEvents.ts:27`) is reading a stale value.
- `localStorage` is synchronous and shared by every tab. There is **no
  `storage` event listener** anywhere in `src/`, so login/logout/refresh in one
  tab is invisible to the others.
- No large datasets are persisted client-side; React Query cache is memory-only.
  localStorage stays well under the 100 KB budget.

## 2. In-memory state

| Store | Location | Scope | Persistence | Notes |
|---|---|---|---|---|
| `AuthContext` | `lib/auth.tsx:35-128` | app-wide | hydrated from `user` | Holds `user`, `isAuthenticated`, `login`, `logout`, `refreshToken`, `hasRole` |
| `SettingsContext` | `lib/settings.tsx:36-134` | app-wide | none | `brand`, full `settings`, `ready`, `refresh` |
| `ThemeContext` | `lib/theme.tsx:55-126` | app-wide | `pallet-theme` | preference + resolved theme |
| `I18nContext` | `i18n/context.tsx` | app-wide | `pallet-lang` | `t`, `dir`, `language` |
| TanStack Query cache | `main.tsx:11-19` | app-wide | memory only | `retry: 1`, `staleTime: 30s`, `refetchOnWindowFocus: false` |
| Realtime connection | `hooks/useRealtimeEvents.ts:52-66` | per mounted shell | memory only | SSE via `fetch`, module-local retry counter |
| Session-expiry latch | `lib/sessionExpiry.ts:1` | module | memory only | Ensures one redirect per page load |

### Query key registry (`hooks/queries.ts:14-22`)

| Key | Shape | Invalidation |
|---|---|---|
| `["categories"]` | list | `useInvalidateOptions().categories` |
| `["suppliers","options",limit]` | list | prefix `["suppliers","options"]` |
| `["employees","options",limit]` | list | prefix `["employees","options"]` |
| `["workplaces"]` | list | `useInvalidateOptions().workplaces` |
| `["customers","options",search,limit]` | list | prefix `["customers","options"]` |
| `["product-models","category",id]` | list | **no invalidation helper** |
| `["invoice",id]` | detail | `useInvalidateOptions().invoice(id)` + prefix `["invoice"]` |
| `["invoices"]`, `["notifications"]`, `["stock-receipts"]`, `["change-requests"]` | list/detail | every realtime frame (`useRealtimeEvents.ts:30-33`) |

## 3. Token lifecycle

```
login ──► POST /auth/login ──► { accessToken, refreshToken, employee }
         └─ localStorage: accessToken, refreshToken, user(JSON incl. tokens)

request ──► attach accessToken from localStorage
         └─ 401 & not /auth/refresh & not retried
              ├─ no refreshToken ──► clearSessionAndRedirect()
              ├─ isRefreshing ──► queue until refresh completes
              └─ refresh ──► POST /auth/refresh { employeeId, refreshToken }
                    ├─ success: replace both keys, drain queue, retry original
                    └─ failure: drain queue with error, clear + redirect
```

**Gaps**

1. **Per-tab single-flight only.** `isRefreshing`/`failedQueue`
   (`lib/api.ts:58-59`) are module locals. Two tabs refreshing with the same
   rotated token race; the backend invalidates the loser, which then logs the
   user out. Needs a cross-tab lock (`navigator.locks` or BroadcastChannel).
2. **No proactive refresh.** The token is refreshed only after a 401, so every
   15 minutes the first user action pays a refresh round-trip.
3. **Stale duplicate.** `user.accessToken` is never rewritten by the interceptor.
4. **Auth is inferred from storage.** `isAuthenticated = !!user?.accessToken`
   (`lib/auth.tsx:42`) is not validated against the server. A revoked account
   keeps rendering the authenticated shell until an API call returns 401.
5. **Logout is not broadcast.** Other tabs keep their in-memory `user` and
   continue rendering until they make a request.

## 4. Failure / self-healing matrix

| Failure | Current behavior | Self-heals? | Evidence |
|---|---|---|---|
| Access token expired | 401 → refresh → retry original request | Yes, single tab | `lib/api.ts:87-176` |
| Refresh token invalid | Clear storage + `location.replace('/login')` | Yes (full reload) | `lib/api.ts:41-52,166-171` |
| Two tabs refresh at once | One tab wins, other gets 401 and is logged out | **No** | `lib/api.ts:58-59` |
| Network blip on a GET | Query retries once, then shows error | Partial | `main.tsx:14` |
| Network blip on a mutation | No retry/queue; user sees error and must resubmit | **No** | no mutation defaults in `main.tsx` |
| Realtime SSE drops | 5 exponential-backoff retries, then permanently stops | **No** after ~1 min | `hooks/realtimeConnection.ts:14,64-66` |
| Realtime 401 | Refresh once, retry; else redirect | Yes | `hooks/realtimeConnection.ts:98-103,158-173` |
| Brand/settings fetch fails | Keeps last known brand, `ready=true` | Partial (no retry) | `lib/settings.tsx:88-92` |
| Malformed `user` JSON | Removed, treated as logged out | Yes | `lib/auth.tsx:15-24` |
| Render-time exception | No error boundary in `main.tsx`/`App.tsx`; white screen | **No** | `main.tsx:36-49` |
| Cross-tab logout | Other tab unaware | **No** | no `storage` listener |
| Offline | No service worker / offline cache | **No** | `vite.config.ts` |

## 5. State ownership rules observed in the code

- **Server data** belongs to TanStack Query. Pages generally call `api` directly
  inside `useQuery`/`useMutation`; there is no shared repository layer.
- **Auth** is the only context that writes tokens; `api.ts` also writes them
  during refresh, which violates single ownership.
- **Brand** is fetched independently by `SettingsProvider`; print components
  read it from context (`useSettings`).
- **Realtime** does not own data; it only invalidates query keys and dispatches
  a `pos:realtime` DOM event for page-level listeners.
- **URL** is the source of truth for report filters in most report pages, but
  several pages keep duplicate filter state in `useState` without syncing to the
  URL (see `FR-*` findings).

## 6. Budget check

| Budget | Measured/estimated | Status |
|---|---|---|
| localStorage < 100 KB | `user` JSON ~0.3 KB + tokens ~1 KB + 2 flags | Pass |
| Initial JS < 300 KB gzip | `vite build` currently **fails** (`BL-01`); last known chunk warning >500 KB | **Fail / unverified** |
| Page payload < 500 KB | report/print endpoints fetch up to 1,000 rows; invoice detail unbounded | **Fail** (see `BR-*`, `FR-*`) |
| List p95 < 300 ms | 10k-row dropdowns and full scans | **Fail** (see `FC-*`, `FP-*`) |
