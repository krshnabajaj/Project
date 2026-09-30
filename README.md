# Machine Order Tracker

Order management and machine-assembly tracking for a company that receives Purchase Orders by email:

**Gmail → Purchase Order → Draft order → Admin review → `ORD-YYYY-NNNN` → Engineer assignment → Engineer accepts → Daily stage updates (WhatsApp to admin) → Machine completed + up to 8 photos → Completion email to admin → Packed → Ready for dispatch → Dispatched → Closed**

One source of truth per machine order: where it came from, the PO, the customer, the machine, who is responsible, the current stage, today's update, open issues, expected completion, photos, packing, and dispatch, plus a full audit history that cannot be edited.

---

## Contents

1. [Features](#features)
2. [Technology stack](#technology-stack)
3. [Installation & running locally](#installation--running-locally)
4. [Environment variables](#environment-variables)
5. [Database setup](#database-setup)
6. [Gmail setup (OAuth 2.0)](#gmail-setup-oauth-20)
7. [WhatsApp setup](#whatsapp-setup)
8. [Email setup](#email-setup)
9. [Storage setup](#storage-setup)
10. [Background jobs](#background-jobs)
11. [Running tests](#running-tests)
12. [Deployment](#deployment)
13. [Admin & engineer setup](#admin--engineer-setup)
14. [Testing the complete workflow](#testing-the-complete-workflow)
15. [Troubleshooting](#troubleshooting)

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the system design.

---

## Features

| Area | What you get |
|---|---|
| **PO intake** | Gmail API (OAuth 2.0) polling + optional Pub/Sub push; configurable rules (subject keywords, senders, label, attachment types); PDF / Excel / Word / email-body extraction with a confidence level per field; missing or uncertain fields are flagged for review and never guessed |
| **Duplicate protection** | Gmail message ID (never processed twice), attachment SHA-256, normalized PO number + customer/sender, sender + PO date. The admin chooses **Merge / Ignore / Create anyway** |
| **Orders** | Controlled lifecycle (15 statuses, role-gated transitions), atomic `ORD-YYYY-NNNN` numbering, manual order creation, edit with field-level audit diff, hold/resume/cancel, internal notes, documents |
| **Assembly tracking** | Admin-configurable stages (add, rename, reorder, deactivate); visual stage tracker; append-only daily updates (stage, %, work done, issues, material, next step, estimate, photos) |
| **Engineers** | Separate logins; engineers see **only** their orders; mobile-first update and completion flows with camera capture and client-side compression |
| **Photos** | JPG/PNG only, content-validated, EXIF-rotated, metadata (GPS) stripped, re-compressed, **max 8 per order** (enforced under a DB lock), delete/replace until submitted, download one or all (ZIP) |
| **Notifications** | WhatsApp (Meta Cloud API or Twilio) for accept, updates, issues, completion, overdue, PO received, and assignment (to the engineer); per-type on/off; in-app notification centre with read/unread; outbox with status, error and **Retry**; automatic retry with backoff |
| **Completion email** | HTML summary (order, customer, PO, engineer, dates, stages, remarks, recent updates) with photos inline and attached, plus a link to the order; resend button |
| **Dispatch** | Packed (by, when, packages, dimensions, weight, remarks) → Ready for dispatch → Dispatched (date, courier/transporter, AWB/LR, vehicle, remarks) → Closed |
| **Dashboards** | Admin: KPIs, production pipeline, engineer workload, recent activity, filterable/sortable order table. Kanban production board. Engineer: “My Orders” with a large **UPDATE PROGRESS** button |
| **Reports** | Orders by status / customer / month, engineer performance (assigned, completed, average completion days, overdue), production counts; CSV and Excel export |
| **Audit & logs** | Audit trail (user, role, action, order, old/new values, IP, device) that is **append-only at the database level**; System Logs page for integration and job events |
| **Security** | bcrypt passwords, JWT sessions re-validated against the DB on every request, role checks in every service, row-level scoping for engineers, CSRF checks (Server Actions and same-origin checks on route handlers), rate limiting, zod validation, encrypted OAuth tokens, private storage with short-lived signed URLs, security headers |

## Technology stack

- **Next.js 16** (App Router, Server Components, Server Actions) + **TypeScript** + **React 19**
- **Tailwind CSS v4** with shadcn-style components (`src/components/ui`)
- **PostgreSQL** + **Prisma 6**
- **NextAuth (Auth.js) v4** with credentials and JWT sessions
- **Gmail API** (`@googleapis/gmail`, `google-auth-library`)
- **WhatsApp:** Meta WhatsApp Business Cloud API or Twilio (swappable provider interface)
- **Email:** SMTP (nodemailer) or the Gmail API
- **Storage:** any S3-compatible service (AWS S3, Cloudflare R2, Supabase Storage, MinIO); local disk for development
- `sharp` (images), `unpdf` / `mammoth` / `exceljs` (PO parsing), Vitest (tests)

## Installation & running locally

Requirements: Node.js 20+ (22 recommended) and PostgreSQL 14+.

```bash
npm install
cp .env.example .env            # then edit values (see below)
# generate secrets:
#   NEXTAUTH_SECRET / ENCRYPTION_KEY:  openssl rand -base64 32
#   CRON_SECRET:                      openssl rand -hex 24

npm run db:migrate              # apply migrations
npm run db:seed                 # optional: DEMO data (see "Demo data" below)

npm run dev                     # http://localhost:3000
npm run worker                  # in a second terminal: Gmail polling, retries, overdue alerts
npm run mail:dev                # optional: local SMTP catcher on :2525 (saves .eml files to ./storage/dev-mail)
```

### Demo data

`npm run db:seed` creates **clearly labelled demo data** (`is_demo = true`, `@demo.local` emails): 1 admin, 4 engineers (Rahul, Priya, Amit, Sanjay), 5 customers and 14 orders covering every stage (a PO awaiting review, a suspected duplicate, overdue orders, an order with an issue, completed orders with photos, packed, ready, and dispatched).

| Role | Email | Password |
|---|---|---|
| Admin | `admin@demo.local` | `DemoAdmin2026` |
| Engineer | `rahul@demo.local` / `priya@demo.local` / `amit@demo.local` / `sanjay@demo.local` | `DemoEngineer2026` |

The seed refuses to run in production and skips if users already exist.

## Environment variables

All credentials live in server-side environment variables. None are ever sent to the browser. See `.env.example` for the full annotated list.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `NEXTAUTH_SECRET` | ✅ | Session signing secret |
| `NEXTAUTH_URL`, `APP_URL` | ✅ | Public base URL (links in emails, OAuth redirects) |
| `ENCRYPTION_KEY` | ✅ for Gmail | 32-byte base64 key; encrypts Gmail tokens at rest (AES-256-GCM) |
| `CRON_SECRET` | for cron endpoints | Bearer token for `/api/cron/*` |
| `APP_TIMEZONE`, `NEXT_PUBLIC_APP_TIMEZONE` | | Business timezone for "today" and overdue checks (default `Asia/Kolkata`) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | ✅ for Gmail | OAuth client |
| `GMAIL_USER` | | Expected mailbox; connecting a different account is rejected |
| `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_AUDIENCE`, `GMAIL_PUBSUB_SERVICE_ACCOUNT` | | Optional push notifications |
| `GMAIL_POLL_INTERVAL_MINUTES` | | Worker polling interval (default 5) |
| `WHATSAPP_PROVIDER` | | `meta`, `twilio` or `disabled` |
| `WHATSAPP_API_URL`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | for WhatsApp | Meta: Graph URL, token, phone-number ID. Twilio: API URL, auth token, Account SID |
| `WHATSAPP_FROM_NUMBER` | Twilio | WhatsApp-enabled sender |
| `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG` | Meta, recommended | Approved template with one `{{1}}` body parameter |
| `ADMIN_WHATSAPP_NUMBER` | | Default admin number (can also be set in Settings) |
| `EMAIL_PROVIDER` | | `smtp`, `gmail` or `disabled` |
| `EMAIL_FROM`, `ADMIN_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` | for email | Outgoing email |
| `STORAGE_PROVIDER` | | `s3` or `local` |
| `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_REGION`, `STORAGE_ENDPOINT`, `STORAGE_FORCE_PATH_STYLE` | for S3 | Object storage |
| `STORAGE_LOCAL_DIR`, `ALLOW_LOCAL_STORAGE_IN_PRODUCTION` | | Local storage (development; the production start refuses it unless explicitly allowed) |
| `MAX_UPLOAD_MB` | | Max size per uploaded photo or document (default 10) |

## Database setup

```bash
createdb oms                     # or use a managed Postgres (Neon, Supabase, RDS, Cloud SQL)
npm run db:migrate               # prisma migrate deploy
```

Migrations also install database-level safeguards:

- `daily_updates` and `audit_logs` are **append-only**: triggers reject `UPDATE` and `DELETE`.
- CHECK constraints keep progress within 0–100.
- Expression indexes support fast case-insensitive search.

## Gmail setup (OAuth 2.0)

1. In **Google Cloud Console**, create or select a project and enable the **Gmail API**.
2. **OAuth consent screen:** choose Internal (Google Workspace) or External. Add these scopes:
   `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.send`.
   For an External app in *Testing* mode, add the PO mailbox as a test user.
3. **Credentials → Create OAuth client ID → Web application.** Add the authorized redirect URI
   `https://YOUR_DOMAIN/api/integrations/gmail/callback` (and `http://localhost:3000/api/integrations/gmail/callback` for development).
4. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `ENCRYPTION_KEY` and, optionally, `GMAIL_USER`.
5. Sign in as the admin → **Settings → Gmail → Connect Gmail**, and sign in with the PO mailbox.
6. Adjust the **PO detection rules** (subject keywords, sender allow-list, label, attachment types). The resulting Gmail search query is shown on the page.
7. Keep `npm run worker` running, or schedule `/api/cron/gmail-poll` (see [Background jobs](#background-jobs)).

**Optional: push notifications (faster than polling)**

1. Create a Pub/Sub topic, e.g. `projects/P/topics/gmail-po`, and grant `gmail-api-push@system.gserviceaccount.com` the *Publisher* role on it.
2. Create a **push** subscription to `https://YOUR_DOMAIN/api/integrations/gmail/pubsub` with **authentication enabled** (service account `S`, audience `A`).
3. Set `GMAIL_PUBSUB_TOPIC`, `GMAIL_PUBSUB_AUDIENCE=A` and `GMAIL_PUBSUB_SERVICE_ACCOUNT=S`. The worker registers and renews the watch automatically (watches expire after 7 days). Polling stays on as the fallback.

If the refresh token is revoked or expires, the app shows **“Gmail connection lost. Please reconnect.”** on every admin page and in the notification centre.

## WhatsApp setup

Choose one provider. Messages are recorded in the outbox either way. If WhatsApp isn't configured, they are marked **SKIPPED** with the reason (visible, and retryable once you configure it).

**Meta WhatsApp Business Cloud API (recommended)**

1. In Meta for Developers, create an app → add **WhatsApp** → register the business phone number.
2. Create a **System User** with a permanent token that has `whatsapp_business_messaging` permission.
3. Create and get approval for a **Utility template** with a single body variable, e.g. name `order_update`, body `{{1}}`.
   Business-initiated messages outside the 24-hour customer-service window must use a template.
4. Set:
   ```
   WHATSAPP_PROVIDER=meta
   WHATSAPP_API_URL=https://graph.facebook.com/v21.0
   WHATSAPP_ACCESS_TOKEN=<system user token>
   WHATSAPP_PHONE_NUMBER_ID=<phone number ID>
   WHATSAPP_TEMPLATE_NAME=order_update
   WHATSAPP_TEMPLATE_LANG=en
   ```

**Twilio**

```
WHATSAPP_PROVIDER=twilio
WHATSAPP_API_URL=https://api.twilio.com/2010-04-01
WHATSAPP_PHONE_NUMBER_ID=<Account SID>
WHATSAPP_ACCESS_TOKEN=<Auth Token>
WHATSAPP_FROM_NUMBER=+14155238886
```

Then open **Settings → WhatsApp**, set the admin number (E.164, e.g. `+919876543210`), choose which events notify, and click **Send test WhatsApp**. Engineers receive assignment messages on the phone number in their profile.

## Email setup

- **SMTP** (Google Workspace SMTP relay, SES, SendGrid, Mailgun, etc.): `EMAIL_PROVIDER=smtp` plus `SMTP_*` and `EMAIL_FROM`.
- **Gmail API:** `EMAIL_PROVIDER=gmail` sends through the connected PO mailbox (uses the `gmail.send` scope).

In **Settings → Email**, set the admin email, the completion recipients, and CC. Use **Send test email** to verify. Photos over 15 MB in total are linked instead of attached, to stay under mail size limits.

## Storage setup

All objects are private. Users download through `/api/files/*`, which checks permissions first and then redirects to a 5-minute signed URL.

| Service | Settings |
|---|---|
| AWS S3 | `STORAGE_PROVIDER=s3`, `STORAGE_BUCKET`, `STORAGE_REGION=ap-south-1`, access keys |
| Cloudflare R2 | `STORAGE_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `STORAGE_REGION=auto`, R2 API token keys |
| Supabase Storage | `STORAGE_ENDPOINT=https://<ref>.supabase.co/storage/v1/s3`, `STORAGE_FORCE_PATH_STYLE=true`, S3 access keys from project settings |
| MinIO | `STORAGE_ENDPOINT=http://minio:9000`, `STORAGE_FORCE_PATH_STYLE=true` |

Block public access on the bucket. The app needs `s3:PutObject`, `s3:GetObject` and `s3:DeleteObject`.

## Background jobs

Jobs never depend on someone having the app open:

| Job | What it does | Worker interval |
|---|---|---|
| `gmail-poll` | Import new PO emails (idempotent) | `GMAIL_POLL_INTERVAL_MINUTES` |
| `notification-retry` | Retry failed or interrupted WhatsApp/email deliveries with backoff (up to 5 attempts) | 2 min |
| `overdue-check` | Alert the admin about overdue orders (first day, then every 3 days) | hourly |
| `gmail-watch` | Renew Gmail push watch when Pub/Sub is configured | 12 h |

Run them in one of two ways:

- **Long-running worker (VM / container / Docker):** `npm run worker`. Jobs use database leases, so extra workers never double-process.
- **Serverless:** schedule HTTP calls such as
  `curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR_DOMAIN/api/cron/gmail-poll`
  for `gmail-poll`, `notification-retry`, `overdue-check` and `gmail-watch` (Vercel Cron, Cloud Scheduler, GitHub Actions or cron).

## Running tests

```bash
createdb oms_test                                   # dedicated test DB (name must end in _test)
npm test                                            # migrations are applied automatically
# custom DB: TEST_DATABASE_URL=postgresql://…/something_test npm test
npm run typecheck
```

There are 63 tests, run against real PostgreSQL and a real SMTP server:

- **Unit:** workflow rules, overdue logic, PO extraction (PDF, Excel, ambiguous dates, no invented fields), order-number format, PO normalization, token encryption, Gmail query building, CSV injection guard, and the Meta and Twilio request formats and error handling.
- **Authentication & permissions:** login, wrong password, deactivated users, brute-force rate limit, bcrypt hashes, engineer isolation (lists, detail, search), engineers blocked from reassigning, editing PO data, packing and dispatching.
- **Orders:** manual creation, concurrent numbering (25 parallel, no collisions), duplicate detection, merge/ignore/create-anyway, approval blocking, content-sniffed attachments, assignment and reassignment.
- **Production:** stage transitions, append-only history (DB-enforced), validation, WhatsApp generation, disabled types, failure/retry/backoff, SKIPPED when not configured, the 8-photo limit (including across uploads), file validation, the photo lock after submission, dispatch ordering, and overdue alerts.
- **Gmail and full happy path:** Gmail payload parsing, exactly-once import, error isolation, and the complete acceptance workflow (Gmail PO → review → ORD number → assign Rahul → accept → updates → 6 photos → completion email with 6 attachments → packed → ready → dispatched → dashboard), plus an 8-photo completion email with SMTP outage and resend.

## Deployment

**Recommended:** one Node.js container for the web app, one for the worker, managed PostgreSQL, and S3/R2 storage.

```bash
npm ci
npm run build          # prisma generate + next build
npm run db:migrate     # on each release
npm start              # web (PORT env supported)
npm run worker         # separate process
```

Checklist:

- [ ] `NODE_ENV=production`, strong `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`
- [ ] `APP_URL` / `NEXTAUTH_URL` set to the HTTPS domain
- [ ] `STORAGE_PROVIDER=s3` (local storage is refused in production unless explicitly allowed)
- [ ] Gmail redirect URI registered for the production domain
- [ ] WhatsApp template approved (Meta)
- [ ] Worker running, or cron endpoints scheduled
- [ ] Database backups enabled
- [ ] If you run multiple web instances, add gateway-level rate limiting (the built-in limiter is per instance)

**Vercel:** deploy the app, then add Vercel Cron entries that call `/api/cron/*` with the `CRON_SECRET` bearer header. The worker is not needed there.

## Admin & engineer setup

1. **First admin (production):**
   `ADMIN_INITIAL_PASSWORD='…' npm run create-admin -- --email owner@company.com --name "Owner Name"`
   This also creates the default assembly stages. The password is read from the environment or prompted for, never passed as an argument.
2. Sign in → **Settings → Company**, then **Gmail**, **WhatsApp**, **Email**, and **Assembly stages**.
3. **Engineers → Add engineer:** name, login email, WhatsApp number, initial password. Engineers can change their password under the account menu.
4. Deactivate an engineer to block their login immediately. Their history is kept.

**Engineer daily flow (mobile):** My Orders → order → **UPDATE PROGRESS** → stage → progress → work done → issue (optional) → photos → Submit. On completion: **Photos & completion** → take up to 8 photos → **Mark completed & submit**.

## Testing the complete workflow

With demo data loaded (`npm run db:seed`) and `npm run mail:dev` running (`SMTP_HOST=localhost`, `SMTP_PORT=2525`):

1. Admin → **Purchase Orders**: open the PO awaiting review, fix the flagged fields, and click **Approve & create order**. The order gets `ORD-YYYY-NNNN`.
2. **Assign engineer**; the dialog shows each engineer's current workload.
3. Sign in as `rahul@demo.local` on a phone-sized window → **Review & accept**.
4. **UPDATE PROGRESS** → Mechanical Assembly, 35%, add a note → Submit. Repeat the next day.
5. **Photos & completion** → upload 6 photos → **Mark completed & submit**.
6. Admin: the completion email appears in `storage/dev-mail/*.eml`. WhatsApp messages appear under **Notifications → WhatsApp & email delivery log** (SENT, or SKIPPED until WhatsApp is configured).
7. **Dispatch** → **Mark as packed** → **Ready for dispatch** → **Mark dispatched**. The dashboard KPIs and pipeline update.

To import a real PO: connect Gmail, email a PO PDF to the mailbox with “Purchase Order” in the subject, and click **Check Gmail now** (or wait for the worker).

## Troubleshooting

| Symptom | Fix |
|---|---|
| “Gmail connection lost. Please reconnect.” | The token was revoked or expired (External apps in *Testing* mode expire refresh tokens after 7 days). Reconnect in Settings → Gmail. Publish the consent screen for production use. |
| “Google did not return a refresh token” | Remove the app at myaccount.google.com → Security → Third-party access, then reconnect. |
| POs not imported | Check Settings → Gmail (the search query is shown), Purchase Orders → **Gmail import log** (errors have Retry), System Logs, and that the worker or cron is running. |
| WhatsApp SKIPPED | Provider not configured or no admin number. Configure it, then click Retry in the delivery log. |
| WhatsApp FAILED `131047` / re-engagement | Outside the 24-hour window: set `WHATSAPP_TEMPLATE_NAME` to an approved template. |
| Completion email FAILED | Check SMTP settings and use **Send test email**, then **Resend completion email** on the order. |
| `STORAGE_PROVIDER=local is not allowed in production` | Configure S3/R2/Supabase, or set `ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true` for a single server with a persistent, backed-up volume. |
| “Table … is append-only” | Expected: history rows cannot be modified. |
| Login “Too many login attempts” | Wait 15 minutes (brute-force protection). |
