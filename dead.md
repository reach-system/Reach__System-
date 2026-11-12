# Dead Code and Codebase Hygiene Audit

**Audit date:** 2026-11-12  
**Scope:** Current working tree, including its pre-existing uncommitted changes. This report is an audit only; no files other than this report were changed.

## 1. Executive Summary

This repository contains a React 19/Vite frontend and a NestJS/Prisma backend, plus repository-level audit material and an `.opencode` design toolkit. The strongest evidence is TypeScript's no-unused diagnostics, exact duplicate-file hashes, and absent source references. Potential external, dynamic, and operator-driven uses are called out rather than treated as proof of dead code.

### Findings at a glance

| Category | Confirmed / likely evidence | Uncertain candidates |
|---|---:|---:|
| Unused files | 3 disposable Python bytecode files; 1 unregistered backend test helper candidate | 2 source archives; tracked runtime logs |
| Unused exports | 4 helper exports with no discovered consumer | Manual/external imports remain possible |
| Unused functions, classes, types | 5 private backend methods and 1 DTO class flagged by TypeScript | Three methods are used only by tests; see Category 3 |
| Unused imports and locals | 28 declarations flagged by TypeScript | Some local state and test bindings need behavior review |
| Unreachable code | 0 confirmed | Static analysis was not exhaustive |
| Commented-out code / stale notes | 1 commented JSX block; 1 stale audit-coverage inventory | The JSX block also leaves translations/state unused |
| API endpoints | 0 confirmed unused endpoints or missing client/server matches | Two dashboard data requests may now feed only commented UI |
| DTOs / database artifacts | 1 unused DTO candidate; no table, column, repository, or migration proven unused | Prisma migrations are retained as history |
| CSS / styles | 0 proven unused selectors | 17 selectors have no literal TS/TSX token reference |
| Assets | 0 proven unused | 4 static-reference-free asset candidates |
| i18n | 0 proven unused keys | 3 keys appear only in commented JSX |
| Environment/config | 0 confirmed removable keys | 1 backend env-key candidate; 1 host-specific PM2 path to verify |
| Dependencies | 2 backend direct-dependency candidates | Confirm deployment and dynamic consumers first |
| Duplicated content | 2 exact duplicate SQL-file pairs | 6 exact duplicate documentation pairs in separate skill namespaces |
| Junk / leftover files | 3 bytecode cache files | Archives, logs, and audit output may be intentionally retained |
| Dead tests | 0 proven dead tests | 1 unregistered backend helper file is a candidate, not a test suite |
| Circular dependencies / oversized files | Not established | No dependency-graph or size-threshold tool was run |

**Removable-size estimate:** The TypeScript checks identified 28 unused import/local declarations, plus 5 private method bodies and 1 DTO definition. Three of the methods are test-only today and should not be removed without first updating their tests. This is a count of declaration sites, not an exact LOC total; method/type body sizes were not summed. Three confirmed bytecode caches total **158,982 bytes**. Two exact SQL duplicate pairs and two dependency declarations are additional candidates, subject to the risks below. No code was removed to measure the actual delta.

### Highest-impact cleanup candidates (in recommended order)

1. Review the five unused private methods in `backend/src/invoice-change-requests/invoice-change-requests.service.ts`; remove only after the dynamic-use check and behavior tests.
2. Resolve the two duplicate root/legacy SQL pairs in `backend/prisma/`; the legacy README says these are archived, but confirm no operator workflow uses them.
3. Verify `handlebars` and `puppeteer` are not consumed by deployment tooling or out-of-tree scripts before removing them from `backend/package.json`.
4. Confirm whether `backend/test/setup.ts` is intentionally retained for manual tests; its four exports have no discovered consumer and it includes database cleanup behavior.
5. Remove the confirmed-unused frontend imports and local values after reviewing the individual call sites.
6. Remove the confirmed-unused backend imports/locals and unused DTO after checking tests/decorators.
7. Remove the three `.pyc` cache files; they are generated artifacts, not source.
8. Confirm the four frontend assets are not URL- or runtime-loaded before deleting them.
9. Decide whether the `.rar` archives and committed server logs are required historical/operator artifacts.
10. Regenerate `audit/COVERAGE.md` if it is still meant to represent current audit coverage.

## 2. Methodology & Coverage

### Stack and entry points

