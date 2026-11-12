# Findings — Backend Platform (auth, attendance, notifications, audit, realtime, common, bootstrap)

> Read-only audit. Every finding below is grounded in the cited source lines.
> Severity: **S1** = data loss / security / correctness at any scale; **S2** = breaks or becomes unusable at target scale; **S3** = degraded performance/maintainability; **S4** = minor / polish.

## Coverage
| File | Lines | Read |
|---|---:|---|
| `backend/src/auth/auth.service.ts` | 249 | complete |
| `backend/src/auth/auth.controller.ts` | 65 | complete |
| `backend/src/auth/auth.module.ts` | 30 | complete |
| `backend/src/auth/jwt.strategy.ts` | 43 | complete |
| `backend/src/auth/jwt-auth.guard.ts` | 5 | complete |
| `backend/src/auth/roles.guard.ts` | 42 | complete |
| `backend/src/auth/roles.decorator.ts` | 5 | complete |
| `backend/src/auth/dto/refresh-token.dto.ts` | 14 | complete |
| `backend/src/auth/dto/login.dto.ts` | 18 | complete |
| `backend/src/auth/dto/change-password.dto.ts` | 16 | complete |
| `backend/src/auth/roles.guard.spec.ts` | 57 | complete |
| `backend/src/auth/auth.service.spec.ts` | 141 | complete |
| `backend/src/attendance/attendance.service.ts` | 579 | complete |
| `backend/src/attendance/attendance.controller.ts` | 107 | complete |
| `backend/src/attendance/attendance.module.ts` | 27 | complete |
| `backend/src/attendance/qr-token.service.ts` | 95 | complete |
| `backend/src/attendance/dto/attendance.dto.ts` | 42 | complete |
| `backend/src/attendance/qr-token.service.spec.ts` | 113 | complete |
| `backend/src/attendance/attendance.service.spec.ts` | 250 | complete |
| `backend/src/notifications/notifications.service.ts` | 323 | complete |
| `backend/src/notifications/notifications.controller.ts` | 60 | complete |
| `backend/src/notifications/notifications.module.ts` | 12 | complete |
| `backend/src/audit/audit.service.ts` | 255 | complete |
| `backend/src/audit/audit.controller.ts` | 47 | complete |
| `backend/src/audit/audit.module.ts` | 12 | complete |
| `backend/src/realtime/realtime.service.ts` | 35 | complete |
| `backend/src/realtime/realtime.controller.ts` | 82 | complete |
| `backend/src/realtime/realtime.module.ts` | 23 | complete |
| `backend/src/realtime/realtime.controller.spec.ts` | 133 | complete |
| `backend/src/common/errors/global-exception.filter.ts` | 158 | complete |
| `backend/src/common/errors/global-exception.filter.spec.ts` | 46 | complete |
| `backend/src/common/errors/error-response.interface.ts` | 5 | complete |
| `backend/src/common/errors/error-messages.ts` | 26 | complete |
| `backend/src/common/errors/error-codes.ts` | 24 | complete |
| `backend/src/common/quantity.util.ts` | 38 | complete |
| `backend/src/common/types/request-with-user.interface.ts` | 8 | complete |
| `backend/src/main.ts` | 150 | complete |
| `backend/src/app.module.ts` | 57 | complete |
| `backend/src/prisma/prisma.service.ts` | 13 | complete |
| `backend/src/prisma/prisma.module.ts` | 9 | complete |

---

## BP-01 — Refresh-token rotation is a read/verify/write race with no token family or reuse detection

- **Severity:** S2
- **Location:** `backend/src/auth/auth.service.ts:108-117`
- **Evidence:**
  ```ts
      const refreshTokenValid = await argon2.verify(employee.refreshToken, refreshToken);
      if (!refreshTokenValid) {
        throw new UnauthorizedException({
          code: AppErrorCode.TOKEN_EXPIRED,
          message: ERROR_MESSAGES[AppErrorCode.TOKEN_EXPIRED],
        });
      }

      const tokens = await this.generateTokens(employee.id, employee.username, employee.role);
      await this.employeesService.updateRefreshToken(employee.id, tokens.refreshToken);
  ```
- **Root cause:** The stored hash is read (`findById`), verified, and then overwritten in a separate `UPDATE` with no compare-and-swap, row lock, token id, or version. Two concurrent refreshes with the same token both pass `argon2.verify`; the second write silently invalidates the token returned by the first. There is no `jti`, token family, `usedAt`, or reuse detection, so a replayed token cannot be distinguished from a legitimate one until rotation overwrites it.
- **Impact at scale:** Multi-tab/multi-device clients refresh on the same schedule. At 100k users, simultaneous refreshes are routine: one tab receives a token that is already dead, producing random forced logouts and 401 storms. A stolen refresh token can be used indefinitely as long as the attacker wins the rotation race, and there is no way to revoke a token family.
- **Reproduction:** Log in, then fire two `POST /api/auth/refresh` requests in parallel with the same `refreshToken`. Both return `200` with different tokens; immediately use both returned refresh tokens — only the last-written one works.
- **Fix:** Persist refresh tokens in a `RefreshToken` table (`id/jti`, `employeeId`, `familyId`, `tokenHash`, `expiresAt`, `usedAt`, `revokedAt`) and rotate atomically: `UPDATE "RefreshToken" SET "usedAt"=now() WHERE "id"=$1 AND "usedAt" IS NULL RETURNING *`; if zero rows, treat as reuse, revoke the whole family, and return 401. Alternatively add `refreshTokenVersion Int @default(0)` to `Employee` and use `updateMany({ where: { id, refreshTokenVersion: seen } })`, rejecting when `count === 0`.
- **Verification:** Integration test with `Promise.all([refresh(t), refresh(t)])` must yield exactly one `200` and one `401`; a second use of an already-rotated token must revoke the family; k6/autocannon multi-tab scenario shows no unexpected 401s.

---

## BP-02 — JWT secrets are not validated at startup; missing values only fail at request time

- **Severity:** S2
- **Location:** `backend/src/auth/auth.module.ts:15-24`
- **Evidence:**
  ```ts
      JwtModule.registerAsync({
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          secret: config.get<string>('JWT_ACCESS_SECRET'),
          signOptions: {
            expiresIn: config.get<string>('JWT_ACCESS_EXPIRATION', '15m'),
          },
        }),
        inject: [ConfigService],
      }),
  ```
- **Root cause:** `ConfigService.get` returns `undefined` for a missing key and there is no `validationSchema` in `ConfigModule.forRoot` (`backend/src/app.module.ts:30`). The same pattern is used for `JWT_REFRESH_SECRET` (`auth.service.ts:72,242`) and `JWT_ACCESS_SECRET` in `jwt.strategy.ts:16` and `realtime.module.ts:14`. Nothing enforces minimum entropy or that access/refresh/QR secrets are distinct.
- **Impact at scale:** A deployment with a missing/empty secret boots successfully and then fails every login/refresh with an opaque 500 (`secretOrPrivateKey must have a value`), taking auth down globally. If operators reuse one secret across access/refresh, a 7-day refresh token is accepted as an access token because the payload shape is identical. Weak/committed secrets are undetectable until abuse.
- **Reproduction:** Start the process with `JWT_ACCESS_SECRET` unset and call `POST /api/auth/login`; the app is healthy at boot but the request returns 500. Set access and refresh secrets to the same value, log in, and use the returned refresh token as `Authorization: Bearer` on `GET /api/auth/me` — it is accepted.
- **Fix:** Add a Joi/Zod validation schema to `ConfigModule.forRoot` requiring `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ATTENDANCE_QR_SECRET` with `min(32)`, and `JWT_ACCESS_SECRET !== JWT_REFRESH_SECRET !== ATTENDANCE_QR_SECRET`. Fail fast during bootstrap. Support key rotation with a `kid` header and a key map.
- **Verification:** Boot test with each secret removed must exit non-zero before `listen`; boot test with equal secrets must fail; unit test the schema. Add a startup log line with secret fingerprints (not values).

