# Findings — Build & Operational Blockers

> Read-only audit. Findings here block shipping or verification.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `frontend/src/features/printing/print.css` | 733 | complete |
| `frontend/src/index.css` | 764 | complete |
| `frontend/vite.config.ts` | 28 | complete |

---

## BL-01 — Orphaned CSS block breaks the entire frontend production build

- **Severity:** S1
- **Location:** `frontend/src/features/printing/print.css:14-24`
- **Evidence:**
  ```css
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
  The opening `@page report-landscape {` is missing; the block at lines 1–11 already
  defines it. Lines 15–24 are a duplicated declaration body with a stray closing brace.
  Balance check: `print.css` has 118 `{` and 119 `}`.
- **Root cause:** A duplicated `@page` body was left behind without its at-rule header.
  Tailwind 4's CSS parser (which inlines `@import "./features/printing/print.css"`)
  reports `CssSyntaxError: Missing opening {` and aborts the build.
- **Impact at scale:** `npm run build` fails with exit code 1; no production bundle can
  be produced. This blocks every other frontend fix from reaching users and makes the
  printing pipeline (the audit's reliability target) unshippable.
- **Reproduction:**
  ```powershell
  cd frontend
  npm run build
  # ✗ Build failed ... CssSyntaxError: Missing opening {
  #   C:/.../frontend/src/index.css
  ```
- **Fix:** Delete lines 14–24 (the orphaned body), keeping the comment if desired:
  ```css
  /* Default @page is provided by PrintDocumentLayout (4mm margin) for invoices/vouchers.
     Reports use the named 'report-landscape' page above. */
  ```
- **Verification:** `npm run build` completes; `node -e` brace count in `print.css` is
  118/118; a print preview of a report still uses `@page report-landscape`.
- **Status:** - [ ] Fixed

---

## BL-02 — Backend builds, but there is no CI gate for the frontend build

- **Severity:** S2
- **Location:** repository root (no CI config); `frontend/package.json:6-11`
- **Evidence:** `frontend/package.json` scripts contain `build`, `lint`, `preview`, but
  no workflow file exists in `.github/` (directory absent) and no root script runs both
  builds. `BL-01` reached the working tree undetected.
- **Root cause:** Build verification is manual and local.
- **Impact at scale:** A single malformed CSS rule silently blocks releases; regressions
  in the 49k-line codebase are only found when someone runs the build by hand.
- **Reproduction:** `Get-ChildItem .github -Recurse` → not found; `npm run build` fails.
- **Fix:** Add a CI job that runs `npm ci && npm run build` in `backend/` and
  `frontend/`, plus `tsc --noEmit`, tests, and a bundle-size budget check.
- **Verification:** Open a PR that reintroduces `BL-01`; CI must fail.
- **Status:** - [ ] Fixed