- **Frontend:** React 19, TypeScript, Vite. `frontend/index.html` loads `frontend/src/main.tsx`; `frontend/src/App.tsx` is the application/router layer. `frontend/print-harness.html` separately loads `frontend/src/print-harness.tsx`, so the harness is not an orphan entry point. Vite configuration and scripts are in `frontend/vite.config.ts` and `frontend/package.json`.
- **Backend:** NestJS, TypeScript, Prisma. Bootstrap is `backend/src/main.ts`; `backend/src/app.module.ts` wires modules/providers; controllers are decorator/convention-driven and therefore were not classified as dead from plain text counts. Prisma schema, seed, and migration history are under `backend/prisma/`. Jest configuration is in `backend/jest.config.js` and `backend/test/jest-e2e.json`.
- No .NET solution/project files or C# source were found; .NET-specific analyzer checks are not applicable.
- **Other entry points:** backend package scripts include Nest build/start, Prisma migration/seed, and tests. Repository-level audit scripts include `audit/scripts/generate_coverage.ps1` and `audit/scripts/seed_large_dataset.js`. The latter is operator-invoked, not an application entry point. `.opencode/` is a substantial toolkit whose skills may be loaded by external tooling.
- No root `package.json` or root application launcher was found. The root `README.md` contains only a title.

### Tools and searches

- Frontend lint: `Set-Location frontend; npm run lint` (Oxlint; exit 0 with warnings).
- Frontend tests: `Set-Location frontend; npm test` (**48 passed, 0 failed, 0 skipped**). This script does not include every test-like file in the tree.
- Frontend unused-symbol check: `tsc -p tsconfig.app.json --noEmit --incremental false --noUnusedLocals --noUnusedParameters`.
- Backend unused-symbol check: `tsc -p tsconfig.json --noEmit --incremental false --noUnusedLocals --noUnusedParameters`.
- Scoped `rg` searches covered named helper exports, dependencies, assets, archives/logs, route/source references, and TODO/FIXME/debug patterns. SHA-256 comparisons were used for exact duplicate files.
- The frontend and backend TypeScript configurations do not enable the relevant no-unused checks for their full application builds; the checks above explicitly enabled them for this audit.

### Included and excluded paths

- Reviewed: `frontend/src`, `frontend/public`, frontend entry/config files; `backend/src`, `backend/test`, `backend/scripts`, `backend/prisma`, backend entry/config files; root docs; `audit/`, `.planning/`, and `.opencode/`.
- Excluded as requested: `node_modules`, `bin`, `obj`, `dist`, `build`, `.next`, `.git`, `coverage`, and lock files. Generated build output and vendor contents were not assessed.
- No root `.gitignore` was present; backend/frontend have their own ignore files.

### Known limitations

- The working tree was already substantially dirty before the audit: it contained tracked modifications/deletions and untracked feature/audit files. Findings refer to the current checkout, not a clean commit. Existing changes were preserved.
- No `knip`, `ts-prune`, `depcheck`, `madge`, backend build, or backend test suite was run. Backend lint is configured with `--fix`, so it was not invoked. Build commands can write generated output, and backend tests may alter a database.
- The backend no-unused TypeScript command exited nonzero with unused-symbol diagnostics and six existing constructor-argument type errors in `backend/src/invoices/invoices.service.spec.ts` (lines 5, 32, 112, 169, 242, and 295: expected 3–4 arguments, received 2). The constructor errors are not classified as dead code.
- The frontend no-unused check reported `dashboard` at `frontend/src/pages/sales/Home.tsx:20`. Follow-up review resolved this: its apparent JSX reads are inside the commented block at lines 131–146, so active-code reads are 0.
- Text searches cannot rule out external package consumers, dynamically constructed routes/classes/i18n keys, runtime URLs, reflection, or operator-invoked scripts. No endpoint, model, migration, translation key, or CSS selector is called dead solely because it lacked an obvious textual reference.
- Environment values were not inspected. Backend environment key names were checked value-blind: `backend/.env` declares 13 keys; 12 are read by backend code/config, while `FRONTEND_URL` has no backend reference. Its use by the frontend/deployment is unresolved. `frontend/.env.production` keys were not cross-checked.
- The explicitly tagged `frontend/src/pages/shared/LastPrices.tsx` was verified used: seven `LastPrices|last-prices` references include its direct import, two routes, two sidebar links, and its own export/API use. No lazy/dynamic import pattern was found; keep the page.
- The frontend test script does not include `frontend/src/features/printing/utils/disbursementVoucherData.test.ts`, `frontend/src/features/printing/utils/formatters.test.ts`, or `frontend/src/__audit__/invoiceTotalsParity.audit.test.ts`; they are not classified as dead from that omission.
- Other backend packages with zero literal package-name hits (`reflect-metadata`, `rxjs`, and `passport`) were not labeled unused: they participate in Nest/runtime or peer-dependency conventions. Build/tool packages and `@types/*` dependencies are referenced by scripts/configuration or used as type support.

## 3. Findings by Category

### 1. Unused files

