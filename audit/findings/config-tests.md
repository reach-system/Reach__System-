# Findings — Configuration, Tests, Scripts & Docs

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `backend/check-db.js` | 17 | complete |
| `backend/debug-api.js` | 33 | complete |
| `backend/debug-attendance.js` | 14 | complete |
| `backend/debug-delivery.js` | 26 | complete |
| `backend/debug-ui.js` | 51 | complete |
| `backend/e2e-attendance.js` | 191 | complete |
| `backend/ensure-kiosk.js` | 34 | complete |
| `backend/jest.config.js` | 34 | complete |
| `backend/test/setup.ts` | 155 | complete |
| `backend/test/jest-e2e.json` | 13 | complete |
| `backend/test/invoice-note.e2e-spec.ts` | 277 | complete |
| `backend/test/invoice-lifecycle.e2e-spec.ts` | 717 | complete |
| `backend/test/global-teardown.ts` | 3 | complete |
| `backend/test/global-setup.ts` | 66 | complete |
| `backend/test/authorization-matrix.e2e-spec.ts` | 148 | complete |
| `frontend/package.json` | 39 | complete |
| `frontend/vite.config.ts` | 33 | complete |
| `frontend/tsconfig.json` | 7 | complete |
| `frontend/tsconfig.app.json` | 26 | complete |
| `frontend/tsconfig.node.json` | 23 | complete |
| `frontend/.env.production` | 1 | complete |
| `frontend/.gitignore` | 24 | complete |
| `frontend/.oxlintrc.json` | 8 | complete |
| `frontend/ecosystem.config.cjs` | 11 | complete |
| `frontend/index.html` | 40 | complete |
| `frontend/README.md` | 32 | complete |
| `README.md` | 2 | complete (UTF-16LE; decoded) |
| `.planning/plans/branding-settings-logo.md` | 150 | complete |

---

## CT-01 — E2E global setup truncates whatever `DATABASE_URL` points at, with no test-DB guard

- **Severity:** S1
- **Location:** `backend/test/global-setup.ts:37-43` (client created at `:4`, list at `:7-35`)
- **Evidence:**
  ```ts
  for (const tablename of tablenames) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${tablename}" RESTART IDENTITY CASCADE;`);
    } catch (e) {
      // Table might not exist or have different casing
    }
  }
  ```
- **Root cause:** `new PrismaClient()` (line 4) reads the ambient `DATABASE_URL` from `backend/.env`; nothing asserts that the target is a disposable test database, and every truncate failure is swallowed, so a partial wipe reports success.
- **Impact at scale:** `backend/package.json:17` is `jest --maxWorkers=1`, and `backend/jest.config.js:2-32` defines both a `unit` and an `e2e` project, so `npm test` (not just `npm run test:e2e`) runs `globalSetup`. Pointed at the production database this deletes all 5M+ invoices, stock history and audit logs in seconds and recreates employees with the seeded passwords `admin123`/`sales123` (`:47-59`). No backup or transaction protects it.
- **Reproduction:** `cd backend` then `DATABASE_URL="postgresql://…/pallet_pos?schema=public" npx jest --selectProjects e2e` against a populated database; observe `TRUNCATE` calls before the first assertion runs.
- **Fix:** Fail closed: require `process.env.NODE_ENV === 'test'`, require the database name to match `/_test$/`, require host to be in an allowlist, and require an explicit `ALLOW_DB_RESET=1`. Load a dedicated `backend/.env.test` instead of the ambient `.env`; use `datasourceUrl` explicitly. Add `--runInBand` and a startup banner printing the resolved DB name/host.
- **Verification:** Running with a non-`_test` database URL exits non-zero before any SQL is issued; running against the dedicated test DB passes; `git grep -n "ALLOW_DB_RESET"` shows the guard is wired in both `global-setup.ts` and `test/jest-e2e.json` runs.
- **Status:** - [ ] Fixed

---

## CT-02 — E2E `afterEach` deletes entire tables unconditionally

- **Severity:** S1
- **Location:** `backend/test/invoice-lifecycle.e2e-spec.ts:137-161`
- **Evidence:**
  ```ts
      await prisma.invoiceItemUnitAssignment.deleteMany();
      await prisma.invoiceItem.deleteMany();
      await prisma.productUnitAuditLog.deleteMany();
      await prisma.invoiceAuditLog.deleteMany();
      await prisma.invoice.deleteMany();
      await prisma.stockReceiptItem.deleteMany();
      await prisma.stockLot.deleteMany();
      await prisma.stockReceipt.deleteMany();
      await prisma.productUnit.deleteMany();
      await prisma.productModel.deleteMany();
      await prisma.category.deleteMany();
      await prisma.supplier.deleteMany();
      await prisma.customer.deleteMany();
  ```
- **Root cause:** Cleanup uses `deleteMany()` with no `where` clause, assuming the database only ever contains this spec's fixtures. There is no scoping to `testData` IDs and no environment guard.
- **Impact at scale:** Any run against a non-disposable database wipes all invoices, units, lots, customers and suppliers — and it runs after **every** test in the file (9 tests), not once. It also destroys fixtures created by `authorization-matrix.e2e-spec.ts:39-61` if both specs share a database, producing false failures and hiding real regressions.
- **Reproduction:** Insert a single unrelated `Customer` row, run only `invoice-lifecycle.e2e-spec.ts`, then query `SELECT count(*) FROM "Customer"` → 0.
- **Fix:** Delete only rows created by the test (`where: { id: { in: createdIds } }`) or wrap each test in a Prisma interactive transaction that is rolled back. Keep the CT-01 environment guard as the last line of defence.
- **Verification:** After the suite, a pre-inserted sentinel customer/invoice still exists; `git grep -n "deleteMany()" backend/test` returns no unscoped calls.
- **Status:** - [ ] Fixed

---

## CT-03 — Standalone attendance E2E script mutates a live database and a live employee record

- **Severity:** S1
- **Location:** `backend/e2e-attendance.js:43-47` (also `:151`, `:173`)
- **Evidence:**
  ```js
    // Reset attendance for testsales so check-in flow can run cleanly
    const sales = await prisma.employee.findUnique({ where: { username: 'testsales' } });
    if (sales) {
      await prisma.attendance.deleteMany({ where: { employeeId: sales.id } });
    }
  ```
- **Root cause:** This is a hand-rolled script outside Jest, with no `NODE_ENV` check, no test-DB check and no dry-run mode; it talks to `http://localhost:3001/api` (`:1`) and to the same `PrismaClient` database as the running server. It also writes business data: it applies an attendance correction (`:151`) and attempts to rename the admin account (`:173`, `PATCH /employees/{id}` with `username: 'testsales'`).
- **Impact at scale:** If executed on the production host (the default `localhost:3001` matches a local production deployment), it deletes a real employee's attendance history and writes a permanent correction/audit trail. The rename attempt can lock out or collide with a real account.
- **Reproduction:** Seed `testsales` with attendance rows, run `node backend/e2e-attendance.js`; rows disappear and an `attendance_correction` audit entry appears.
- **Fix:** Delete the script and port the checks into `backend/test/attendance.e2e-spec.ts` using `Test.createTestingModule`, the CT-01 guard and a dedicated test database. If it must stay, gate it behind `APP_ENV=test` + `ALLOW_DB_RESET=1` and read credentials from env.
- **Verification:** `git grep -n "deleteMany({ where: { employeeId: sales.id } })"` returns nothing; attendance E2E runs only via `npm run test:e2e` and the guard rejects non-test DBs.
- **Status:** - [ ] Fixed