---

## BP-03 — Attendance QR signing silently falls back to the access-token secret (and to an empty string)

- **Severity:** S2
- **Location:** `backend/src/attendance/qr-token.service.ts:29-35`
- **Evidence:**
  ```ts
    private get secret(): string {
      return (
        this.configService.get<string>('ATTENDANCE_QR_SECRET') ||
        this.configService.get<string>('JWT_ACCESS_SECRET') ||
        ''
      );
    }
  ```
- **Root cause:** The dedicated QR key is optional; when absent, QR tokens are signed with the API access-token secret, and when both are absent the secret is `''`. `attendance.module.ts:15` repeats the same fallback in the `JwtModule` registration, so the two code paths can diverge.
- **Impact at scale:** A single leaked `JWT_ACCESS_SECRET` (logs, old deployment, CI) now also permits forging `ATTENDANCE_QR` tokens for any workplace/kiosk and any action. Rotating the QR key independently is impossible without rotating all access tokens, and a missing QR secret turns kiosk QR issuance into runtime 500s.
- **Reproduction:** Unset `ATTENDANCE_QR_SECRET`, keep `JWT_ACCESS_SECRET` set, and call `POST /api/attendance/kiosk/qr`. Decode the returned JWT and verify it with only `JWT_ACCESS_SECRET` — it validates. With both unset, the endpoint throws at runtime.
- **Fix:** Remove both fallbacks; require `ATTENDANCE_QR_SECRET` via config validation (BP-02). Add `aud: 'attendance-qr'` and `iss` claims and verify them. Keep the QR key separate from all API keys and document a rotation procedure.
- **Verification:** Unit test that a token signed with `JWT_ACCESS_SECRET` fails `QrTokenService.verify`; startup test without `ATTENDANCE_QR_SECRET` fails fast; `qr-token.service.spec.ts` already exercises the dedicated-secret path — extend it to assert no fallback.

---

## BP-04 — Login is unthrottled and leaks account existence through timing and response codes

- **Severity:** S2
- **Location:** `backend/src/auth/auth.service.ts:28-34`
- **Evidence:**
  ```ts
        const employee = await this.employeesService.findByUsername(username.trim());
        if (!employee) {
          throw new UnauthorizedException({
            code: AppErrorCode.INVALID_CREDENTIALS,
            message: ERROR_MESSAGES[AppErrorCode.INVALID_CREDENTIALS],
          });
        }
  ```
- **Root cause:** An unknown username returns before any `argon2.verify`, while a known username pays the full Argon2 cost (`auth.service.ts:43`). The inactive-account branch (`36-41`) returns a distinct `ACCOUNT_INACTIVE` code. There is no throttler, lockout, captcha, or per-IP/per-username counter anywhere (`main.ts`, `app.module.ts` contain no throttling dependency).
- **Impact at scale:** Usernames can be enumerated by response time and by `ACCOUNT_INACTIVE` vs `INVALID_CREDENTIALS`. Credential stuffing against 100k users is unconstrained, and because every guess for a real user costs an Argon2 hash (~50-100 ms CPU), a modest botnet can saturate the API's CPU and starve legitimate traffic.
- **Reproduction:** Time 200 logins for `admin` vs `definitely-not-a-user`; the unknown user responds in single-digit milliseconds, the real one in tens of milliseconds. Send 10,000 login attempts in a loop — none are rejected with 429.
- **Fix:** Always run one Argon2 verify against a fixed dummy hash when the user is missing, and return the same `INVALID_CREDENTIALS` for unknown/inactive/bad-password (log the real reason server-side). Add `@nestjs/throttler` backed by Redis with a strict login bucket keyed by `IP + username` (e.g., 5/min, exponential backoff), plus alerting on failure spikes.
- **Verification:** Statistical timing test (p95 difference within noise); test that unknown and inactive accounts return identical status/body; load test asserts 429 after N attempts and bounded CPU.

---

## BP-05 — Logout and password change do not revoke access tokens, and password change is not atomic

- **Severity:** S3
- **Location:** `backend/src/auth/auth.service.ts:131-137,164-166`
- **Evidence:**
  ```ts
    async logout(employeeId: number) {
      try {
        await this.employeesService.updateRefreshToken(employeeId, null);
      } catch (error) {
        this.rethrowOrConvertToInternalError(error);
      }
    }
  ```
  ```ts
        const newHash = await argon2.hash(newPassword);
        await this.employeesService.updatePasswordHash(employeeId, newHash);
        await this.employeesService.updateRefreshToken(employeeId, null);
  ```
- **Root cause:** Access tokens are stateless and carry no `jti` or token version, so logout/password change only clears the refresh-token column. The password change performs two independent writes (`updatePasswordHash`, then `updateRefreshToken`) outside a transaction.
- **Impact at scale:** A stolen access token remains valid for up to `JWT_ACCESS_EXPIRATION` (default 15m) after logout, password change, or account deactivation, so incident response cannot cut off an attacker immediately. If the second write fails, the password is changed but existing refresh tokens survive, defeating the expected "change password logs everyone out" guarantee. At 100k users, a single missed revocation is a persistent account takeover window.
- **Reproduction:** Log in, call `POST /api/auth/logout`, then reuse the old access token on `GET /api/auth/me` — it still returns 200. Unit-test `changePassword` with `updateRefreshToken` mocked to throw; `passwordHash` is updated and the refresh token is unchanged.
- **Fix:** Add `tokenVersion Int @default(0)` to `Employee`, include `ver: tokenVersion` in access/refresh JWTs, and compare it in `JwtStrategy.validate`. Increment `tokenVersion` and null `refreshToken` in one `prisma.$transaction` on logout, password change, deactivation, and role change. Optionally maintain a Redis denylist keyed by `jti` until `exp` for immediate revocation.
- **Verification:** E2E: logout then reuse access token → 401; change password then reuse old access/refresh tokens → 401; failure-injection test asserts hash and token version change atomically (both or neither).

---

## BP-06 — Soft-deleted employees keep full API access

- **Severity:** S2
- **Location:** `backend/src/auth/jwt.strategy.ts:22-33`
- **Evidence:**
  ```ts
      const employee = await this.prisma.employee.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true, role: true, username: true, name: true },
      });

      if (!employee) {
        throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' });
      }

      if (!employee.isActive) {
        throw new ForbiddenException({ code: 'ACCOUNT_INACTIVE', message: 'Account is inactive' });
      }
  ```
- **Root cause:** The auth lookup does not select `deletedAt` and never checks it. `refreshTokens` also checks only `isActive` (`auth.service.ts:94`). The realtime controller does check `deletedAt` (`realtime.controller.ts:76`), so the two auth paths disagree.
- **Impact at scale:** If an employee is soft-deleted (`deletedAt` set) without also flipping `isActive=false`, their existing access token keeps working indefinitely and they can keep creating invoices, changing stock, or reading customer data. At 100k users with admin-driven deletes, one missed `isActive` flag is a permanent authorization bypass.
- **Reproduction:** Set `"deletedAt" = now()` and leave `"isActive" = true` for an employee, then call `GET /api/auth/me` with their existing token — 200. The same user is rejected by `/api/realtime/events`.
- **Fix:** Select `deletedAt` and reject when non-null in `JwtStrategy.validate` and in `refreshTokens`. Centralize the "employee is usable" predicate in one service so API, refresh, and SSE paths cannot drift. Prefer a single `status` enum over two independent flags.
- **Verification:** E2E for each auth surface (API, refresh, SSE) with `deletedAt` set and `isActive` true → all 401/403; unit test the shared predicate.

---

## BP-07 — Every authenticated request performs an uncached employee lookup

- **Severity:** S3
- **Location:** `backend/src/auth/jwt.strategy.ts:22-25`
- **Evidence:**
  ```ts
      const employee = await this.prisma.employee.findUnique({
        where: { id: payload.sub },
        select: { id: true, isActive: true, role: true, username: true, name: true },
      });
  ```
