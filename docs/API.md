# API reference — v1

Base URL: `/api/v1`. Every response uses one envelope:

```json
{ "success": true, "data": { } }
{ "success": false, "error": { "code": "BAD_REQUEST", "message": "Validation failed", "details": {} } }
```

Access tokens are short-lived JWTs sent as `Authorization: Bearer <token>`.
Refresh tokens are opaque, rotated on every use, stored hashed, and delivered in an
httpOnly `refresh_token` cookie scoped to `/api/v1/auth`.

## Auth — implemented

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/register` | — | Creates a STUDENT in `PENDING_VERIFICATION`. Rate limited. |
| POST | `/auth/verify-email` | — | Consumes a one-time token, activates the account. |
| POST | `/auth/login` | — | Returns access + refresh tokens. Identical error for unknown email and wrong password. |
| POST | `/auth/refresh` | cookie/body | Rotates the session; the old token is revoked. |
| POST | `/auth/logout` | optional | Revokes the presented session, or all sessions when authenticated. |
| POST | `/auth/forgot-password` | — | Always returns `{ sent: true }`. |
| POST | `/auth/reset-password` | — | Consumes the token and revokes every session. |
| GET | `/auth/me` | any | Profile + role. |
| PATCH | `/auth/me` | any | Updates profile fields; changing mobile clears its verified flag. |
| POST | `/auth/change-password` | any | Requires the current password; revokes sessions. |

## Exam engine — implemented

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/student/exams/:examId/start` | STUDENT | Starts or resumes. Checks window, publication, enrolment, attempt limit. |
| GET | `/student/attempts/:id` | STUDENT | Resumable state: paper, saved answers, `remainingSeconds` from the server clock. |
| POST | `/student/attempts/:id/answer` | STUDENT | Autosave. Body: `selectedOptionIds`, `numericAnswer`, `markedForReview`, `clear`, `timeSpentSeconds`. |
| POST | `/student/attempts/:id/heartbeat` | STUDENT | Clock sync; auto-submits if the deadline has passed. |
| POST | `/student/attempts/:id/submit` | STUDENT | Final submit; result is computed server-side. |

Answers are rejected after `expiresAt + SUBMIT_GRACE_SECONDS`, and the attempt is
auto-submitted at that point. A cron sweeper finalises abandoned attempts every minute.

## Planned in later phases

```
GET    /student/dashboard          GET  /admin/dashboard
GET    /student/exams              CRUD /admin/students
GET    /student/exams/:id          CRUD /admin/exams
GET    /student/results            CRUD /admin/questions
GET    /student/results/:id        POST /admin/questions/import      (xlsx | csv | json)
GET    /student/performance        GET  /admin/results  ?examId&studentId&from&to
GET    /student/notifications      POST /admin/results/:examId/publish
                                   POST /admin/results/:examId/recalculate
                                   GET  /admin/rankings/:examId
                                   POST /admin/notifications
                                   GET  /admin/reports/*
                                   POST /payments/orders  /payments/webhook
```