---

## CT-04 — `ensure-kiosk.js` creates/reactivates a kiosk account with a known password

- **Severity:** S1
- **Location:** `backend/ensure-kiosk.js:5-13`
- **Evidence:**
  ```js
    const existing = await p.employee.findUnique({ where: { username: 'testkiosk' } });
    if (existing) {
      await p.employee.update({
        where: { id: existing.id },
        data: { role: Role.ATTENDANCE_KIOSK, workplaceId: 1, isActive: true, deletedAt: null },
      });
      console.log('KIOSK ready id=', existing.id);
    } else {
      const hash = await argon2.hash('kiosk123');
  ```
- **Root cause:** A convenience script hardcodes the username, password (`kiosk123`), role and `workplaceId: 1`, and silently un-deletes/reactivates an existing account. It is committed to the repository with no environment gate.
- **Impact at scale:** Anyone with repo access knows a valid kiosk login. Running it in production escalates an arbitrary employee row to `ATTENDANCE_KIOSK`, resets its password path, and re-enables a soft-deleted employee — an authentication backdoor into attendance (check-in/check-out) data. `workplaceId: 1` also silently rebinds the kiosk to the wrong branch in a multi-workplace deployment.
- **Reproduction:** `node backend/ensure-kiosk.js` against production, then log in as `testkiosk`/`kiosk123` and issue QR tokens via `POST /api/attendance/kiosk/qr`.
- **Fix:** Remove the script. Provision kiosk accounts through an admin-only endpoint/CLI that requires an operator-supplied password (or generates a random one printed once), never reactivates deleted rows implicitly, and takes `workplaceId` as a required argument.
- **Verification:** `testkiosk` no longer exists after a fresh seed; the kiosk E2E creates its account per-run with a random password and the guard from CT-01.
- **Status:** - [ ] Fixed

---

## CT-05 — Production env file pins a private LAN IP over plain HTTP and is baked into the shipped bundle

- **Severity:** S1
- **Location:** `frontend/.env.production:1`
- **Evidence:**
  ```ini
  VITE_API_URL=http://192.168.1.2:3001/api
  ```
- **Root cause:** A developer's LAN address is committed as the production API base (the file is git-tracked — `git ls-files frontend/.env.production` returns it). Vite inlines `import.meta.env.VITE_API_URL` at build time (`frontend/src/lib/api.ts:18`), so the value is frozen into `dist`.
- **Impact at scale:** Every production build calls `http://192.168.1.2:3001/api`. On any other network the app is dead; on the matching LAN, JWTs, passwords and invoice data travel in cleartext (no TLS), so any host on the network can sniff or MITM them. Verified in the existing build: `frontend/dist/assets/index-CTH9sxLE.js` (2,000,647 chars) contains `192.168.1.2` and `3001/api`.
- **Reproduction:** `cd frontend && npm run build && Select-String -Path dist/assets/*.js -Pattern "192.168.1.2"` → match; open the built app from a different subnet → all API calls fail.
- **Fix:** Delete `.env.production` from the repo (add it to `.gitignore` per CT-17), ship a `.env.example`, and inject the API base at deploy time (CI secret) as `https://<host>/api`. Prefer same-origin `/api` behind the reverse proxy so no host is compiled in. Enforce `https:` in `api.ts` for production.
- **Verification:** Rebuild and grep `dist/assets/*.js` for `192.168.` → no match; the app resolves `/api` on the deployment origin; `git ls-files frontend/.env*` lists only `.env.example`.
- **Status:** - [ ] Fixed

---

## CT-06 — `debug-api.js` logs in with hardcoded credentials and delivers a real invoice

- **Severity:** S1
- **Location:** `backend/debug-api.js:5-13`
- **Evidence:**
  ```js
    const loginRes = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'inventory', password: 'inventory123' }),
    });
    const auth = await loginRes.json();
    const h = { Authorization: `Bearer ${auth.accessToken}`, 'Content-Type': 'application/json' };
    const inv = await p.invoice.findFirst({ where: { invoiceNumber: 'INV-TEST-DELIVERY' } });
    const r = await fetch(`${BASE}/invoices/${inv.id}/deliver`, { method: 'PATCH', headers: h });
  ```