- **Root cause:** Role/active-state freshness is implemented by querying PostgreSQL in `validate()` on every request, with no cache and no reuse of the JWT claims.
- **Impact at scale:** Every API call adds one primary-key lookup. At a modest 3-5k RPS this is 3-5k extra queries/sec purely for auth, competing with invoice and audit traffic for the Prisma pool. Under a pool of ~20-50 connections this is a direct contributor to pool wait time and p95 latency. It also means a database hiccup takes down authentication for all endpoints.
- **Reproduction:** Run a read-only endpoint under autocannon and count `SELECT ... FROM "Employee" WHERE "id" = $1` in `pg_stat_statements`; calls equal request count. Compare p95 with a version that trusts token claims.
- **Fix:** Cache `{id, role, isActive, deletedAt, tokenVersion}` in Redis with a short TTL (30-60s) and invalidate on employee update via pub/sub; or accept bounded staleness by embedding `role`/`ver` in the JWT and only revalidating on sensitive mutations. Keep a circuit breaker so auth does not depend on a single DB round-trip.
- **Verification:** Query-count metric per request drops to ~0 on cache hits; load test shows lower p95 and pool wait; invalidation test shows role changes take effect within the TTL.

---

## BP-08 — Attendance check-in has a check-then-insert race; the P2002 handler is unreachable

- **Severity:** S2
- **Location:** `backend/src/attendance/attendance.service.ts:240-274`
- **Evidence:**
  ```ts
        return await this.prisma.$transaction(async (tx) => {
          const open = await tx.attendance.findFirst({
            where: { employeeId, checkOut: null },
          });
          if (open) {
            throw new BadRequestException({
              code: AppErrorCode.ALREADY_CHECKED_IN,
              message: ERROR_MESSAGES[AppErrorCode.ALREADY_CHECKED_IN],
            });
          }

          const todayClosed = await tx.attendance.findFirst({
            where: {
              employeeId,
              date: { gte: dayStart, lte: dayEnd },
              checkOut: { not: null },
            },
          });
          if (todayClosed) {
            throw new BadRequestException({
              code: AppErrorCode.ALREADY_CHECKED_IN,
              message: 'You have already completed attendance for today.',
            });
          }

          return tx.attendance.create({
            data: {
              employeeId,
              workplaceId,
              kioskId,
              status: 'PRESENT',
              checkIn: now,
              date: now,
            },
          });
        });
  ```
- **Root cause:** The transaction runs at PostgreSQL's default READ COMMITTED and does a plain `SELECT` with no `FOR UPDATE`, advisory lock, or unique constraint. Two concurrent requests both see no open row and both insert. The `P2002` catch at `276-287` cannot fire: `prisma/schema.prisma:622-645` defines only non-unique indexes (`@@index([employeeId, date])`), and `date: now` is a full timestamp, so even a hypothetical `(employeeId, date)` unique constraint would not collide between two requests.
- **Impact at scale:** Double-taps, mobile retries, and multi-tab clients create duplicate open attendance rows. Payroll/hours reports (`getEmployeeStats`, `findAll`) then double-count days and hours, and check-out can close an arbitrary one of the duplicates. At 100k employees scanning at shift boundaries, collisions are guaranteed.
- **Reproduction:** Obtain one valid `CHECK_IN` QR, then send two `POST /api/attendance/scan` requests concurrently with the same employee token. Both return 200 and `SELECT count(*) FROM "Attendance" WHERE "employeeId"=$1 AND "checkOut" IS NULL` returns 2.
- **Fix:** Enforce the invariant in the database: `CREATE UNIQUE INDEX "attendance_one_open_per_employee" ON "Attendance"("employeeId") WHERE "checkOut" IS NULL;` (and optionally a generated local-day column with `UNIQUE(employeeId, day)`). Catch `P2002` and return `ALREADY_CHECKED_IN`, or use `INSERT ... ON CONFLICT DO NOTHING RETURNING *` and treat zero rows as already checked in. For multi-row/day rules, take a per-employee advisory lock (`pg_advisory_xact_lock`) at the start of the transaction.
- **Verification:** Concurrency test with `Promise.all` of two scans asserts exactly one 200, one 400, and `count = 1`; migration test verifies the partial unique index exists; repeated 1,000-concurrent-scan test produces no duplicates.

---

## BP-09 — Attendance QR is a bearer token with no location binding; scans can be relayed from anywhere

- **Severity:** S1
- **Location:** `backend/src/attendance/attendance.service.ts:186-198`
- **Evidence:**
  ```ts
    async scan(params: {
      employeeId: number;
      employeeRole: string;
      token: string;
    }) {
      this.assertEmployeeRole(params.employeeRole);
      this.enforceScanRateLimit(params.employeeId);

      const payload = await this.qrTokenService.verify(params.token);

      const workplace = await this.prisma.workplace.findFirst({
        where: { id: payload.wid, deletedAt: null, isActive: true },
      });
  ```
- **Root cause:** `scan` accepts only `employeeId`, `employeeRole`, and `token`; it never receives or validates the client's coordinates, IP, or network. `Workplace` already has `latitude`, `longitude`, and `radiusMeters` (`prisma/schema.prisma:567-569`), but they are unused by the attendance flow. The QR is valid for 20 seconds and is not tied to a device, session, or one-time nonce consumption.
- **Impact at scale:** Anyone who obtains a photo/screenshot/forwarded copy of the kiosk QR (or a kiosk account token) can check in or out remotely within the TTL. This defeats the purpose of on-site attendance and produces fraudulent payroll records that look legitimate. With 100k employees and shared chat groups, QR relay is trivial and undetectable in the current audit trail.
- **Reproduction:** Display a kiosk QR, photograph it, and from a different city/network call `POST /api/attendance/scan` with the photographed token and an employee bearer token within 20s — the check-in succeeds and records the kiosk's workplace.
- **Fix:** Require client coordinates (and accuracy) on `ScanAttendanceDto`, validate they fall inside `workplace.radiusMeters` of `latitude/longitude`, reject stale/low-accuracy fixes, and store the coordinates in the existing `checkInLatitude/Longitude` columns. Additionally bind the QR to a kiosk session and consume the nonce server-side (Redis `SETNX` with TTL), or use rotating short-TTL codes with a device attestation. Log and alert on distance outliers.
- **Verification:** E2E: coordinates 10 km away → 400/403; inside radius → 200; replay of the same nonce → 401; audit row contains the submitted coordinates. Unit tests for radius boundary and missing-coordinate rejection.

---

## BP-10 — Attendance rate limiting is per-process, unbounded, and bypassable

- **Severity:** S2
- **Location:** `backend/src/attendance/attendance.service.ts:26,51-68`
- **Evidence:**
  ```ts
    private readonly scanBuckets = new Map<string, ScanRateBucket>();
  ```
  ```ts
    private enforceScanRateLimit(employeeId: number): void {
      const key = String(employeeId);
      const now = Date.now();
      const bucket = this.scanBuckets.get(key);

      if (!bucket || bucket.resetAt <= now) {
        this.scanBuckets.set(key, { count: 1, resetAt: now + this.scanRateWindowMs });
        return;
      }

      bucket.count += 1;
      if (bucket.count > this.scanRateLimit) {
        throw new BadRequestException({
          code: AppErrorCode.RATE_LIMITED,
          message: ERROR_MESSAGES[AppErrorCode.RATE_LIMITED],
        });
      }
    }
  ```