#### Verified false positive: shared LastPrices page

- **Location:** `frontend/src/pages/shared/LastPrices.tsx`
- **Symbol/Item:** `LastPrices` page component
- **Confidence:** High that it is used
- **Evidence:** `rg -n 'LastPrices|last-prices' frontend` found 7 references: direct import in `frontend/src/App.tsx:44`, routes at `App.tsx:170,236`, sidebar links at `frontend/src/components/Sidebar.tsx:180,250`, and the page export/API use at `LastPrices.tsx:31,51`. A targeted search for `import(`, `lazy(`, and `import.meta.glob` in `frontend/src` found no matches; no barrel is required.
- **Why it is not dead:** It is directly imported and routed.
- **Recommended action:** Keep.
- **Risk:** Not applicable.

#### Candidate: backend test setup helper

- **Location:** `backend/test/setup.ts`
- **Symbol/Item:** Test helper module exporting `testPrisma`, `cleanDatabase`, `createTestEmployees`, and `createTestCategory`
- **Confidence:** Medium
- **Evidence:** `rg -n 'testPrisma|cleanDatabase|createTestEmployees|createTestCategory|setup\.ts' backend` found no imports or consumer uses outside the definitions. Jest configs do not register this file as setup; e2e config uses `test/global-setup.ts`.
- **Why it may be dead:** No configured test or source import was found.
- **Recommended action:** Investigate before deleting; confirm there is no manual test workflow. The helper includes database cleanup logic.
- **Risk:** Moderate

### 2. Unused exports

#### Candidate: exports from backend test setup

- **Location:** `backend/test/setup.ts:6,8,51,76`
- **Symbol/Item:** `testPrisma`, `cleanDatabase`, `createTestEmployees`, `createTestCategory`
- **Confidence:** Medium
- **Evidence:** The scoped `rg` search listed above found zero consumers outside their declarations; Jest configuration does not import/register `setup.ts`.
- **Why it may be dead:** No in-repository test or source consumer was found.
- **Recommended action:** Investigate; remove only if manual/out-of-tree tests do not import these helpers.
- **Risk:** Moderate, because `cleanDatabase` is destructive when invoked.

### 3. Unused functions, methods, classes, components, hooks, types, interfaces, enums, constants

#### Five backend private methods

- **Location:** `backend/src/invoice-change-requests/invoice-change-requests.service.ts:50,226,917,1346,1488`
- **Symbol/Item:** `applyInvoiceProductLastPrice`, `getEffectivePrice`, `approveReturnTransaction`, `approvePriceChangeTransaction`, `approveAddItemTransaction`
- **Confidence:** High for the first two; Medium for the last three
- **Evidence:** The backend no-unused TypeScript check emitted TS6133 for each. `rg -n 'applyInvoiceProductLastPrice|getEffectivePrice|approveReturnTransaction|approvePriceChangeTransaction|approveAddItemTransaction' backend/src/invoice-change-requests backend/test/__audit__/invoice-changes.audit.spec.ts` found one match (its declaration) each for `applyInvoiceProductLastPrice` (line 50) and `getEffectivePrice` (line 226), with no calls. The other three have no production call site, but `approveReturnTransaction` is called by its service unit spec at lines 704, 737, 760, 783, 794, 846, 889, 920, 934, 964, and 977; `approvePriceChangeTransaction` at lines 1262, 1295, 1311, 1327, 1342, and 1353; `approveAddItemTransaction` at lines 349, 428, 474, 535, 591, and 619. The public approval route performs the work inline and uses shared `apply*Actions` helpers.
- **Why they may be dead:** The first two have only declarations; the last three are test-live but appear to be obsolete production wrappers.
- **Recommended action:** Remove the first two after ordinary tests. For the other three, move tests to the public approval path or explicitly retain the helpers as test seams before removal.
- **Risk:** Low for the two declaration-only methods; Medium for the three test-live wrappers.

#### Unused DTO class

- **Location:** `backend/src/stock-receipts/dto/create-stock-receipt.dto.ts:5`
- **Symbol/Item:** `SerializedItemDto`
- **Confidence:** High
- **Evidence:** Backend TypeScript no-unused check emitted TS6196 (“declared but never used”). The declaration has no references; the DTO's `barcodes?: string[]` field and the nested `NonSerializedItemDto` at lines 48–59 are used instead.
- **Why it may be dead:** The compiler found no type/value use in the project.
- **Recommended action:** Delete after a final search for external DTO consumers; no decorator/transformer registration refers to this class.
- **Risk:** Low

### 4. Unused variables, parameters, imports

#### Frontend declarations