- **Root cause:** A debug harness hardcodes a real seeded account and performs a state-changing `PATCH /invoices/:id/deliver` against `http://localhost:3001/api` with no environment guard or confirmation.
- **Impact at scale:** Delivering an invoice marks serialized units `SOLD`, writes `costAtSale`, and emits audit rows — irreversible business/financial state changes triggered by a script named "debug". The committed `inventory123` credential is also a standing account compromise if it matches a production account (the seed uses the same value: `backend/test/global-setup.ts:50`).
- **Reproduction:** With `INV-TEST-DELIVERY` present in the DB, `node backend/debug-api.js` → `deliver status= 200` and the invoice flips to `DELIVERED`.
- **Fix:** Delete the script or move the scenario into `backend/test/invoice-lifecycle.e2e-spec.ts` (already covers deliver) with a disposable DB. If kept for manual use, read `DEBUG_USERNAME`/`DEBUG_PASSWORD` from env, require `--confirm`, and refuse when `NODE_ENV=production`.
- **Verification:** `git grep -n "inventory123" backend` returns only test fixtures; no script issues a `PATCH` without an explicit confirm flag.
- **Status:** - [ ] Fixed

---

## CT-07 — `debug-delivery.js` loads every invoice, item and unit assignment into memory

- **Severity:** S2
- **Location:** `backend/debug-delivery.js:4-15`
- **Evidence:**
  ```js
    const invoices = await p.invoice.findMany({
      include: {
        customer: { select: { name: true } },
        items: {
          include: {
            productModel: { select: { id: true, name: true, isSerialized: true } },
            unitAssignments: { where: { reversedAt: null }, include: { productUnit: { select: { barcode: true, status: true } } } },
          },
        },
      },
      orderBy: { id: 'desc' },
    });
  ```
- **Root cause:** `findMany()` has no `take`/cursor and eagerly includes three relation levels; it then `console.log`s one line per invoice and per item (`:16-22`), and separately dumps 30 units.
- **Impact at scale:** At 5M invoices with ~2 items each this attempts to materialize tens of millions of rows plus joins in the Node heap, exhausting memory and stalling the database with a long-running query — while the app is serving traffic. It also prints customer names (PII) to stdout/log files.
- **Reproduction:** Run against a database with >100k invoices and watch RSS climb until `JavaScript heap out of memory`.
- **Fix:** Delete the script or bound it (`take: 20`, `where: { invoiceNumber: { contains: 'TEST' } }`), select only the fields needed, aggregate with `groupBy`/`count`, and never print customer PII.
- **Verification:** Script (if retained) completes in constant memory on a 5M-invoice copy; `EXPLAIN` shows a `LIMIT`; no `customer.name` in output.
- **Status:** - [ ] Fixed

---

## CT-08 — No build/code-splitting config: production ships one ~2 MB JS chunk

- **Severity:** S2
- **Location:** `frontend/vite.config.ts:10-33`
- **Evidence:**
  ```ts
  export default defineConfig({
    plugins: [
      react(),
      tailwindcss(),
      ...(httpsEnabled ? [basicSsl()] : []),
    ],

    server: {
      host: '0.0.0.0',
      port: 5174,

      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },

        '/uploads': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  })
  ```
