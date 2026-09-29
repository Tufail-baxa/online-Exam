# Online Examination Portal

A JEE/NEET-style examination platform: admin question bank and exam authoring on one
side, a timed, resumable, server-scored exam engine on the other.

**Status — Phase 1 of 4 is in this repo:** database schema, application architecture,
authentication, and the complete exam-attempt engine (start/resume, autosave,
server-side timer, auto-submit, scoring, ranking). The remaining phases are listed at
the bottom.

## Stack

| Layer | Choice | Why |
|---|---|---|
| API | Node 20 + Express + TypeScript | Small surface, easy to reason about under exam load |
| DB | PostgreSQL + Prisma | Relational integrity matters for marks and rankings |
| Auth | bcrypt + JWT access + rotating opaque refresh | Short-lived access, revocable sessions |
| Validation | Zod | One schema per endpoint, typed end-to-end |
| Jobs | node-cron (swap for BullMQ + Redis at scale) | Auto-submit sweeper |
| Frontend (Phase 2) | Next.js + TypeScript + Tailwind + Recharts | |

## Architecture

```
src/
  config/env.ts          validated environment — the process refuses to boot if it is wrong
  lib/                   prisma client, logger, error factories, token helpers, response envelope
  middleware/            authenticate, requireRole, validate, rate limits, error handler
  modules/
    auth/                schemas → service → controller → routes  (one module, four files)
    attempts/            the exam engine
    scoring/             marking rules + leaderboard, pure and independently testable
    exams/ questions/    Phase 2/3
  jobs/expireAttempts.ts sweeper that auto-submits abandoned attempts
  routes.ts  app.ts  server.ts
prisma/schema.prisma     24 models
prisma/seed.ts           admin, 3 students, 3 subjects, 4 question types, one published mock exam
```

Each module owns its schemas, business logic, HTTP layer and routes. Adding a question
type, a subject or an exam format touches a module, not the architecture.

## The parts that are easy to get wrong

**The timer is server-authoritative.** `exam_attempts.expiresAt` is written when the
attempt is created — `min(now + duration, exam.endAt)`. The browser only *displays* a
countdown it gets from `remainingSeconds`; every answer and heartbeat is re-checked
against the stored deadline. Changing the system clock, editing JavaScript, or replaying
a request past the deadline all fail the same way.

**Refresh never costs a student their paper.** Question order is frozen into
`questionOrder` at start, every answer is upserted server-side, and `GET /attempts/:id`
rebuilds the exact screen — answers, statuses, marked-for-review flags, time remaining.
Starting an exam that is already in progress resumes it instead of creating a second one.

**Nothing scoreable ever reaches the client.** The paper query omits `isCorrect` and
`explanation`; marking happens in `scoring.service.ts` at submission time only.

**Abandonment is handled.** If a student closes the tab, the cron sweeper finalises the
attempt within a minute of expiry, so results and rankings stay complete.

**Marking is configurable per section and per question.** `ExamQuestion.marks` overrides
`ExamSection.marksPerCorrect`; multiple-correct questions support JEE-style partial
marking; numerical questions use a tolerance band.

## Setup

```bash
cp .env.example .env          # then set DATABASE_URL and the two JWT secrets
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                   # http://localhost:4000/api/v1/health
```

Generate secrets with `openssl rand -hex 48`.

The runnable demo login credentials are configurable in `app/.env`; passwords are not displayed on the login page.

### Try the engine

```bash
TOKEN=$(curl -s localhost:4000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"aarav@example.test","password":"Student@123"}' | jq -r .data.accessToken)

EXAM=$(curl -s localhost:4000/api/v1/auth/me -H "authorization: Bearer $TOKEN" >/dev/null; \
  psql "$DATABASE_URL" -tAc "select id from exams limit 1")

curl -s -X POST localhost:4000/api/v1/student/exams/$EXAM/start -H "authorization: Bearer $TOKEN" | jq
```

## Security checklist

Role-based access control · bcrypt hashing · rotating refresh sessions stored as
hashes · per-route Zod validation · Helmet · CORS allowlist · tiered rate limits
(10/15min on credentials, 240/min on autosave) · parameterised queries via Prisma ·
generic auth errors · session revocation on any password change · audit-log table ·
server-side timer, scoring and attempt-state validation.

Still to wire: CSRF tokens for the cookie flow, S3 pre-signed upload policy with
MIME/size checks, and real email/SMS delivery — verification tokens are currently
returned in the API response for local development. **Remove that before deploying.**

## Deployment

1. `npm run build`, run `npx prisma migrate deploy` on release.
2. Run the API behind a TLS-terminating proxy; `trust proxy` is already set.
3. Run at least one instance with the cron sweeper enabled (or move it to a worker
   dyno — `sweepExpiredAttempts()` is exported and safe to call from anywhere).
4. Set `NODE_ENV=production` so cookies get the `Secure` flag and stack traces stop
   leaking.
5. Point `DATABASE_URL` at a pooled connection (PgBouncer/Neon) — exam starts are bursty.

## Roadmap

- **Phase 2 — Admin API:** exam CRUD + scheduling, question bank with bulk import
  (xlsx/csv/json + sample template), student management, result publish/recalculate,
  notifications, analytics endpoints.
- **Phase 3 — Student + Admin UI:** Next.js app, the JEE-style exam screen (question
  palette, section tabs, status colours, review flags, submit confirmation), dashboards,
  result and performance analytics with Recharts.
- **Phase 4 — Extras:** Razorpay/Stripe adapter behind the existing `Payment` model,
  Redis caching for leaderboards, S3 uploads, proctoring hooks.

## Complete Assessment Platform additions

The runnable `app/` now includes:

- MCQ / multiple-correct / true-false / numerical question bank
- Coding problems with C, C++, Java, Python and JavaScript language selection
- Public + hidden coding test cases
- Isolated Docker-based coding execution (network disabled, CPU/memory/PID limits)
- Coding submission history and test-case evaluation
- Server-authoritative exam timer and auto-submit
- Camera + microphone permission checks and in-exam preview
- Fullscreen-exit, camera interruption, microphone interruption, tab switch, copy/cut/paste and context-menu violation logging
- Configurable violation limit and immediate termination for serious violations
- Admin live monitor and violation history
- Admin leaderboard and result statistics
- Auto-save and per-candidate question/option randomization

### Coding runner requirement

Coding execution intentionally does **not** execute untrusted code directly in Node.js. Install Docker Desktop and keep Docker running before using coding submissions. The runner uses an isolated container with no network access, limited memory/CPU/processes and a timeout.

### Camera/microphone requirement

Camera and microphone permissions require HTTPS in normal production deployments. `localhost` is treated as a secure context by modern browsers for local development.

### Demo credentials

- Admin: `admin / admin123`
- Student: `aarav / aarav123`
- Student: `isha / isha123`

## Branding & Exam Layout

The demo app includes an Admin → **Branding** section. Admins can upload a small logo or provide a logo URL, set reusable header/footer text and watermark text, and choose the question-page width/layout. The branding is rendered on every question during an active exam.