- **Location:**  
  `frontend/src/components/ui/LoadingSpinner.tsx:1`;  
  `frontend/src/components/ui/Pagination.tsx:1`;  
  `frontend/src/components/ui/StatusChip.tsx:1`;  
  `frontend/src/pages/accountant/PendingInvoices.tsx:10,24`;  
  `frontend/src/pages/admin/AuditHistory.tsx:6`;  
  `frontend/src/pages/admin/Settings.tsx:54`;  
  `frontend/src/pages/admin/StockPricing.tsx:9`;  
  `frontend/src/pages/admin/Suppliers.tsx:10`;  
  `frontend/src/pages/inventory/CategoriesModels.tsx:10`;  
  `frontend/src/pages/inventory/Home.tsx:15`;  
  `frontend/src/pages/inventory/StockAdjustments.tsx:11`;  
  `frontend/src/pages/sales/Customers.tsx:10`;  
  `frontend/src/pages/sales/Home.tsx:20,22`
- **Symbol/Item:** Three `React` imports; six `Card` imports; one `Table` import; `navigate`; `section`; `color`; `dashboard`; `pendingCount`
- **Confidence:** High for unused imports and unread state values; Medium for parameter/call-site simplification
- **Evidence:** The frontend no-unused command emitted 15 TS6133 diagnostics, including `dashboard` at `frontend/src/pages/sales/Home.tsx:20` and `pendingCount` at `:22`. `dashboard` is set at `:43`, but its only apparent reads at lines 136 and 142 are inside a commented JSX block (lines 131–146); active-code reads are 0. `pendingCount` is set at line 45 and has 0 reads; its request is at line 36. The dashboard request is at line 33. The other unread imports/locals and lines are listed above.
- **Why they may be dead:** The state values feed only the commented UI; the compiler found no active reads for them.
- **Recommended action:** Remove the commented JSX block, then review and remove its now-unused state setters and requests. Delete unused imports; inspect `handleSave(section)` and `statTileStyle(color)` before simplifying their call sites.
- **Risk:** Low for imports; low-to-medium for state/parameters.

#### Backend declarations

- **Location:**  
  `backend/src/attendance/attendance.controller.ts:15`;  
  `backend/src/attendance/attendance.service.spec.ts:59`;  
  `backend/src/audit/audit.controller.ts:2`;  
  `backend/src/auth/auth.service.spec.ts:1`;  
  `backend/src/categories/categories.service.ts:3`;  
  `backend/src/customers/customers.controller.spec.ts:1,4`;  
  `backend/src/employees/employees.controller.ts:1`;  
  `backend/src/expenses/expenses.controller.ts:2`;  
  `backend/src/expenses/expenses.service.ts:1`;  
  `backend/src/invoice-delivery/invoice-delivery.service.ts:1`;  
  `backend/src/invoices/invoices.service.ts:477`;  
  `backend/test/quotations.e2e-spec.ts:763`
- **Symbol/Item:** `ApiQuery` (attendance, audit, expenses); unused test parameter `key`; all imports in one `auth.service.spec.ts` declaration; `Prisma`; `Reflector`; `Roles`; `Request`; `BadRequestException`; `ForbiddenException`; `affectedModelIds`; test local `draft`
- **Confidence:** High for unread imports/locals within the TypeScript project; test-only declarations remain subject to the configured test/runtime environment.
- **Evidence:** Backend no-unused TypeScript check emitted TS6133/TS6192 diagnostics for every listed declaration. The compiler reported zero static reads for those declarations.
- **Why they may be dead:** No compiled-project read was found.
- **Recommended action:** Remove unused imports and locals in a cleanup-only change; run focused unit/e2e tests and type-check after each coherent batch.
- **Risk:** Low for imports; low-to-medium for test locals and `affectedModelIds`.

### 5. Unreachable code

- **Confirmed findings:** 0.
- **Evidence:** The source audit did not establish any branch that is provably impossible or any code after an unconditional return/throw. No dedicated control-flow analyzer was run.
- **Recommended action:** Keep; do not infer unreachable code from absence of references alone.
- **Risk:** Not applicable.

### 6. Commented-out code and stale TODO/FIXME/HACK notes

#### Commented-out sales dashboard JSX

- **Location:** `frontend/src/pages/sales/Home.tsx:131-146`
- **Symbol/Item:** Commented JSX block for the sales-home summary
- **Confidence:** High that the block does not execute
- **Evidence:** The block is commented out. `dashboard` and `pendingCount` are read only inside it (active reads: 0); their state setters remain at lines 43 and 45, with data requests at lines 33 and 36.
- **Why it is dead:** Commented JSX is not rendered; related values have no active consumer.
- **Recommended action:** Delete the commented block and then review whether the corresponding state and requests can be removed.
- **Risk:** Low, provided no side effect in the requests is intentional.