- **Root cause:** The config has no `build` section at all: no `rollupOptions.output.manualChunks`, no vendor split, no chunk-size budget, and no `build.sourcemap` decision. The app is also imported eagerly (no `React.lazy` route boundaries), so heavy libraries such as `exceljs` (`frontend/package.json:19`, statically imported by `ExcelExportButton.tsx:2`) land in the entry chunk.
- **Impact at scale:** The checked-in build is a single `dist/assets/index-CTH9sxLE.js` of **2,015,954 bytes** (~2.0 MB, 4× Vite's 500 kB warning). On the low-end tablets/terminals used at a POS this is a multi-second parse/execute on every cold load, and every deploy invalidates the whole cache.
- **Reproduction:** `cd frontend && npm run build` → Vite emits `(!) Some chunks are larger than 500 kB after minification`; `Get-ChildItem dist/assets` shows one JS file ≈2 MB.
- **Fix:** Add `build.rollupOptions.output.manualChunks` (react/router vendor, `exceljs`), convert report routes to `React.lazy` + `Suspense`, import `exceljs` dynamically inside the export handler, and set `build.chunkSizeWarningLimit: 500` with a CI size check.
- **Verification:** Rebuild: entry chunk < 500 kB, `exceljs` in its own async chunk loaded only on export, no size warning, Lighthouse TTI improved on a throttled profile.
- **Status:** - [ ] Fixed

---

## CT-09 — TypeScript is not strict; `tsc -b` cannot catch null/undefined money bugs

- **Severity:** S2
- **Location:** `frontend/tsconfig.app.json:2-26`
- **Evidence:**
  ```json
  {
    "compilerOptions": {
      "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
      "target": "es2023",
      "lib": ["ES2023", "DOM"],
      "module": "esnext",
      "types": ["vite/client"],
      "allowArbitraryExtensions": true,
      "skipLibCheck": true,

      /* Bundler mode */
      "moduleResolution": "bundler",
      "allowImportingTsExtensions": true,
      "verbatimModuleSyntax": true,
      "moduleDetection": "force",
      "noEmit": true,
      "jsx": "react-jsx",

      /* Linting */
      "noUnusedLocals": false,
      "noUnusedParameters": false,
      "erasableSyntaxOnly": false,
      "noFallthroughCasesInSwitch": true
    },
    "include": ["src"]
  }
  ```
- **Root cause:** Neither `tsconfig.app.json` nor `tsconfig.node.json` sets `strict`, so `strictNullChecks`, `noImplicitAny`, `strictFunctionTypes` and `useUnknownInCatchVariables` are all off. `skipLibCheck` is on and unused-symbol checks are explicitly disabled. `frontend/package.json:10` (`tsc -b && vite build`) therefore performs a very weak typecheck.
- **Impact at scale:** Money/quantity code routinely relies on `number | null` (invoice totals, `costAtSale`, `reservedQuantity`). With `strictNullChecks` off, `null`/`undefined` arithmetic compiles and ships, producing `NaN` totals or silent `0`s in invoices/reports at scale — exactly the class of bug the build gate should stop.
- **Reproduction:** Add `const x: number = null;` to any `src/**/*.ts` and run `npm run build` → it compiles successfully.
- **Fix:** Enable `"strict": true`, `"noUncheckedIndexedAccess": true`, `"noImplicitOverride": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true` in both configs, fix the resulting errors, and add a `typecheck` script that CI runs without emitting.
- **Verification:** `npx tsc -b` fails on the null assignment above; CI runs `npm run typecheck` and is green only with strict mode on.
- **Status:** - [ ] Fixed

---

## CT-10 — `npm test` runs DB-truncating E2E projects and coverage has no threshold

- **Severity:** S2
- **Location:** `backend/jest.config.js:18-32`
- **Evidence:**
  ```js
    {
      displayName: 'e2e',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      testRegex: 'test/.*\\.e2e-spec\\.ts$',
      transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
      },
      testEnvironment: 'node',
      moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
      },
      globalSetup: '<rootDir>/test/global-setup.ts',
      globalTeardown: '<rootDir>/test/global-teardown.ts',
    },
  ```
- **Root cause:** Unit and E2E live in one `projects` array, so the plain `jest` invocation (`backend/package.json:17`) runs both, triggering `globalSetup`'s truncation and requiring Postgres for what developers believe is a unit-test command. `collectCoverageFrom: ['**/*.(t|j)s']` (`:11`) also counts DTOs/modules/main, and there is no `coverageThreshold`, so coverage can silently fall to zero.
- **Impact at scale:** Developers/CI cannot run fast unit tests without a database, which pushes teams to skip tests entirely; the truncation hazard from CT-01 is reachable from the default command; and no coverage floor protects the invoice/stock money paths during refactors.
- **Reproduction:** `cd backend && npx jest --listTests` lists the three `test/*.e2e-spec.ts` files alongside unit specs (verified); running `npm test` executes `global-setup.ts`.
- **Fix:** Add `test:unit` = `jest --selectProjects unit`, `test:e2e` = `jest --selectProjects e2e --runInBand`, make `test` an alias for unit only. Add `coverageThreshold` (e.g. 80% lines / 75% branches) and restrict `collectCoverageFrom` to `src/**/*.service.ts`, `src/**/*.controller.ts` minus `*.module.ts`/`main.ts`.
- **Verification:** `npm test` passes with Postgres stopped; `npm run test:e2e` is the only command that touches the DB; CI fails when coverage drops below the threshold.
- **Status:** - [ ] Fixed

---

## CT-11 — E2E apps do not mirror `main.ts` pipes, so validation regressions pass CI

- **Severity:** S2
- **Location:** `backend/test/invoice-lifecycle.e2e-spec.ts:19-21`
- **Evidence:**
  ```ts
      app = moduleFixture.createNestApplication();
      app.setGlobalPrefix('api');
      await app.init();
  ```
- **Root cause:** Only `invoice-note.e2e-spec.ts:31-39` installs the production `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, enableImplicitConversion: true })`. `invoice-lifecycle` (`:19-21`) and `authorization-matrix` (`:22-24`) boot the app bare, so their requests bypass DTO whitelisting/transformation entirely.
- **Impact at scale:** Tests exercise a different application than production. A DTO that starts accepting extra/unknown fields, loses `@Type(() => Number)`, or stops rejecting negative quantities will still pass the lifecycle suite (which sends well-formed JSON) and only fail in production — on invoices and stock. Conversely, tests can pass payloads production would reject.
- **Reproduction:** Add `"unexpected": true` to an invoice-create body in `invoice-lifecycle.e2e-spec.ts` → still `201`; the same request against the real server returns `400`.
- **Fix:** Extract a `createTestApp()` helper (e.g. `backend/test/create-test-app.ts`) that applies the exact `main.ts` pipeline (global prefix, `ValidationPipe` with the same options, exception filter, CORS/helmet as applicable) and use it in every spec.
- **Verification:** The extra-field request returns `400` in all three suites; a diff of `main.ts` pipes vs the helper is empty.
- **Status:** - [ ] Fixed

---

## CT-12 — The only concurrency test cannot detect overselling or double-delivery

- **Severity:** S2
- **Location:** `backend/test/invoice-lifecycle.e2e-spec.ts:604-632`
- **Evidence:**
  ```ts
        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.status === 201).length;
        expect(successCount).toBe(2);

        const model = await prisma.productModel.findUnique({ where: { id: testData.serializedModel.id } });
        expect(model!.reservedQuantity).toBe(2);
  ```
- **Root cause:** The test fires exactly two reservations against 5 available units and asserts both succeed — a happy path that any non-atomic implementation also passes. It never asserts a failure boundary, never exceeds available stock, and never races the money-critical transitions (`confirm`, `delivery/scan`, `deliver`, idempotent create).
- **Impact at scale:** At 100k products / 5M invoices, concurrent sales are the norm. Race conditions that double-reserve the last unit, confirm the same invoice twice (double FIFO consumption / double `costAtSale`), scan one barcode into two invoices, or deliver twice are untested; the suite would stay green while stock and profit are wrong.
- **Reproduction:** Remove the transaction/locking from the reservation path and run the suite → it still passes; then run 20 parallel reservations for 5 units against the real API and observe `reservedQuantity > available`.
- **Fix:** Add tests: (a) N=20 concurrent reservations for 5 units → exactly 5 succeed and `reservedQuantity === 5`; (b) two concurrent `confirm` calls → one `200`, one `4xx`, exactly one `StockConsumption` set; (c) two concurrent `delivery/scan` of the same barcode → one success; (d) concurrent `deliver` → single `DELIVERED` transition and one audit row; (e) concurrent duplicate `Idempotency-Key` (currently only sequential, `:198-232`) → one invoice.
- **Verification:** Each new test fails when the corresponding transaction/lock is removed (mutation-tested), and passes with it restored.
- **Status:** - [ ] Fixed

---

## CT-13 — Frontend `npm test` runs exactly one test file and skips the money formatters

- **Severity:** S2
- **Location:** `frontend/package.json:12`
- **Evidence:**
  ```json
      "test": "node --experimental-strip-types --test src/hooks/realtimeConnection.test.ts",
  ```
- **Root cause:** The test script names a single file instead of a glob, so it silently ignores the other two suites that exist in the repo: `src/features/printing/utils/formatters.test.ts` (currency/number/date formatting) and `src/features/printing/utils/disbursementVoucherData.test.ts`.
- **Impact at scale:** Money formatting and printed-voucher data — the last mile of every invoice — are never executed by the test command or any CI. A regression in `formatPrintCurrency` (decimals, grouping, Western digits for Arabic locale) ships undetected and misprints amounts on customer documents.
- **Reproduction:** `cd frontend && npm test` → runs 1 file; `Get-ChildItem -Recurse src -Include *.test.ts` lists 3 files. Break an assertion in `formatters.test.ts` and re-run → still green.
- **Fix:** Use `node --experimental-strip-types --test "src/**/*.test.ts"` (or adopt Vitest with `jsdom` for component tests), and add a `test:watch` script.
- **Verification:** `npm test` reports 3+ files; intentionally failing `formatters.test.ts` makes the command exit non-zero.
- **Status:** - [ ] Fixed

---

## CT-14 — PM2 config runs the Vite dev server as production, with another machine's hardcoded path and a mismatched port

- **Severity:** S2
- **Location:** `frontend/ecosystem.config.cjs:1-11`
- **Evidence:**
  ```js
  module.exports = {
    apps: [
      {
        name: "pallet-frontend",
        script: "node_modules/vite/bin/vite.js",
        interpreter: "node",
        args: "--host 0.0.0.0 --port 3000",
        cwd: "C:/Users/one/Desktop/rich_mangment/frontend"
      }
    ]
  };
  ```
- **Root cause:** The process manager launches `vite` (dev server with on-the-fly transforms, HMR websocket and source maps), not `vite preview`/a static server serving `dist`. `cwd` is pinned to a different developer's Windows profile, and the port (3000) contradicts `frontend/vite.config.ts:19` (5174) and the API origin in `.env.production` (3001).
- **Impact at scale:** Deployment fails outright on any machine without `C:/Users/one/...`. Where it does start, production serves unminified modules with no long-term caching, exposes the dev/HMR endpoint on `0.0.0.0`, and runs a single non-clustered Node process — no restart policy, memory limit, env file or log config for a 100k-customer workload.
- **Reproduction:** `pm2 start frontend/ecosystem.config.cjs` on this machine → PM2 reports the script/cwd as missing; if the path is patched, `GET /` returns dev-transformed modules and `/@vite/client` is reachable.
- **Fix:** Build in CI and serve `dist` with `vite preview` (or nginx/CDN). Use `cwd: __dirname`, `args: "preview --host 127.0.0.1 --port 3000"`, `env_production`, `instances: 'max'`/`exec_mode: 'cluster'`, `max_memory_restart`, and log paths.
- **Verification:** `pm2 start` succeeds on a clean checkout; responses are hashed/minified assets; `/@vite/client` returns 404; the port matches the reverse-proxy config.
- **Status:** - [ ] Fixed

---

## CT-15 — No CI pipeline: lint, typecheck and tests are never enforced

- **Severity:** S2
- **Location:** `frontend/package.json:6-13` (repo-wide: no `.github/workflows`, no `*.yml`/`Jenkinsfile` exist)
- **Evidence:**
  ```json
    "scripts": {
      "dev": "vite",
      "dev:local": "vite --host 0.0.0.0",
      "dev:local:ssl": "vite --host 0.0.0.0",
      "build": "tsc -b && vite build",
      "lint": "oxlint",
      "test": "node --experimental-strip-types --test src/hooks/realtimeConnection.test.ts",
      "preview": "vite preview"
    },
  ```
- **Root cause:** Quality gates exist only as local npm scripts; nothing in the repository invokes them on push/PR. There is no workflow file, no pre-commit hook config, and no `ci` aggregate script.
- **Impact at scale:** Non-strict TypeScript (CT-09), the single-file frontend test (CT-13), the DB-truncating backend test wiring (CT-10) and lint warnings can all merge unnoticed. Regressions in money/stock code reach production with no automated signal, and there is no reproducible "green build" artifact.
- **Reproduction:** `Get-ChildItem -Recurse -Force -Include *.yml,*.yaml` outside `node_modules` → no files; push a commit with a type error → nothing runs.
- **Fix:** Add `.github/workflows/ci.yml` (or equivalent) with jobs: `backend` (`npm ci`, `prisma generate`, `npm run lint`, `npm run build`, `npm run test:unit`, `npm run test:e2e` against a Postgres service), `frontend` (`npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, bundle-size check). Make them required checks.
- **Verification:** A PR with a deliberate type error, failing test and lint warning is blocked; the workflow file is listed by `git ls-files .github/workflows`.
- **Status:** - [ ] Fixed