- **Root cause:** Rate-limit state lives in a JavaScript `Map` inside one Nest process. Entries are never evicted after `resetAt` unless the same employee scans again, there is no maximum size, and there is no shared store. The limit only guards `/attendance/scan`; kiosk QR issuance and auth endpoints are unguarded.
- **Impact at scale:** With multiple instances behind a load balancer, each employee gets the configured limit per instance (N× the intended rate) and a restart resets all counters. The map grows without bound as unique employee IDs scan — at 100k employees this is a persistent heap leak. It also cannot be used for coordinated abuse detection.
- **Reproduction:** Run two app instances and alternate scan requests between them; the employee can exceed `ATTENDANCE_SCAN_RATE_LIMIT` by a factor of two. Inspect heap after simulating 1M distinct employee IDs — the map retains all entries past their reset time.
- **Fix:** Replace with a Redis-backed sliding-window/token-bucket (`INCR` + `EXPIRE`, or a Lua script) keyed by `employeeId` and optionally `IP`, with a TTL equal to the window. Apply the same limiter to login, refresh, and kiosk QR issuance. If Redis is unavailable, fail closed or degrade to a bounded LRU rather than an unbounded map.
- **Verification:** Two-instance integration test enforces the global limit; memory test with 1M keys stays bounded; unit test confirms expired buckets are not retained.

---

## BP-11 — Attendance list accepts unbounded/negative `limit` and `page`

- **Severity:** S2
- **Location:** `backend/src/attendance/attendance.controller.ts:77-83`
- **Evidence:**
  ```ts
      return this.attendanceService.findAll({
        employeeId: employeeId ? Number(employeeId) : undefined,
        startDate,
        endDate,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 25,
      });
  ```
- **Root cause:** Query parameters are converted with `Number()` and passed straight into `skip`/`take` (`attendance.service.ts:411-435`) without DTO validation, an upper bound, or a minimum. `limit=-1` is truthy and reaches Prisma as a negative `take` (which reverses ordering); `limit=1000000` produces a million-row join with `employee`, `workplace`, and `kiosk`; `page=-5` yields a negative `skip`.
- **Impact at scale:** One authenticated admin request can force a huge multi-table join, exhaust memory/connections, and block the event loop while serializing the response. Negative pagination returns incorrect pages. At 5M invoices/attendance rows this is a trivial denial-of-service vector from a legitimate account.
- **Reproduction:** `GET /api/attendance?limit=1000000` — observe latency and memory spike. `GET /api/attendance?limit=-1` — rows come back in ascending date order instead of descending.
- **Fix:** Introduce a validated query DTO: `@Type(() => Number) @IsInt() @Min(1) @Max(100)` for `limit`, `@Min(1)` for `page`, `@IsOptional() @IsInt()` for `employeeId`, and ISO date validation for the range. Clamp defensively in the service as well. Prefer cursor pagination (`id`/`date` + `take`) for large tables.
- **Verification:** E2E with `limit=0`, `limit=-1`, `limit=1000000`, `page=-1`, `limit=abc` → 400; load test shows bounded memory; default page size remains 25.

---

## BP-12 — Check-out is a find-then-update race that silently overwrites the first check-out

- **Severity:** S3
- **Location:** `backend/src/attendance/attendance.service.ts:299-318`
- **Evidence:**
  ```ts
        const open = await tx.attendance.findFirst({
          where: { employeeId, checkOut: null },
          orderBy: { checkIn: 'desc' },
        });

        if (!open) {
          throw new BadRequestException({
            code: AppErrorCode.NOT_CHECKED_IN,
            message: ERROR_MESSAGES[AppErrorCode.NOT_CHECKED_IN],
          });
        }

        return tx.attendance.update({
          where: { id: open.id },
          data: {
            checkOut: now,
            workplaceId: open.workplaceId ?? workplaceId,
            kioskId,
          },
        });
  ```
- **Root cause:** The open row is selected without `FOR UPDATE` and updated by primary key without a `checkOut IS NULL` predicate or version check. Both concurrent requests see the same open row and both updates succeed; the later commit overwrites the earlier `checkOut` time. The `P2002` handler at `320-331` is again unreachable because no unique constraint is involved.
- **Impact at scale:** Double check-out scans (common on flaky mobile networks) record a later time than the employee actually left, inflating hours. Combined with BP-08's duplicate open rows, check-out may close an arbitrary duplicate, leaving others open forever and corrupting daily stats.
- **Reproduction:** With one open attendance row, send two `CHECK_OUT` scans in parallel. Both return 200; the row's `checkOut` equals the second request's timestamp and the first is lost.
- **Fix:** Perform an atomic conditional update: `UPDATE "Attendance" SET "checkOut"=$now ... WHERE "id"=(SELECT "id" FROM "Attendance" WHERE "employeeId"=$1 AND "checkOut" IS NULL ORDER BY "checkIn" DESC LIMIT 1 FOR UPDATE) AND "checkOut" IS NULL RETURNING *`; if zero rows, return `NOT_CHECKED_IN`. Alternatively use `updateMany({ where: { id, checkOut: null } })` and require `count === 1`. Add a partial unique index for open rows (BP-08).
- **Verification:** Concurrency test asserts exactly one 200 and one 400, and the stored `checkOut` matches the successful request; repeated 1,000-concurrent check-outs produce no lost updates.

---

## BP-13 — Day boundaries are computed with a `now` offset (DST-incorrect) and the timezone is queried on every request

- **Severity:** S3
- **Location:** `backend/src/attendance/attendance.service.ts:70-73,103-113`
- **Evidence:**
  ```ts
    private async getTimezone(): Promise<string> {
      const settings = await this.prisma.appSetting.findUnique({ where: { id: 1 } });
      return settings?.timezone || 'Africa/Cairo';
    }
  ```
  ```ts
    private startOfDayInTimezone(now: Date, timeZone: string): Date {
      const offset = this.getTimeZoneOffsetMs(now, timeZone);
      const local = new Date(now.getTime() + offset);
      const dayStartUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
      return new Date(dayStartUtc - offset);
    }

    private endOfDayInTimezone(now: Date, timeZone: string): Date {
      const start = this.startOfDayInTimezone(now, timeZone);
      return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
    }
  ```
- **Root cause:** The UTC offset is sampled at `now` and then applied to midnight of the same local day. On DST transition days the offset at midnight differs from the offset at `now`, so the computed start is off by an hour. `endOfDay` assumes every day is exactly 24 hours, which is false on 23-hour and 25-hour DST days. Separately, `getTimezone()` performs a database round-trip on every scan, check-in, list, and stats call.
- **Impact at scale:** On the two DST transitions per year, employees can be marked as checking in on the wrong day, duplicate-day checks can pass or fail incorrectly, and daily reports are off by an hour. The uncached settings query adds one DB round-trip to every attendance operation; at shift-change peaks this is a hot-row read on `AppSetting` and unnecessary pool pressure.
- **Reproduction:** For `Africa/Cairo`, compute `startOfDayInTimezone` for a timestamp late on the DST transition day and compare it with the true local midnight; the result is shifted by 60 minutes. Count `SELECT ... FROM "AppSetting"` per scan — one per request.
- **Fix:** Compute boundaries in PostgreSQL with `date_trunc('day', $now AT TIME ZONE $tz) AT TIME ZONE $tz` (or use `Temporal`/`date-fns-tz` with an explicit zone-aware conversion), so DST is handled by the tz database. Cache the timezone in memory with invalidation on settings update, or read it once at startup and refresh on change. Store a generated local `day` column on `Attendance` for cheap day-level constraints and reports.
- **Verification:** Unit tests for both DST transition dates in `Africa/Cairo` assert exact UTC boundaries; query-count test shows zero `AppSetting` reads per scan after warm-up; daily totals match a reference SQL query.

---

## BP-14 — Employee attendance stats load every row into Node and silently scan all history when dates are omitted

- **Severity:** S3
- **Location:** `backend/src/attendance/attendance.service.ts:446-469`
- **Evidence:**
  ```ts
    async getEmployeeStats(employeeId: number, startDate: string, endDate: string) {
      const range = await this.resolveDayRange(startDate, endDate);

      const records = await this.prisma.attendance.findMany({
        where: {
          employeeId,
          date: {
            gte: range.start,
            lte: range.end,
          },
        },
        orderBy: { date: 'asc' },
      });

      const totalDays = records.length;
      const daysPresent = records.filter((r) => r.checkOut !== null).length;
      const totalHours = records.reduce((sum, r) => {
  ```