#### Stale audit coverage snapshot

- **Location:** `audit/COVERAGE.md:3,7-11,17`
- **Symbol/Item:** Generated file inventory and coverage snapshot
- **Confidence:** High that the snapshot is stale; low that the file itself is disposable
- **Evidence:** `COVERAGE.md` says it was generated on 2026-11-04 and records 305 files. Later reports (`problems.md` and `QUOTATIONS_FEATURE_REPORT.md`) are not listed in the coverage ledger or `audit/scripts/_filelist.tsv`; `_filelist.tsv:1` and `COVERAGE.md:17` also disagree on a planning file's line count (124 vs. 150).
- **Why it may be stale:** The inventory predates later files and contains inconsistent line counts.
- **Recommended action:** Regenerate/reconcile if the coverage ledger is still maintained; otherwise archive it with an explicit historical label.
- **Risk:** Low

- **Commented-out code / TODOs:** Apart from the commented JSX finding above, the `TODO|FIXME|HACK|XXX` scan found occurrences across source, docs, and toolkit examples, but no additional item was established as stale or dead code. Console logging in seed/CLI scripts is intentional output, not debug residue by itself.

### 7. Unused API endpoints/controllers/actions

- **Confirmed findings:** 0 unused backend endpoints; 0 frontend requests proven to target nonexistent endpoints.
- **Evidence:** Nest controller/module wiring and frontend route/API references were reviewed conservatively. In `frontend/src/pages/sales/Home.tsx`, requests at lines 33 and 36 populate values consumed only by the commented JSX at lines 131–146. This makes those client requests potentially redundant, but does not prove the backend endpoints are unused by other pages or external clients. Decorators, module registration, browser callers, and possible external clients make repository-wide plain-text counts insufficient proof.
- **Recommended action:** Keep all endpoint/controller candidates absent stronger usage telemetry or a documented API deprecation.
- **Risk:** High if an endpoint is removed without consumer inventory.

### 8. DTOs, entities, models, DB columns/tables, repositories, migrations

#### Unused DTO candidate

- **Location:** `backend/src/stock-receipts/dto/create-stock-receipt.dto.ts:5`
- **Symbol/Item:** `SerializedItemDto` (also listed in Category 3)
- **Confidence:** High
- **Evidence:** TypeScript emitted TS6196; the class has no references. The DTO uses `barcodes?: string[]` and nests `NonSerializedItemDto` at lines 48–59 instead.
- **Why it may be dead:** No compile-time consumer was found.
- **Recommended action:** Delete after a final search for external DTO consumers; retain Prisma migration history.
- **Risk:** Low

- **Database objects/migrations:** No table, column, entity, repository, stored procedure, or migration was proven unused. Prisma migration files are conventionally consumed by migration history and are not dead based on source references.

### 9. CSS/SCSS classes, Tailwind custom classes, styles, theme variables

- **Confirmed findings:** 0 selectors proven unused; 17 selector candidates have no literal TS/TSX references.
- **Evidence:** A literal-token scan found zero TS/TSX references for `.arabic-text` (`frontend/src/index.css:325`), `.ltr-num` (`:359`), `.focus-ring` (`:371`), `.badge-success`/`.badge-warning`/`.badge-danger`/`.badge-info` (`:622-625`), `.print-only` (`:740`), `.kpi-grid` (`:880`), and `.tab-content` (`:1090`). It also found zero for `.pn-footer-signature` (`frontend/src/features/printing/print.css:489`), `.pn-footer-signature__line` (`:494`), `.disbursement-voucher__signatures` (`:600`), `.disbursement-voucher__signature-line` (`:623`), `.disbursement-voucher__signature-fields` (`:630`), `.print-document--landscape` (`:704`), and `.print-break-inside-avoid` (`:883`). The scan correctly required a runtime exception: `.invoice-document--preview` is constructed in `InvoiceDocument.tsx:177`; `.badge-brand` is used in `QuotationsReportPage.tsx:405`.
- **Why they may be dead:** No literal class token reference was found in TS/TSX for the candidates.
- **Recommended action:** Investigate dynamic construction, CSS-to-CSS references, external content, and print rendering before removal.
- **Risk:** Medium to high if dynamic or print-only styles are removed.

### 10. Unused assets

#### Frontend static-reference-free assets