---

## CT-16 — E2E project has no serialization setting, so plain `jest` runs DB specs in parallel

- **Severity:** S2
- **Location:** `backend/jest.config.js:18-32`
- **Evidence:**
  ```js
      displayName: 'e2e',
      moduleFileExtensions: ['js', 'json', 'ts'],
      rootDir: '.',
      testRegex: 'test/.*\\.e2e-spec\\.ts$',
      transform: {
        '^.+\\.(t|j)s$': 'ts-jest',
      },
      testEnvironment: 'node',
  ```
- **Root cause:** `globalSetup` truncates once for the whole run, but the project defines no `maxWorkers: 1` (only the `test:e2e` npm script adds `--runInBand`). Any direct `jest`/IDE invocation uses one worker per CPU, so the three specs share one database concurrently.
- **Impact at scale:** `invoice-lifecycle` deletes all invoices/customers in `afterEach` (CT-02) while `authorization-matrix` expects its `beforeAll` fixtures to exist; `invoice-note` creates categories/customers concurrently. The result is order-dependent, intermittently red CI — the classic reason teams start ignoring E2E results.
- **Reproduction:** `cd backend && npx jest --selectProjects e2e` (no `--runInBand`) and inspect the run: the three specs execute in parallel workers against one schema while `global-setup` truncates only once, so the `authorization-matrix` `beforeAll` fixtures can be removed mid-run by `invoice-lifecycle`'s unscoped deletes (CT-02), yielding `404`/FK/unique-constraint failures depending on scheduling.
- **Fix:** Set `maxWorkers: 1` in the `e2e` project (in addition to `--runInBand`), give each spec a unique schema/database (`?schema=test_<spec>`), or run specs sequentially in a single file. Add `testTimeout` and retry-free determinism.
- **Verification:** 20 consecutive `npx jest --selectProjects e2e` runs are green; logs show one worker.
- **Status:** - [ ] Fixed