- **Root cause:** The service fetches full rows and computes counts/sums in JavaScript. `resolveDayRange` returns `{}` when both dates are missing (`365-371`), and Prisma treats `gte: undefined`/`lte: undefined` as "no filter", so a request without dates loads the employee's entire attendance history. The controller (`attendance.controller.ts:89-95`) does not require or validate `startDate`/`endDate`, and there is no maximum range.
- **Impact at scale:** A single request for a long-tenured employee can load thousands of rows; omitting dates loads everything. With 100k employees and years of records, this is repeated full-range I/O and heap churn, and it competes with the operational attendance path. Computation in Node also blocks the event loop proportionally to row count.
- **Reproduction:** `GET /api/attendance/stats/1` with no query parameters returns stats over all history. Compare `EXPLAIN ANALYZE` with a 10-year range: the query returns every row instead of aggregates.
- **Fix:** Require `startDate` and `endDate` (validated ISO dates) and cap the range (e.g., 366 days). Aggregate in SQL: `COUNT(*)`, `COUNT("checkOut")`, and `SUM(EXTRACT(EPOCH FROM ("checkOut" - "checkIn")))/3600`, returning one row. Add `@@index([employeeId, date])` is already present, so the aggregate is index-only-ish. For longer reporting, use a materialized daily summary.
- **Verification:** DTO validation rejects missing/inverted/oversized ranges with 400; `EXPLAIN` shows an aggregate, not a row fetch; load test shows constant memory and sub-100 ms p95.

---

## BP-15 — Attendance correction reads outside the transaction, producing stale audit `before` and lost updates

- **Severity:** S3
- **Location:** `backend/src/attendance/attendance.service.ts:487-495,547-554`
- **Evidence:**
  ```ts
      const existing = await this.prisma.attendance.findUnique({
        where: { id: attendanceId },
      });
  ```
  ```ts
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.attendance.update({
          where: { id: attendanceId },
          data: {
            ...(checkIn !== undefined && { checkIn }),
            ...(checkOut !== undefined && { checkOut }),
          },
        });
  ```
- **Root cause:** The row is read before the transaction, validated in memory, and then updated unconditionally inside the transaction. There is no `SELECT ... FOR UPDATE`, `updatedAt` compare-and-swap, or version column. The audit `before` snapshot is taken from the stale pre-transaction read (`504-507`), not from the row actually being replaced.
- **Impact at scale:** Two admins correcting the same record concurrently both succeed; the second overwrites the first, and its audit entry claims a `before` state that was never the immediate predecessor. This breaks the audit trail's evidentiary value (the reason corrections are audited) and can silently discard a legitimate correction. At 100k employees with multiple admins, concurrent corrections are plausible during payroll close.
- **Reproduction:** Send two `PATCH /api/attendance/:id/correct` requests in parallel with different `checkIn` values. Both return 200; inspect `SystemAuditLog` — both entries have the same `before.checkIn`, and only the last `after` survives.
- **Fix:** Move the read into the transaction with `SELECT ... FOR UPDATE` (or `tx.attendance.findUnique` after acquiring a row lock), compute `before` from that locked row, update conditionally on `updatedAt`, and write the audit row in the same transaction. Use `Serializable` isolation or a `version` column with retry on conflict.
- **Verification:** Concurrency test asserts one 200 and one 409 (or serialized retries), and each audit entry's `before` equals the previous entry's `after`; failure injection asserts no update without an audit row.

---

## BP-16 — Notifications list accepts unbounded, zero, negative, and NaN `limit`

- **Severity:** S2
- **Location:** `backend/src/notifications/notifications.controller.ts:32-36`
- **Evidence:**
  ```ts
      const unreadFilter = unreadOnly ?? unread;
      return this.notificationsService.findAll(req.user.sub, {
        unreadOnly: unreadFilter === 'true',
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 25,
      });
  ```
- **Root cause:** `parseInt` is applied without validation or clamping. `limit=1000000` reaches `take` unchanged (`notifications.service.ts:267-272`); `limit=abc` yields `NaN` and a Prisma error/500; `limit=0` yields an empty page and `Math.ceil(total / 0) = Infinity` in the response meta; negative values produce a negative `take` (reversed ordering in Prisma). `page` has the same problem.
- **Impact at scale:** A user with a large notification backlog can force the API to load and serialize the entire backlog in one request, while `count` runs in parallel. With per-invoice fan-out (BP-18) the backlog can be tens of thousands of rows per user, making this a cheap memory/latency DoS and a mobile-data hazard.
- **Reproduction:** `GET /api/notifications?limit=1000000` returns the full backlog; `GET /api/notifications?limit=abc` returns 500; `GET /api/notifications?limit=0` returns `totalPages: null`/`Infinity` in JSON.
- **Fix:** Validate with a DTO (`@Type(() => Number) @IsInt() @Min(1) @Max(100)`, `page @Min(1)`), clamp in the service, and return 400 for invalid input. Use cursor pagination on `(createdAt, id)` for stable paging under concurrent inserts.
- **Verification:** E2E for `limit=0/-1/abc/1000000` and `page=-1` → 400 or clamped; response size bounded; `totalPages` finite.

---

## BP-17 — Notification fan-out performs one sequential upsert per recipient

- **Severity:** S3
- **Location:** `backend/src/notifications/notifications.service.ts:49-55`
- **Evidence:**
  ```ts
      const admins = await this.prisma.employee.findMany({
        where: { role: 'ADMIN', isActive: true, deletedAt: null },
        select: { id: true },
      });

      for (const admin of admins) {
        await this.prisma.notification.upsert({
  ```
- **Root cause:** Each notification path (`createLowStockNotification` 49-80, `notifyInvoicePendingReview` 103-129, `notifyInvoiceConfirmed` 171-199, `notifyStockPendingPricing` 215-241) loads recipients and then awaits an individual `upsert` per recipient in a serial loop. Callers await the whole loop before returning the HTTP response (e.g., `invoices.service.ts:420` and `559`), so recipient count directly adds latency.
- **Impact at scale:** Every invoice creation/confirmation pays `N` sequential database round-trips (N = active admins/accountants). At 5M invoices and dozens of reviewers this is millions of extra statements and seconds of added latency; it also lengthens the window in which a failure leaves the business operation committed but notifications partially written. A slow or locked `Notification` row stalls the invoice response.
- **Reproduction:** Seed 50 admins, create an invoice, and count `INSERT/UPDATE "Notification"` statements and elapsed time; latency scales linearly with admin count. Compare with a single `createMany`.
- **Fix:** Replace the loop with one set-based statement: `INSERT INTO "Notification" (...) VALUES (...), (...) ON CONFLICT ("employeeId","dedupeKey") DO UPDATE SET ...` (or `createMany({ skipDuplicates: true })` followed by one `updateMany` for refresh fields). Better, write a single outbox event inside the business transaction and let a worker fan out asynchronously, so invoice latency is independent of recipient count.
- **Verification:** Query-count test asserts O(1) statements regardless of recipient count; p95 invoice creation is flat as admins scale from 1 to 100; failure-injection test shows no partial fan-out.

---

## BP-18 — One notification row per reviewer per invoice grows without retention

- **Severity:** S2
- **Location:** `backend/src/notifications/notifications.service.ts:103-129`
- **Evidence:**
  ```ts
      const employees = await this.prisma.employee.findMany({
        where: { role: { in: ['ADMIN', 'ACCOUNTANT'] }, isActive: true, deletedAt: null },
        select: { id: true },
      });

      for (const emp of employees) {
        await this.prisma.notification.upsert({
          where: {
            employeeId_dedupeKey: {
              employeeId: emp.id,
              dedupeKey: `INVOICE_PENDING_REVIEW:${invoiceId}`,
            },
          },
  ```