- **Location:** `frontend/src/assets/hero.png`; `frontend/src/assets/react.svg`; `frontend/src/assets/vite.svg`; `frontend/public/icons.svg`
- **Symbol/Item:** Image/SVG assets
- **Confidence:** Low-to-medium
- **Evidence:** The targeted literal filename search (`hero\.png|react\.svg|vite\.svg|icons\.svg`) found zero references in the searched frontend files. `frontend/public/favicon.svg` was confirmed used by `frontend/index.html:5` and `frontend/src/lib/settings.tsx:122`.
- **Why they may be dead:** No literal in-repository reference was found for the four candidates.
- **Recommended action:** Investigate direct URL requests, dynamic URLs, and external/static hosting references before deletion.
- **Risk:** Medium

- **Backend uploads:** `backend/uploads/` contains image files that may be persisted or served via database URLs. No database/file-reference reconciliation was performed, so none is classified as unused.

### 11. i18n/translation keys

- **Confirmed findings:** 0 missing keys; 3 unused-key candidates

#### Keys used only by commented JSX

- **Location:** `frontend/src/pages/sales/Home.tsx:131,134,140`; `frontend/src/i18n/en.ts:578-580`; `frontend/src/i18n/ar.ts:578-580`
- **Symbol/Item:** `t.salesHome.today`, `t.salesHome.invoices`, `t.salesHome.revenue`
- **Confidence:** Medium-high
- **Evidence:** The only reported call sites are in the commented JSX block; corresponding English and Arabic definitions remain in both locale files.
- **Why they may be dead:** The only discovered use does not execute.
- **Recommended action:** Remove the keys from both dictionaries only after removing the commented block and running a key-aware validation.
- **Risk:** Low-to-medium

### 12. Environment variables, config keys, constants, feature flags

#### Backend environment key without backend consumer

- **Location:** `backend/.env` (key name only; value not read)
- **Symbol/Item:** `FRONTEND_URL`
- **Confidence:** Medium that it is unused by backend code; low that it is globally unused
- **Evidence:** `backend/.env` declares 13 keys. `rg -n -F FRONTEND_URL backend` found zero references in backend source/config (excluding dependency/build/coverage/lock/environment files). The other 12 key names have 15 `ConfigService.get(...)` reads across eight keys plus direct reads of `DATABASE_URL`, `CORS_ORIGINS`, `NODE_ENV`, and `PORT`. No backend `.env.example` was found.
- **Why it may be dead:** The backend has no reference to this declared key.
- **Recommended action:** Investigate frontend and deployment usage before removing it from the environment file.
- **Risk:** Medium if a deployment process consumes it.

#### Host-specific PM2 working directory

- **Location:** `frontend/ecosystem.config.cjs:8`
- **Symbol/Item:** PM2 `cwd`
- **Confidence:** Medium that it is host-specific; not proven dead
- **Evidence:** The configured path is `C:/Users/one/Desktop/rich_mangment/frontend`, while the audited checkout is `C:\Users\Yossef\Desktop\rich_mangment`. The file is a deployment configuration and may intentionally target another host.
- **Why it may be stale:** The path does not match the current checkout or user profile.
- **Recommended action:** Investigate the deployment host; replace with a deployment-appropriate path or configuration only if this file is still used.
- **Risk:** Medium; a wrong working directory can prevent startup.

### 13. Unused dependencies and devDependencies

#### Backend direct-dependency candidates

| Package | Where declared | Evidence | Safe to remove? |
|---|---|---|---|
| `handlebars` | `backend/package.json:35` | `rg -n 'handlebars' backend` found no application, test, script, or Prisma references outside generated/lock/log material. | Not yet. Check deployment tooling and dynamic consumers. |
| `puppeteer` | `backend/package.json:38` | `rg -n 'puppeteer' backend` found no application, test, script, or Prisma references outside generated/lock/log material. | Not yet. It may be used by out-of-tree PDF/deployment tooling. |

- **Confidence:** Medium-high for no in-repository static consumer; medium for safe removal.
- **Recommended action:** Investigate external runtime/build scripts, then remove with the package manager and run backend build/tests in a disposable database/worktree.
- **Risk:** Medium
- **Frontend dependencies:** No frontend package was proven unused by this audit. No dependency-pruning tool was run; this is not proof every dependency is needed.

### 14. Duplicated code

#### Exact duplicate SQL files

- **Location:** `backend/prisma/add_role.sql` and `backend/prisma/legacy/add_role.sql`; `backend/prisma/constraints.sql` and `backend/prisma/legacy/constraints.sql`
- **Symbol/Item:** Two pairs of duplicate SQL scripts
- **Confidence:** High that contents are duplicates; medium that either root copy is removable
- **Evidence:** SHA-256 hashes match within each pair. The legacy scripts are documented in `backend/prisma/legacy/README.md:1-4` as archived/out-of-band and not the supported migration path. No code/config reference to the root SQL paths was found. `backend/prisma/migration.sql` is not identical to its legacy copy (194 vs. 166 lines), so it is not classified as a duplicate.
- **Why they may be redundant:** Each exact SQL body exists at both the Prisma root and under `legacy/`.
- **Recommended action:** Investigate operator/deployment workflows; if confirmed obsolete, remove or clearly label one copy. Do not remove `migration.sql` based on this finding.
- **Risk:** High if operators still run SQL manually.