---

## CT-17 — Frontend `.gitignore` does not ignore environment files

- **Severity:** S3
- **Location:** `frontend/.gitignore:10-13`
- **Evidence:**
  ```gitignore
  node_modules
  dist
  dist-ssr
  *.local
  ```
- **Root cause:** Only `*.local` is ignored, so `.env`, `.env.production`, `.env.staging` are all committable — and `.env.production` is in fact tracked (see CT-05).
- **Impact at scale:** Environment-specific hosts, API keys and future secrets get committed and then silently diverge from the real deployment. Rotating a value requires a code change and rebuild; leaked values live in git history forever.
- **Reproduction:** `cd frontend && git check-ignore -v .env.production` → not ignored; `git ls-files .env.production` → tracked.
- **Fix:** Ignore `.env`, `.env.*`, and negate `!.env.example`; `git rm --cached frontend/.env.production`; document required variables in `.env.example`.
- **Verification:** `git check-ignore frontend/.env.production` succeeds; `git ls-files frontend/.env*` shows only `.env.example`.
- **Status:** - [ ] Fixed

---

## CT-18 — Dev server binds every interface and proxies to a hardcoded backend with no env switch

- **Severity:** S3
- **Location:** `frontend/vite.config.ts:17-31`
- **Evidence:**
  ```ts
    server: {
      host: '0.0.0.0',
      port: 5174,

      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },

        '/uploads': {
          target: 'http://127.0.0.1:3001',
          changeOrigin: true,
        },
      },
    },
  ```
- **Root cause:** `host: '0.0.0.0'` is unconditional (even for the default `npm run dev`), and the proxy target is hardcoded instead of read from an env var. `changeOrigin: true` rewrites the `Host` header, and there is no `allowedHosts`, no `secure`/TLS handling and no proxy-disabled production path.
- **Impact at scale:** Any machine on the office/LAN can reach the dev server, enumerate source modules and use it as an open proxy to the backend, bypassing whatever network boundary was intended. Staging/preview environments cannot point at a remote API without editing committed code.
- **Reproduction:** From another host, `curl http://<dev-ip>:5174/@vite/client` and `curl http://<dev-ip>:5174/api/health` both respond.
- **Fix:** Default `host: '127.0.0.1'` (opt into `0.0.0.0` via `--host` only for LAN testing), set `server.allowedHosts`, read `process.env.API_PROXY_TARGET` with a localhost default, and keep the proxy out of the production build.
- **Verification:** Default `npm run dev` is unreachable from another host; `API_PROXY_TARGET=http://staging:3001 npm run dev` proxies there without code changes.
- **Status:** - [ ] Fixed

---

## CT-19 — `index.html` loads fonts from Google at runtime, breaking offline/LAN POS startup

- **Severity:** S3
- **Location:** `frontend/index.html:29-34`
- **Evidence:**
  ```html
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&family=Sora:wght@500;600;700&family=Cairo:wght@400;500;600;700&family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  ```
- **Root cause:** Four font families (including Arabic `Cairo`) are fetched from a third-party origin in the document head; no self-hosted copies exist under `public/`, and no CSP/SRI is applied.
- **Impact at scale:** On an offline or firewalled shop network the stylesheet request hangs until timeout, delaying first paint and falling back to system fonts (layout shifts on printed invoices). It also leaks every user's IP to Google and creates a supply-chain dependency on a remote stylesheet for a business-critical UI.
- **Reproduction:** Block `fonts.googleapis.com` in DevTools (or run offline) and reload → render-blocking request fails, typography falls back, LCP degrades.
- **Fix:** Download the WOFF2 subsets into `frontend/public/fonts/`, declare `@font-face` with `font-display: swap`, `<link rel="preload">` the two critical weights, and remove the Google hosts (tighten CSP accordingly).
- **Verification:** Load with the network offline → fonts render identically; DevTools shows no request to `fonts.gstatic.com`.
- **Status:** - [ ] Fixed

---

## CT-20 — `backend/test/setup.ts` is dead code that duplicates global setup with an incomplete truncate list

- **Severity:** S3
- **Location:** `backend/test/setup.ts:8-45` (table list `:9-36`)
- **Evidence:**
  ```ts
  export async function cleanDatabase() {
    const tablenames = [
      'StockConsumption',
      'StockAdjustment',
      'InvoicePriceAdjustment',
      'InvoiceReturnItem',
      'InvoiceReturn',
      'InvoiceChangeRequestItem',
      'InvoiceChangeRequest',
      'InvoiceItem',
      'ProductUnitAuditLog',
  ```
- **Root cause:** Nothing references this file (neither `jest.config.js` nor `test/jest-e2e.json` declares `setupFiles`/`globalSetup` pointing at it); it is a stale copy of `global-setup.ts` whose list omits `InvoiceItemUnitAssignment` (present in `global-setup.ts:15`), and its `catch {}` hides the resulting FK failures.
- **Impact at scale:** Two divergent cleanup implementations invite future edits to the wrong one. If someone wires this file in, `TRUNCATE ... CASCADE` on `InvoiceItem` silently destroys assignments, or the missing table leaves orphan rows that make subsequent runs order-dependent.
- **Reproduction:** `git grep -n "test/setup"` → no config references; add a log line inside `cleanDatabase` and run the suite → never printed.
- **Fix:** Delete `backend/test/setup.ts` and keep a single source of truth for truncation (ideally one `resetDatabase()` in a helper imported by `global-setup.ts`), with the table list derived from `pg_tables` filtered to the test schema instead of hand-maintained.
- **Verification:** File removed; `git grep -n "InvoiceItemUnitAssignment" backend/test` appears once in the single shared helper.
- **Status:** - [ ] Fixed

---

## CT-21 — `check-db.js` dumps every employee account to stdout