- **Root cause:** `notifyInvoicePendingReview` creates a distinct row for every admin/accountant for every invoice (`dedupeKey` includes `invoiceId`). `notifyInvoiceConfirmed` does the same for admins/inventory. Rows are only marked `resolvedAt`; nothing deletes or archives them, and `findAll` includes resolved rows unless `unreadOnly` is set (`252-285`). There is no partition or retention policy.
- **Impact at scale:** 5M invoices × N reviewers produces tens to hundreds of millions of notification rows. Table and index bloat slows `count`, pagination, and vacuum; storage grows monotonically; per-user backlogs make BP-16 worse. At 100k employees the table becomes one of the largest in the system even though most rows are stale.
- **Reproduction:** Create 1M invoices with 10 reviewers and measure `pg_total_relation_size('Notification')` and `SELECT count(*)` latency; compare with a 90-day retention window.
- **Fix:** Add a retention/archival job (delete or move to cold storage rows that are `isRead = true AND resolvedAt IS NOT NULL AND createdAt < now() - interval '90 days'`). Partition `Notification` by `createdAt` (monthly) and drop old partitions. Prefer a per-role feed or aggregate "N invoices pending" notification instead of one row per invoice per reviewer, and cap fan-out.
- **Verification:** Row count stays bounded after the retention job; `EXPLAIN` shows partition pruning; `count` p95 remains stable with 5M+ invoices.

---

## BP-19 — System audit loads every audit table into memory, merges/sorts in Node, then slices

- **Severity:** S2
- **Location:** `backend/src/audit/audit.service.ts:78-85,245-248`
- **Evidence:**
  ```ts
        queries.push(
          this.prisma.invoiceAuditLog.findMany({
            where: invoiceWhere,
            include: {
              employee: { select: { id: true, name: true, role: true } },
              invoice: { select: { id: true, invoiceNumber: true } },
            },
            orderBy: { timestamp: 'desc' },
          })
        );
  ```
  ```ts
      normalized.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const total = normalized.length;
      const paginated = normalized.slice(skip, skip + limit);
  ```
- **Root cause:** None of the three `findMany` queries (`invoiceAuditLog`, `productUnitAuditLog`, `stockReceipt` with nested `items` and `stockLots`) applies `take`/`skip` or a bounded date window. All matching rows are materialized, normalized into a JS array, sorted in memory, and only then sliced for the requested page. `total` is `normalized.length`, so an exact count requires the full dataset.
- **Impact at scale:** With 5M invoices, `InvoiceAuditLog` and `ProductUnitAuditLog` can hold tens of millions of rows; the stock receipt query joins every unit and lot. A single `GET /api/audit/system?page=1&limit=50` can allocate gigabytes, block the event loop during sort, exhaust the Prisma pool, and OOM the process — taking down the API for all users. This is the highest-risk scalability defect in the audited set.
- **Reproduction:** Seed 1M `InvoiceAuditLog` rows, call `GET /api/audit/system?page=1&limit=50`, and measure RSS/time; the query returns 50 rows but reads 1M+. Repeat with the default no-date filter.
- **Fix:** Push pagination and ordering into PostgreSQL. Preferred: maintain a single normalized `AuditEvent` table written transactionally (or via triggers/outbox) with `(timestamp, id)` and `(employeeId, timestamp)` indexes, then `ORDER BY timestamp DESC, id DESC LIMIT $1 OFFSET $2` plus `COUNT(*)`. If keeping three sources, use a `UNION ALL` subquery over per-source projections with `ORDER BY ... LIMIT/OFFSET`, or fetch only `limit` rows per source and merge (bounded), and compute totals with `COUNT` per source. Add a mandatory date range and cursor pagination.
- **Verification:** `EXPLAIN ANALYZE` shows index scans with `Limit`; RSS stays flat for page 1 and page 10k; p95 under 200 ms with 10M audit rows; load test does not exhaust the pool.

---

## BP-20 — Audit list accepts unbounded/negative `limit` and `page`

- **Severity:** S2
- **Location:** `backend/src/audit/audit.controller.ts:38-45`
- **Evidence:**
  ```ts
      return this.auditService.findAll({
        employeeId: employeeId ? Number(employeeId) : undefined,
        action,
        startDate,
        endDate,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 50,
      });
  ```
- **Root cause:** Query values are converted with `Number()` without validation. The service only enforces a lower bound (`const limit = Math.max(1, rawLimit)` at `audit.service.ts:55`), so `limit=1000000000` is accepted, `page=-1` produces a negative `skip`, and `limit=abc` yields `NaN` (empty slice, `NaN` totals). `action` is not validated against the enums.
- **Impact at scale:** Because BP-19 already loads all rows, an unbounded `limit` is the trigger that turns a bad query into an OOM: the in-memory slice tries to serialize the entire normalized dataset. Even after BP-19 is fixed, an unbounded `limit` can still request millions of rows. Invalid `action` values silently return empty results instead of a 400, masking client bugs.
- **Reproduction:** `GET /api/audit/system?limit=1000000000` attempts to return every audit row; `GET /api/audit/system?limit=abc` returns `total: 0`/`NaN`; `GET /api/audit/system?page=-1` uses a negative offset.
- **Fix:** Use a validated query DTO with `@IsInt() @Min(1) @Max(200)` for `limit`, `@Min(1)` for `page`, `@IsEnum`/allow-list for `action`, and ISO date validation. Clamp in the service and prefer cursor pagination on `(timestamp, id)`.
- **Verification:** E2E invalid values → 400; `limit` above max is rejected or clamped; response size and memory bounded.

---

## BP-21 — Audit date filtering uses UTC day boundaries, ignoring the application timezone

- **Severity:** S3
- **Location:** `backend/src/audit/audit.service.ts:58-64`
- **Evidence:**
  ```ts
      const dateFilter: any = {};
      if (startDate) dateFilter.gte = new Date(startDate);
      if (endDate) {
        const end = new Date(endDate);
        end.setUTCHours(23, 59, 59, 999);
        dateFilter.lte = end;
      }
  ```
- **Root cause:** Date-only strings such as `2026-01-02` are parsed by `new Date()` as UTC midnight, and the end is forced to `23:59:59.999Z`. The application's configured timezone (`AppSetting.timezone`, default `Africa/Cairo`) is not consulted, unlike the attendance module which has timezone-aware helpers.
- **Impact at scale:** For `Africa/Cairo` (UTC+2/+3), a local day starts at 21:00/22:00Z the previous day. Audit events from 21:00-23:59Z are assigned to the wrong day; a query for "today" can miss the first 2-3 hours or include the previous evening. This produces incorrect compliance/security reports and can hide events around incident boundaries.
- **Reproduction:** Insert an audit event at `2026-01-01T22:00:00Z` (= `2026-01-02 00:00` Cairo). Query `startDate=2026-01-02&endDate=2026-01-02`; the event is excluded even though it occurred on the local day.
- **Fix:** Reuse the attendance timezone-aware day-range logic (after fixing BP-13), or compute boundaries in SQL with `AT TIME ZONE`. Require date-only inputs to be interpreted in the configured timezone and document it; accept full ISO timestamps with offsets for precision.
- **Verification:** Unit tests with `TZ=Africa/Cairo` for events at 20:59Z, 21:00Z, 23:59Z assert correct inclusion; integration test compares results with a SQL reference.

---

## BP-22 — Invoice audit log is returned without pagination

- **Severity:** S3
- **Location:** `backend/src/audit/audit.service.ts:39-43`
- **Evidence:**
  ```ts
      return this.prisma.invoiceAuditLog.findMany({
        where: { invoiceId },
        include: { employee: { select: { id: true, name: true, role: true } } },
        orderBy: { timestamp: 'desc' },
      });
  ```