#### Exact duplicate toolkit documentation

- **Location:** Six pairs under `.opencode/skills/design/references/` and `.opencode/skills/slides/references/` or `.opencode/skills/banner-design/references/`
- **Symbol/Item:** `banner-sizes-and-styles.md`, `slides-copywriting-formulas.md` / `copywriting-formulas.md`, `slides-create.md` / `create.md`, `slides-html-template.md` / `html-template.md`, `slides-layout-patterns.md` / `layout-patterns.md`, `slides-strategies.md` / `slide-strategies.md`
- **Confidence:** High that the file contents are identical; low that either copy is dead
- **Evidence:** SHA-256 grouping found six exact pairs. Each path is referenced by its respective skill documentation; the banner reference is cited by both relevant skills. `.opencode/` may be consumed by external tools.
- **Why they may be redundant:** The same content is maintained at multiple paths.
- **Recommended action:** Keep unless the skill loader and external relative-path consumers can be updated together; otherwise establish a single source and retain compatibility links.
- **Risk:** Medium

### 15. Junk files, logs, archives, build output, leftover debug code

#### Python bytecode cache

- **Location:** `.opencode/skills/ui-ux-pro-max/scripts/__pycache__/`
- **Symbol/Item:** `core.cpython-314.pyc` (50,513 bytes), `design_system.cpython-314.pyc` (100,103 bytes), `reasoning_contract.cpython-314.pyc` (8,366 bytes)
- **Confidence:** High
- **Evidence:** Scoped file enumeration found exactly three `.pyc` files (158,982 bytes total); `rg -n '__pycache__|\.pyc' .opencode` found no textual cache references.
- **Why they are dead:** These are generated Python bytecode caches, not source inputs.
- **Recommended action:** Delete the cache files and ensure the cache directory is ignored.
- **Risk:** Low

#### Source archives and server logs

- **Location:** `backend/src.rar` (144,157 bytes); `frontend/src.rar` (319,380 bytes); tracked `backend/server.err.log` (9,370 bytes); tracked `backend/server.out.log` (28,732 bytes)
- **Symbol/Item:** Two archive files and two runtime log files
- **Confidence:** Low-to-medium
- **Evidence:** No source/config reference establishing runtime use was found. The archives are untracked; the logs are tracked. Audit inventory notes identify logs as runtime artifacts. Archives may be manual backups, and logs may be retained operational evidence.
- **Why they may be dead:** They are not application entry points and have no discovered runtime consumer.
- **Recommended action:** Investigate ownership/retention; delete only with owner approval. Do not treat `.rar` as proof that archived source is obsolete.
- **Risk:** Medium for loss of historical or backup data; low for runtime behavior.

- **Other audit logs:** `audit/backend-audit-run1.log`, `build-backend.log`, `build-frontend.log`, `c4-run.log`, and `test-backend.log` are retained audit outputs. Their contents may be historical evidence; they were not proven junk.
- **Debug and CLI scripts:** `backend/check-db.js`, `debug-api.js`, `debug-attendance.js`, `debug-delivery.js`, `debug-ui.js`, `e2e-attendance.js`, and `ensure-kiosk.js` are mentioned by audit inventory/findings and are manually runnable. They are not classified as dead solely because no package script calls them.
- **Generated/vendor exclusions:** No claim is made about excluded `dist`, `node_modules`, `coverage`, lock files, or other generated/vendor contents.

### 16. Dead tests

- **Confirmed dead tests:** 0.
- **Evidence:** The frontend configured test command passed 48 tests. Backend regular and audit-specific Jest configurations were examined; `backend/test/__audit__` has its own explicit Jest configuration and is not considered dead merely because the regular test regex does not discover it. The frontend script does not include the two printing utility tests or `src/__audit__/invoiceTotalsParity.audit.test.ts`.
- **Test-live private wrappers:** Three methods in `invoice-change-requests.service.ts` are called only by unit tests (see Category 3). The tests may be validating obsolete wrappers rather than the public approval route; do not call the tests dead before reviewing their intent.
- **Candidate helper:** `backend/test/setup.ts` has no discovered consumer (see Categories 1–2), but it is a helper module, not a proven dead test.
- **Recommended action:** Keep test suites and audit tests; review only the unused helper module.
- **Risk:** High if tests are deleted without checking their explicit runner/configuration.