- **Severity:** S3
- **Location:** `backend/check-db.js:4-11`
- **Evidence:**
  ```js
    const employees = await p.employee.findMany({
      select: { id: true, username: true, role: true, isActive: true, workplaceId: true },
    });
    const workplaces = await p.workplace.findMany({
      select: { id: true, name: true, isActive: true },
    });
    console.log('EMPLOYEES:', JSON.stringify(employees, null, 2));
    console.log('WORKPLACES:', JSON.stringify(workplaces, null, 2));
  ```
- **Root cause:** An unbounded `findMany()` with no `take`, printing the full account inventory (usernames, roles, active state, branch) to stdout. There is no env guard and no redaction.
- **Impact at scale:** Usernames + roles are the enumeration half of a credential attack; on a 100k-customer deployment with hundreds of employees this also floods logs/terminal buffers. Output pasted into a ticket or CI log becomes a persistent disclosure.
- **Reproduction:** `node backend/check-db.js` → full JSON of all employees and workplaces in the console/log.
- **Fix:** Delete the script or reduce it to counts (`employee.count()`, `groupBy role`), require an explicit `--workplace <id>` filter, and never print usernames.
- **Verification:** `git grep -n "EMPLOYEES:" backend` returns nothing; any replacement prints only aggregate counts.
- **Status:** - [ ] Fixed

---

## CT-22 — Oxlint config is minimal and the lint script never fails on warnings

- **Severity:** S3
- **Location:** `frontend/.oxlintrc.json:1-8`
- **Evidence:**
  ```json
  {
    "$schema": "./node_modules/oxlint/configuration_schema.json",
    "plugins": ["react", "typescript", "oxc"],
    "rules": {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { "allowConstantExport": true }]
    }
  }
  ```
- **Root cause:** Only two React rules are configured; no `categories`/`correctness` set, no `no-floating-promises`, no `no-explicit-any`, no `eqeqeq`/`no-eval`, and no type-aware rules. `frontend/package.json:11` is a bare `oxlint` with no `--deny-warnings`, so `"warn"`-level findings exit 0.
- **Impact at scale:** In a codebase with money math and async API calls, unawaited promises and implicit `any` pass lint. Even the one `warn` rule cannot break a build, so lint provides no gate (compounded by CT-15).
- **Reproduction:** Introduce `if (a == b) { fetch('/x'); }` and run `npm run lint` → exits 0 with no error.
- **Fix:** Enable `"categories": { "correctness": "error", "suspicious": "warn" }`, add TypeScript rules (`no-floating-promises`, `no-misused-promises`) via `oxlint-tsgolint`/type-aware mode, and run `oxlint --deny-warnings` in CI.
- **Verification:** The snippet above fails lint; `npm run lint` exits non-zero on any warning in CI.
- **Status:** - [ ] Fixed

---

## CT-23 — No E2E coverage for returns, price adjustments or stock adjustments (money-reversal paths)

- **Severity:** S3
- **Location:** `backend/test/global-setup.ts:8-16`
- **Evidence:**
  ```ts
    'StockConsumption',
    'StockAdjustment',
    'InvoicePriceAdjustment',
    'InvoiceReturnItem',
    'InvoiceReturn',
    'InvoiceChangeRequestItem',
    'InvoiceChangeRequest',
    'InvoiceItemUnitAssignment',
    'InvoiceItem',
  ```
- **Root cause:** The reset list proves the schema has returns, price adjustments and stock adjustments, but the only E2E specs are `invoice-lifecycle`, `invoice-note` and `authorization-matrix` (verified: 3 files under `backend/test/`). Returns/refunds, `InvoicePriceAdjustment` and `StockAdjustment` are never exercised end-to-end.
- **Impact at scale:** Refunds/returns are the highest-risk money paths (negative quantities, cost restoration, unit status rollback, FIFO lot re-entry, rounding). With no E2E coverage, a regression silently corrupts revenue, COGS and inventory valuation across 5M invoices, and only surfaces in month-end reports.
- **Reproduction:** `git grep -n "invoice-returns\|price-adjustment\|stock-adjustment" backend/test` → no spec matches; delete the return-restock logic in the service and the suite stays green.
- **Fix:** Add `returns.e2e-spec.ts` and `price-adjustment.e2e-spec.ts` covering: partial/full return of serialized and FIFO items, unit status restoration, `costAtSale` reversal, totals recomputation, double-return rejection, and concurrent returns on the same invoice.
- **Verification:** New specs fail when the return/restock code is removed; coverage report shows the return/adjustment services above threshold.
- **Status:** - [ ] Fixed

---

## CT-24 — Root `README.md` is a 2-line UTF-16 stub with the wrong project name and no operational docs

- **Severity:** S4
- **Location:** `README.md:1-2` (UTF-16LE with BOM)
- **Evidence:**
  ```markdown
  # reachManegment
  ```
- **Root cause:** The file was never written beyond a title, uses a non-UTF-8 encoding (breaks tooling/diffs), and names the project `reachManegment` while the code and packages are `pallet-backend` (`backend/package.json:2`), `pallet-frontend` (`frontend/ecosystem.config.cjs:4`) and "Pallet POS" (`frontend/index.html:7`).
- **Impact at scale:** There is no documented way to install, configure env vars (`DATABASE_URL`, `JWT_SECRET`, `VITE_API_URL`), run migrations (`prisma migrate deploy`), seed, test, build, or deploy. Production onboarding depends on tribal knowledge — a direct risk for a 100k-customer system.
- **Reproduction:** `Get-Content README.md` shows mojibake/one line; searching the repo for `DATABASE_URL` documentation finds only `.env` files.
- **Fix:** Rewrite as UTF-8 with: architecture overview, prerequisites, `.env.example` table, migrate/seed/build/run commands, test commands (unit vs e2e), deployment (PM2/nginx) and backup/restore steps.
- **Verification:** File is valid UTF-8, `markdownlint` passes, and a new engineer can boot backend+frontend following only the README.
- **Status:** - [ ] Fixed

---

## CT-25 — `frontend/README.md` is the unmodified Vite template and contradicts the actual stack

- **Severity:** S4
- **Location:** `frontend/README.md:1-8`
- **Evidence:**
  ```markdown
  # React + TypeScript + Vite

  This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

  Currently, two official plugins are available:

  - [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
  - [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc/blob/master/packages/plugin-react-swc) uses [SWC](https://swc.rs/)
  ```