- **Root cause:** The endpoint fetches every `InvoiceAuditLog` row for an invoice with no `take`/`skip`, no cursor, and no field projection limit. Serialized inventory invoices can generate a unit-level audit entry per product unit action.
- **Impact at scale:** An invoice with thousands of serialized units returns thousands of rows and a multi-megabyte JSON payload; mobile clients and the UI parse it all. Repeated polling of this endpoint amplifies database and network load, and a large invoice can exceed response/proxy limits.
- **Reproduction:** Create an invoice with 10,000 unit audit events and call `GET /api/audit/invoices/:id`; measure payload size and response time. There is no way to request a page.
- **Fix:** Add `page`/`limit` (or cursor) with a validated maximum, return `{ data, meta }`, and select only the fields the UI needs. Add an index supporting `(invoiceId, timestamp)` — already present at `schema.prisma:530` — and use `take`/`skip`. Consider a summary endpoint plus on-demand detail.
- **Verification:** Payload size bounded for a 10k-event invoice; pagination returns stable pages; p95 under 200 ms.

---

## BP-23 — Realtime pub/sub is process-local, so events are lost across instances

- **Severity:** S2
- **Location:** `backend/src/realtime/realtime.service.ts:18-34`
- **Evidence:**
  ```ts
    private readonly subscribers = new Set<Subscriber>();
  ```
  ```ts
    publish(event: Omit<RealtimeEvent, 'timestamp'>): void {
      const completeEvent: RealtimeEvent = {
        ...event,
        timestamp: new Date().toISOString(),
      };

      for (const subscriber of this.subscribers) {
        subscriber(completeEvent);
      }
    }
  ```
- **Root cause:** Subscribers are stored in a `Set` inside one Node process. `publish` only iterates local subscribers; there is no Redis/NATS/Postgres `LISTEN/NOTIFY` bridge between instances. Callers such as `invoices.service.ts:425` publish after committing an invoice.
- **Impact at scale:** Behind a load balancer with N instances, a client connected to instance B never receives an event published on instance A. Roughly `(N-1)/N` of clients miss each event, so invoice/stock/notification UIs go stale and users act on outdated data. Horizontal scaling makes it worse, and there is no replay to recover.
- **Reproduction:** Run two instances (different ports), connect an SSE client to instance B, create an invoice through instance A, and observe no event on B. Publish directly on B and the client receives it.
- **Fix:** Publish to a shared bus (Redis Pub/Sub or Streams, NATS, or Postgres `LISTEN/NOTIFY`). Each instance subscribes once and fans out to its local `Set`. Include an instance id and monotonic event id to support dedupe/replay, and use Redis Streams if at-least-once delivery is required.
- **Verification:** Two-instance integration test: client on B receives an event published via A within 100 ms; kill/restart an instance and confirm reconnection/replay behavior.

---

## BP-24 — SSE connections are unbounded, with one timer per client and no backpressure handling

- **Severity:** S2
- **Location:** `backend/src/realtime/realtime.controller.ts:44-54`
- **Evidence:**
  ```ts
        response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      response.write(`event: ready\ndata: ${JSON.stringify({ userId: user.id })}\n\n`);
      const unsubscribe = this.realtimeService.subscribe(write);
      const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 20000);

      request.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
  ```
- **Root cause:** There is no maximum connection count, per-user/IP cap, or admission control. Each connection allocates a subscriber closure and a dedicated 20-second `setInterval`. `response.write()`'s return value (false = backpressure) is ignored, so a slow client accumulates data in the socket/Node buffer. There is no `X-Accel-Buffering: no` header, so reverse proxies may buffer the stream.
- **Impact at scale:** At 100k concurrent clients, one instance holds 100k sockets, 100k timers, and 100k closures; heartbeats alone generate 5k writes/sec. A few slow consumers can grow memory without bound and trigger OOM. Connection storms after a deploy can exhaust file descriptors before the process becomes healthy.
- **Reproduction:** Open 10k SSE connections and measure RSS/handles; attach a client that stops reading and publish large events — heap grows. Send 100k connection attempts and observe no 503/limit.
- **Fix:** Enforce per-instance and per-user connection caps; return 503 when exceeded. Check `response.write()` and drop clients whose buffer exceeds a threshold (`response.writableLength`). Use a single shared heartbeat interval that iterates connections instead of one timer each. Set `X-Accel-Buffering: no`, `retry:`, and a max stream lifetime. Put SSE behind a connection-aware gateway.
- **Verification:** Load test at 100k connections with stable RSS/FD counts; slow-consumer test shows disconnection instead of growth; header check confirms no proxy buffering.

---

## BP-25 — A single throwing subscriber aborts fan-out to all later subscribers

- **Severity:** S3
- **Location:** `backend/src/realtime/realtime.service.ts:31-33`
- **Evidence:**
  ```ts
      for (const subscriber of this.subscribers) {
        subscriber(completeEvent);
      }
  ```
- **Root cause:** `publish` calls each subscriber directly with no `try/catch`. A subscriber whose `response.write` throws (closed socket, destroyed stream) propagates out of `publish`, so the remaining subscribers never receive the event and the caller's request can fail after the business transaction has already committed.
- **Impact at scale:** With many connections, a single stale/broken socket can drop an event for every client that happens to be after it in iteration order. Because `publish` is called after invoice commits (`invoices.service.ts:425,560`), the HTTP response can become a 500 even though the invoice was created, encouraging clients to retry and duplicate work. Failures are invisible because there is no per-subscriber logging.
- **Reproduction:** Register two subscribers, make the first throw, call `publish`; the second is never invoked and the exception escapes. In production, kill a client socket and publish.
- **Fix:** Wrap each call in `try/catch`, remove failing subscribers from the `Set`, and increment a metric/log with the subscriber id. Consider `queueMicrotask`/async dispatch so one subscriber cannot block others, and isolate SSE writes behind a per-connection queue.
- **Verification:** Unit test: first subscriber throws, second still receives; failing subscriber is removed; `publish` never throws to the caller.

---

## BP-26 — SSE authorization is a one-time snapshot; deactivated/demoted users keep receiving events

- **Severity:** S3
- **Location:** `backend/src/realtime/realtime.controller.ts:57-81`
- **Evidence:**
  ```ts
    private async authenticate(request: Request): Promise<{ id: number; role: Role }> {
      const header = request.headers.authorization;
      if (!header?.startsWith('Bearer ')) {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }

      let payload: { sub?: number };
      try {
        payload = await this.jwtService.verifyAsync(header.slice('Bearer '.length), {
          secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        });
      } catch {
        throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Authentication required' });
      }
  ```
- **Root cause:** The access token is verified and the employee's role/isActive/deletedAt are read once, before the stream opens. After that, the connection lives indefinitely and the `user` object is a constant snapshot. There is no check of `exp`, no periodic revalidation, no token version, and no close on role change/deactivation. The `exp` claim is verified at connect but not enforced for the lifetime of the stream.
- **Impact at scale:** A user deactivated, demoted, or soft-deleted while connected continues to receive invoice, stock, and notification events until they disconnect — potentially for days. A stolen token can open a stream that outlives the 15-minute access-token lifetime. This leaks business data and defeats revocation at exactly the moment incident response needs it.
- **Reproduction:** Connect an SSE client, set the employee's `isActive=false` (or change `role`), then publish an event targeted at the old role; the client still receives it. Leave the stream open past `exp` and publish — events still arrive.
- **Fix:** Enforce a maximum stream lifetime equal to the token's `exp` (close and require reconnect), and revalidate the employee (cache + DB) on each heartbeat or every 60s. Close the stream when `isActive`/`deletedAt`/`tokenVersion` changes, using Redis pub/sub for immediate invalidation. Include `exp` in the connection state.
- **Verification:** Integration test: deactivate a connected user and assert the stream closes within one heartbeat; stream older than `exp` is closed; role change stops role-targeted events immediately.

---

## BP-27 — No Helmet, compression, or global rate limiting; no proxy trust

- **Severity:** S2
- **Location:** `backend/src/main.ts:10-14`
- **Evidence:**
  ```ts
  async function bootstrap() {
    const app = await NestFactory.create<NestExpressApplication>(AppModule);

    app.setGlobalPrefix('api');
    app.useGlobalFilters(new GlobalExceptionFilter());
  ```