### 17. Circular dependencies and oversized files

- **Confirmed findings:** Not measured.
- **Evidence:** `madge` or an equivalent graph analyzer was not run; no line-count threshold was specified or reported as a verified maintainability defect.
- **Recommended action:** Investigate only if module-cycle or file-size concerns are observed; no cleanup action is supported by this audit.
- **Risk:** Not applicable.

## 4. Needs Human Decision

1. Are `backend/test/setup.ts` and its database cleanup helpers intentionally used by manual/out-of-tree tests?
2. Can `handlebars` or `puppeteer` be loaded by deployment scripts, PDF tooling, or external runtime consumers?
3. Are the root Prisma SQL files still used by an operator despite the archived legacy documentation?
4. Are the four frontend assets referenced by URL, dynamic asset construction, or external hosting?
5. Are `backend/src.rar`, `frontend/src.rar`, and the committed runtime logs intended backups/records?
6. Is the PM2 config's `cwd` expected to target another deployment machine?
7. Does an external skill loader require the duplicate `.opencode` documentation paths?
8. Is `audit/COVERAGE.md` meant to be current, or is it a historical artifact?
9. Does any external API consumer rely on endpoints or DTOs that repository-only searches cannot see?
10. Are the sales-home requests at `frontend/src/pages/sales/Home.tsx:33,36` intended for side effects, or can they be removed with the commented-only UI state?
11. Is `backend/.env`'s `FRONTEND_URL` consumed by the frontend or deployment tooling?

## 5. Unused Dependencies

| Package | Declared in | Evidence | Safe to remove? |
|---|---|---|---|
| `handlebars` | `backend/package.json:35` | No in-repository source/test/script/Prisma reference found by scoped `rg`; dynamic/external consumers not excluded. | No — investigate external tooling first. |
| `puppeteer` | `backend/package.json:38` | No in-repository source/test/script/Prisma reference found by scoped `rg`; dynamic/external consumers not excluded. | No — investigate PDF/deployment tooling first. |

No frontend dependency is listed as unused because no defensible package-by-package evidence was established. Lock files were excluded as requested.

## 6. Suggested Cleanup Plan

1. **Remove the commented sales-home JSX** and its confirmed stale locale keys; verify the page in both languages and check whether its data requests have side effects.
2. **Remove compiler-confirmed unused imports** in isolated frontend/backend cleanup commits. Verify with the two no-unused TypeScript commands, frontend lint, and focused tests.
3. **Review and remove unused locals/parameters** (`section`, `color`, test bindings) only after checking surrounding side effects. Verify state-driven pages manually and run the relevant tests.
4. **Review the five private methods and unused DTO**. Search for dynamic name-based use, check decorators/reflection, then run invoice/change-request and stock-receipt tests plus backend type-check.
5. **Review test helper exports and duplicate SQL copies** with maintainers/operators. Verify configured Jest tests and the documented migration process; do not execute destructive SQL during cleanup verification.
6. **Validate dependency candidates** against deployment scripts and external tools, then use the package manager to remove candidates. Verify backend build and tests in an isolated environment.
7. **Prune generated `.pyc` caches** and add/confirm ignore rules. Verify source scripts still run; no app build should depend on bytecode.
8. **Resolve asset/archive/log and env-key candidates** with owners. For assets, build and manually smoke-test all routes plus print harness; for archives/logs, confirm retention before removal.
9. **Regenerate stale audit coverage** if it remains an active process artifact; verify listed file counts and line counts against the current tree.
10. **Keep all endpoints, database migrations, dynamic styles, and skill documentation** until dedicated runtime/consumer-aware checks establish safe removal.

## 7. Cleanup Checklist

- [ ] Remove unused frontend imports after review.
- [ ] Remove unused backend imports/locals after review.
- [ ] Remove the commented sales-home JSX and review its now-unused state/request code.
- [ ] Verify and remove unused private methods/DTO only after dynamic-use checks.
- [ ] Confirm whether `backend/test/setup.ts` is still used manually.
- [ ] Confirm operator usage before removing duplicate SQL files.
- [ ] Confirm external/deployment use before removing `handlebars` or `puppeteer`.
- [ ] Remove Python bytecode caches and ensure they remain ignored.
- [ ] Confirm asset URLs, archive ownership, and log retention.
- [ ] Reconcile the PM2 working directory with deployment configuration.
- [ ] Confirm whether `backend/.env`'s `FRONTEND_URL` is consumed outside the backend.
- [ ] Regenerate or archive `audit/COVERAGE.md`.
- [ ] Run appropriate build, lint, focused tests, and manual smoke checks after each cleanup batch.