- **Root cause:** The template README was never replaced. It advertises `@vitejs/plugin-react-swc`, which is not a dependency (`frontend/package.json:27-38` has only `@vitejs/plugin-react`), and documents nothing about this app (routing, auth, i18n/RTL, `VITE_API_URL`, proxy, tests).
- **Impact at scale:** Contributors follow instructions for a template that does not describe the project; setup mistakes (e.g. assuming SWC, or missing `VITE_API_URL`) waste time and can produce broken builds.
- **Reproduction:** `git grep -n "plugin-react-swc" frontend/package.json` → no match; README still lists it as available.
- **Fix:** Replace with app-specific docs: scripts table, env vars, proxy/dev-SSL notes (`HTTPS=1`), test commands, folder map, and the print/branding conventions.
- **Verification:** README references only dependencies that exist; `npm run dev` instructions work on a clean clone.
- **Status:** - [ ] Fixed

---

## CT-26 — Branding plan's "verified" current state contradicts the code it describes

- **Severity:** S4
- **Location:** `.planning/plans/branding-settings-logo.md:19` (also `:8`, `:64`, `:71`, `:129`)
- **Evidence:**
  ```markdown
  - `multer` متوفر (عبر `@nestjs/platform-express`) لكن `@types/multer` غير مثبَّت
  ```
- **Root cause:** The plan was written before implementation and never reconciled. Verified against the tree: `@types/multer` **is** installed (`backend/package.json:48`), `frontend/src/lib/settings.tsx` **exists** (plan step 6 says create it), and `GET /settings/brand` + `POST /settings/logo` **exist** (`backend/src/settings/settings.controller.ts:36,66`) although plan line 8 says only `GET/PATCH /api/settings` exists. Line references are also stale: `Sidebar.tsx:96` is now a comment about an SVG gear path, not the logo block. Conversely `frontend/src/components/BrandMark.tsx` (plan step 7) does **not** exist, so "all locations use a shared BrandMark" is untrue.
- **Impact at scale:** Engineers re-planning or auditing branding will duplicate endpoints, reinstall existing types, and follow wrong line numbers. Divergence between plan and code is how the logo ends up implemented inconsistently across invoice/print/Excel surfaces.
- **Reproduction:** `Test-Path frontend/src/components/BrandMark.tsx` → `False`; `Select-String backend/package.json "@types/multer"` → match; `git grep -n "Post('logo')\|Get('brand')" backend/src/settings/settings.controller.ts` → matches.
- **Fix:** Mark the plan as implemented (date + commit), correct the stale line references, add the missing `BrandMark` extraction as an explicit open item, and move remaining work to the issue tracker rather than a prose plan.
- **Verification:** Every "Current State" claim matches `git grep` output; the open-items list contains only genuinely missing work.
- **Status:** - [ ] Fixed

---

## CT-27 — `debug-attendance.js` has no error handling and assumes `AppSetting.id = 1`

- **Severity:** S4
- **Location:** `backend/debug-attendance.js:3-13`
- **Evidence:**
  ```js
  (async () => {
    const rows = await p.attendance.findMany({
      orderBy: { id: 'desc' },
      take: 5,
      include: { employee: { select: { username: true } } },
    });
    console.log(JSON.stringify(rows, null, 2));
    const s = await p.appSetting.findUnique({ where: { id: 1 } });
    console.log('tz', s && s.timezone);
    console.log('now local', new Date().toString(), 'iso', new Date().toISOString());
    await p.$disconnect();
  })();
  ```
- **Root cause:** Unlike the other debug scripts, there is no `.catch(...)`, so any DB error becomes an unhandled rejection with a confusing exit path; and it hardcodes the singleton row `id: 1`, which is not guaranteed by the schema.
- **Impact at scale:** Timezone diagnostics (the whole point of the script) can fail silently on a fresh/restored database where the settings row has a different id, producing misleading "tz undefined" conclusions during incident response.
- **Reproduction:** Delete the `AppSetting` row, run the script → `tz undefined` with no error, or crash with an unhandled rejection if the table is unreachable.
- **Fix:** Use `findFirst()` for the singleton settings row, add the same `.catch`/`$disconnect`/`process.exit(1)` pattern used by `check-db.js:13-17`, and print only the fields needed.
- **Verification:** Script exits non-zero with a clear message when the DB is unreachable and prints the real timezone after a restore.
- **Status:** - [ ] Fixed

---

## CT-28 — Static shell hardcodes `lang="en"` and the title, so pre-hydration/offline states are wrong for Arabic

- **Severity:** S4
- **Location:** `frontend/index.html:1-7`
- **Evidence:**
  ```html
  <!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Pallet POS</title>
  ```
- **Root cause:** The served shell is English/LTR with a fixed title. Runtime correction does exist — `frontend/src/i18n/context.tsx:26-27` sets `document.documentElement.dir`/`lang`, and `frontend/src/lib/settings.tsx:100` sets `document.title = brand.businessName` — but only after JS loads and the settings request resolves. Unlike the theme, nothing is applied before first paint (`index.html:10-28` handles only the theme), and there is no no-JS fallback.
- **Impact at scale:** On a slow terminal or a failed/blocked `/settings` request, the app paints in the wrong direction/language and shows the wrong brand in the tab; crawlers, print-to-PDF pre-render and screen readers that read the initial document get English metadata for Arabic content. Cosmetic but user-visible on every cold load.
- **Reproduction:** Throttle to offline after the HTML loads (or disable JS) and open the app with Arabic selected → the document stays `lang="en"`, `dir` unset, title "Pallet POS", even though the stored locale is Arabic.
- **Fix:** Persist the chosen locale (like `pallet-theme`) and apply `lang`/`dir` in the inline pre-paint script; add a `dir`/`lang` attribute update in the i18n provider (already present) and a `<noscript>`/fallback title from a static brand value. Keep `Pallet POS` only as the documented fallback.
- **Verification:** With JS disabled or `/settings` blocked, the document direction/lang match the last chosen locale and the title is the configured brand (or the documented fallback).
- **Status:** - [ ] Fixed