- **Root cause:** The bootstrap only sets a prefix and an exception filter. There is no `helmet()`, no `compression()`, no `ThrottlerModule`/`ThrottlerGuard`, and no `app.set('trust proxy', ...)`. `backend/package.json` has no `helmet`, `compression`, `@nestjs/throttler`, or `express-rate-limit` dependency, and a repo-wide search finds no throttle usage.
- **Impact at scale:** Responses lack standard security headers (CSP, HSTS, `X-Content-Type-Options`, frame options). Large JSON payloads (audit, notifications, invoices) are sent uncompressed, multiplying bandwidth and mobile latency. Login, refresh, scan, and every other endpoint are open to brute force and scraping. Behind a reverse proxy, `req.ip` is the proxy address, so any future IP-based control or audit is wrong.
- **Reproduction:** `curl -I http://localhost:3001/api/...` shows no `X-Content-Type-Options`/HSTS; `curl -H 'Accept-Encoding: gzip'` shows no `Content-Encoding`; fire 10,000 requests to `/api/auth/login` with no 429.
- **Fix:** `app.use(helmet())`; `app.use(compression())`; register `ThrottlerModule.forRoot` with Redis storage and a global `ThrottlerGuard`, plus stricter per-route limits for auth and scan; `app.set('trust proxy', 1)` (or the actual hop count). Keep the global body-size limit explicit. Add CSP only after verifying Swagger/static assets.
- **Verification:** Header assertions in e2e; `Content-Encoding: gzip/br` for large responses; 429 after the configured threshold across two instances; `req.ip` reflects the client behind the proxy.

---

## BP-28 — No graceful shutdown; deploys drop in-flight requests and SSE streams

- **Severity:** S3
- **Location:** `backend/src/main.ts:138-140`
- **Evidence:**
  ```ts
    const port = Number(process.env.PORT) || 3001;

    await app.listen(port, '0.0.0.0');
  ```
- **Root cause:** `app.enableShutdownHooks()` is never called. `PrismaService.onModuleDestroy` (`prisma.service.ts:10-12`) only runs if Nest receives a shutdown signal, which does not happen by default for `SIGTERM`/`SIGINT`. Open SSE responses and their `setInterval` timers are never explicitly closed.
- **Impact at scale:** During rolling deploys or autoscaling, the process exits immediately on `SIGTERM`: in-flight invoice writes may be cut off, SSE clients see abrupt disconnects, and PostgreSQL connections linger until the server times out. Repeated deploys can exhaust the database connection limit and produce 502s. At 100k users, deploy-time churn is frequent.
- **Reproduction:** Start the app, begin a slow request, send `SIGTERM`; the request is terminated and no shutdown log appears. Check `pg_stat_activity` for lingering connections.
- **Fix:** Call `app.enableShutdownHooks()`, track and close SSE connections on shutdown, stop accepting new connections, drain in-flight requests with a timeout, then `$disconnect` Prisma. Add a Kubernetes `preStop` sleep and `terminationGracePeriodSeconds` greater than the drain timeout.
- **Verification:** SIGTERM test with an in-flight request completes it and exits cleanly; SSE clients receive a close event; `pg_stat_activity` has no lingering app connections after shutdown.

---

## BP-29 — Prisma client uses defaults: no pool sizing, timeouts, or slow-query visibility

- **Severity:** S3
- **Location:** `backend/src/prisma/prisma.service.ts:5-12`
- **Evidence:**
  ```ts
  export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    async onModuleInit() {
      await this.$connect();
    }

    async onModuleDestroy() {
      await this.$disconnect();
    }
  }
  ```
- **Root cause:** The client is constructed with no options: no `log`, no slow-query extension, no `transactionOptions` (`maxWait`/`timeout`), and no explicit connection-limit/pool-timeout configuration (only whatever is embedded in `DATABASE_URL`). Interactive transactions (attendance, corrections, invoice flows) therefore use Prisma defaults (5s max wait, 5s timeout) with no observability.
- **Impact at scale:** Under 5M invoices and high concurrency, pool exhaustion manifests as opaque `P2024` timeouts with no metric showing which query or transaction is slow. Long interactive transactions can hold connections and block the pool. Without query logging/metrics, capacity planning and incident diagnosis are guesswork.
- **Reproduction:** Run a load test with more concurrent requests than the pool size; observe `P2024` errors and no slow-query logs. Check `pg_stat_activity` for idle-in-transaction connections.
- **Fix:** Configure `datasources.db.url` with `connection_limit`/`pool_timeout` sized to the database and instance count (or use PgBouncer), set `transactionOptions: { maxWait, timeout }`, enable `log: ['warn', 'error']` plus a `$extends` query hook that records duration and logs queries over a threshold, and export pool metrics. Keep interactive transactions short.
- **Verification:** Load test shows no `P2024` at expected concurrency; slow-query logs identify statements over the threshold; pool metrics correlate with p95 latency; `pg_stat_activity` shows no long idle-in-transaction sessions.

---

## BP-30 — Every 4xx is logged at `warn`, enabling log-flood amplification

- **Severity:** S3
- **Location:** `backend/src/common/errors/global-exception.filter.ts:47-52`
- **Evidence:**
  ```ts
      } else {
        this.logger.warn(
          `${request.method} ${request.url} -> ${resolved.status} ${resolved.code}: ${safeResponse.message}`,
          GlobalExceptionFilter.name,
        );
      }
  ```
- **Root cause:** All non-5xx exceptions — including every failed login, invalid QR scan, and validation error — are logged at `warn` with the method, URL, status, code, and message, with no sampling, deduplication, or rate limit. There is no request id, so logs cannot be correlated across services.
- **Impact at scale:** Combined with the missing global rate limiting (BP-27), an attacker can generate millions of 401/400 responses and matching log lines, filling disk, increasing I/O, and drowning real alerts. Legitimate high-volume 4xx (expired tokens, validation) also creates noise that makes incident detection harder.
- **Reproduction:** Send 100k requests with an invalid token and count log lines/disk growth; each produces one `warn` entry. Compare with logging 4xx at `debug` or sampling 1%.
- **Fix:** Log 4xx at `debug` (or sample/aggregate) and reserve `warn`/`error` for 5xx and security-relevant events. Add a request id/correlation id (middleware + AsyncLocalStorage) and structured JSON logs. Emit counters for 4xx by route/status and alert on rates rather than individual lines.
- **Verification:** Log volume for 100k invalid requests is bounded/sampled; every 5xx log contains a request id; dashboards show 4xx rates by route.

---

## BP-31 — Prisma `P2002` responses leak column names to clients

- **Severity:** S4
- **Location:** `backend/src/common/errors/global-exception.filter.ts:129-140`
- **Evidence:**
  ```ts
        case 'P2002': {
          const target = exception.meta?.target;
          const targetLabel = Array.isArray(target)
            ? ` (${target.map(String).join(', ')})`
            : typeof target === 'string'
              ? ` (${target})`
              : '';
          return {
            status: HttpStatus.CONFLICT,
            code: AppErrorCode.CONFLICT,
            message: `A record with this value already exists${targetLabel}.`,
          };
        }
  ```
- **Root cause:** The unique-constraint target (`meta.target`) is interpolated into the client-facing message. This exposes internal table/column names and helps an attacker map the schema and probe which fields are unique.
- **Impact at scale:** Minor information disclosure that assists enumeration and targeted injection attempts; it also makes API messages unstable when indexes change. Not exploitable alone, but unnecessary attack surface.
- **Reproduction:** Trigger a duplicate username/employee create and inspect the 409 body; it includes `(username)` or similar column names.
- **Fix:** Return a generic conflict message (`ERROR_MESSAGES[AppErrorCode.CONFLICT]`) and log `meta.target` server-side only. If the UI needs field-level errors, map known constraint names to safe field labels in a server-side allow-list.
- **Verification:** 409 responses contain no column/table names for every unique constraint; server logs still record the target for debugging.
