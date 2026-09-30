# Architecture

## 1. System overview

```
                ┌───────────────────── Next.js app (web) ─────────────────────┐
 Browser ──────►│ Server Components (pages)   Server Actions   Route handlers │
 (admin,        │          │                       │                 │         │
  engineer)     │          └──────────┬────────────┴─────────────────┘         │
                │                     ▼                                          │
                │          Service layer  src/server/services/*                 │
                │   (authorization · workflow · validation · audit · outbox)    │
                │                     │                                          │
                │   Integrations  src/server/integrations/*                      │
                │   gmail · extraction · whatsapp · email · storage              │
                └─────────┬───────────┬───────────────┬──────────────┬──────────┘
                          │           │               │              │
                    PostgreSQL   Gmail API      WhatsApp API     S3 / R2 / Supabase
                     (Prisma)    (+Pub/Sub)     (Meta/Twilio)    SMTP / Gmail send
                          ▲
 Worker (npm run worker) ─┘  gmail-poll · notification-retry · overdue-check · gmail-watch
 or /api/cron/<job> called by a scheduler
```

**Design principles**

- **All business rules live in the service layer.** Pages, actions, route handlers, the worker and the tests call the same functions, so a rule cannot be bypassed by using a different entry point. Every service takes an `Actor` (`id`, `name`, `role`, `ip`, `userAgent`) and authorizes and audits using it.
- **One source of truth.** Each order row aggregates its current state. History lives in append-only tables (daily updates and the audit log).
- **Never fail silently.** Every external call is recorded (outbox row, system log, in-app alert) with a retry path.
- **Mobile-ready API surface.** Uploads and daily updates are plain multipart HTTP endpoints, so a future mobile app can reuse them.

## 2. Code layout

```
prisma/schema.prisma          data model
prisma/migrations/            SQL migrations (+ append-only triggers, CHECKs, search indexes)
prisma/seed.ts                demo data (labelled)
scripts/worker.ts             background worker
scripts/create-admin.ts       production bootstrap
src/lib/                      client-safe: status catalogue, workflow rules, schemas, utils
src/server/auth/              NextAuth config, session guards, password hashing
src/server/services/          domain services (orders, PO import, updates, images, completion, dispatch, …)
src/server/integrations/      gmail/, extraction/, whatsapp/, email/, storage/
src/server/actions/           Server Actions (thin: authorize → service → revalidate)
src/server/jobs/              job registry + DB lease
src/app/(app)/                authenticated pages
src/app/api/                  auth, uploads, file serving, exports, cron, Gmail OAuth & Pub/Sub
tests/                        Vitest suites (real Postgres + real SMTP server)
```

## 3. Order lifecycle

```
PO_RECEIVED ─► PO_UNDER_REVIEW ─► ORDER_CREATED ─► ASSIGNED ─► ACCEPTED ─► ASSEMBLY_IN_PROGRESS ⇄ TESTING
   (Gmail)        (admin edits)      (approve:        (admin)     (assigned    (daily update; the stage's
                                     ORD number)                  engineer)    phase decides which)
                                                                                       │
   CLOSED ◄─ DISPATCHED ◄─ READY_FOR_DISPATCH ◄─ PACKED ◄─ PHOTOS_UPLOADED ◄─ COMPLETED ◄┘
   (admin)    (admin)         (admin)            (admin)     (engineer submits  (engineer)
                                                              photos → email)
 ON_HOLD (admin, from any active state; resume returns to the previous state)
 CANCELLED (admin, with a reason; also used for rejected, ignored or merged duplicate POs)
```

`src/lib/workflow.ts` declares, for every action, the roles allowed and the source statuses. `transition()` in `services/orders.ts` rechecks the rule against the **current** row, under a per-order advisory transaction lock, then writes the status change and a `STATUS_CHANGED` audit entry. Reassigning keeps progress and history. The new engineer must accept again.

## 4. Database relationships

```
users 1─* orders (engineer_id)            customers 1─* orders
orders 1─* purchase_orders ─* documents   orders 1─* documents
orders 1─* order_stage_progress *─1 assembly_stages
orders 1─* daily_updates *─1 assembly_stages     daily_updates 1─* order_images (kind=PROGRESS)
orders 1─* order_images (kind=MACHINE, ≤ 8)
orders 1─1 dispatch                        orders 1─* order_notes
orders 1─* notifications (outbox)          users 1─* in_app_notifications
orders 1─* audit_logs *─1 users
order_sequences (year → last value)        settings (key → JSON)
gmail_connections (single row, encrypted tokens)   gmail_processed_messages (message_id PK)
system_logs
```

- **Order numbers:** `INSERT … ON CONFLICT (year) DO UPDATE SET last_value = last_value + 1 RETURNING` row-locks the year's counter. A unique index on `orders.order_number` is the final guard. Numbers are allocated at approval, so rejected or duplicate drafts never consume one.
- **Append-only history:** `daily_updates` and `audit_logs` have `BEFORE UPDATE OR DELETE` triggers that raise an error. Orders are never hard-deleted (foreign keys use `RESTRICT`).
- **Indexes** on status, engineer + status, customer, PO number (plus `lower(po_number)`), expected completion date, last update, and audit (order, time).

## 5. Authentication & authorization

- NextAuth v4 credentials provider. Passwords are hashed with bcrypt (cost 12). Unknown emails are compared against a dummy hash so response time doesn't reveal which accounts exist.
- Login rate limits: 8 attempts per account and 40 per IP per 15 minutes. Successful and failed logins are audited.
- JWT session cookie (httpOnly, 12-hour lifetime). **The JWT is trusted only for identity:** `getCurrentUser()` re-reads the role and `active` flag from the database on every request, so deactivation takes effect immediately.
- Authorization happens in three layers:
  1. Page guards (`requireUser('ADMIN' | 'ENGINEER')`).
  2. Action and route guards (`authorize()`).
  3. Service checks (`assertAdmin`, `assertAssignedEngineer`, the workflow rules), plus row scoping with `orderScope(actor)`, which forces `engineer_id = me` on every engineer query.
- A missing order and an order you may not see both return **not found**, so nothing leaks. File routes apply the same scope.
- CSRF: Server Actions verify the Origin header (Next.js). Mutating route handlers call `assertSameOrigin()`. The OAuth `state` parameter is kept in an httpOnly cookie and compared in constant time.

## 6. Gmail integration

```
Pub/Sub push ─┐
Worker poll  ─┼─► syncGmail()  (DB lease "gmail-sync": one sync at a time, cluster-wide)
Admin button ─┘        │  q = subject:(…) from:(…) label:… has:attachment newer_than:Nd -in:sent …
                       ▼
       for each id not in gmail_processed_messages:
           getMessage → allowed attachments → download
           importPurchaseOrder():
             sniff file type (magic bytes) → SHA-256
             extract text (PDF lines via coordinates, XLSX cells, DOCX, email body)
             extractPoFields(): label/value + item-table heuristics, confidence per field
             match customer (email domain → exact name)
             findDuplicateCandidates()
             store attachments → create draft order (PO_RECEIVED) + purchase_order + documents
             audit + in-app "PO requires review" + WhatsApp PO_RECEIVED
           record processed message (IMPORTED / SKIPPED / DUPLICATE / ERROR)
```

- OAuth 2.0 with offline access. Refresh and access tokens are AES-256-GCM encrypted with `ENCRYPTION_KEY`. Refreshed tokens are saved as they arrive.
- An auth failure (`invalid_grant` or 401) marks the connection `ERROR`, logs it, and shows a banner and alert: *“Gmail connection lost. Please reconnect.”*
- Exactly-once: `purchase_orders.gmail_message_id` is UNIQUE, and `gmail_processed_messages` records every message examined, including skipped and failed ones. Failed messages can be retried from the import log.
- Pub/Sub push is verified with Google-signed OIDC tokens (audience and service account). The push only triggers the same idempotent sync, so lost or duplicated pushes are harmless.

### PO extraction

- Text keeps its line structure (PDF text items are grouped into lines by y-coordinate, and columns are separated by tabs), so `Label: value`, label-above-value, and `Description | Model | Qty | Rate` tables all parse.
- **No assumptions.** A field is only set when present. Ambiguous `dd/mm` dates, generic `Date:` labels, and sender-name fallbacks are marked `low` confidence and produce warnings. Key fields that are missing produce *“PO imported successfully but … could not be identified.”*
- Images and scanned PDFs are stored and flagged for manual entry. OCR is deliberately not guessed. An OCR or LLM extractor can be added behind `extractPoFields` later.

### Duplicate detection

| Signal | Strength |
|---|---|
| Same Gmail message ID | exact (never re-imported) |
| Same attachment SHA-256 | strong |
| Same normalized PO number (`PO-4587` = `4587`) and same customer, name, or sender domain | strong |
| Same PO number, different customer | possible |
| Same sender and same PO date | possible |

A suspected duplicate blocks approval until the admin chooses **Merge** (the PO email and documents move to the existing order, and the draft is cancelled), **Ignore** (the draft is cancelled), or **Create anyway**.

## 7. Notification architecture

```
service transaction ──► notifications row (PENDING)  ◄── queued atomically with the change
          │ commit
          ▼
deliverNotifications(ids) ─► deliverOne(): claim row → provider.send()
                                  ├─ SENT    → provider message id, audit "System sent WhatsApp…"
                                  ├─ FAILED  → error, attempts++, audit, admin in-app alert, system log
                                  └─ SKIPPED → channel not configured / no recipient (visible, retryable)
worker notification-retry ─► FAILED (and stale PENDING) rows, exponential backoff, 5 attempts
admin "Retry" button ─────► retryNotification()
```

- `WhatsAppProvider` interface: `MetaWhatsAppProvider` (Graph `/{phone_id}/messages`, text or template) and `TwilioWhatsAppProvider` (Messages API). The provider is chosen by `WHATSAPP_PROVIDER`. Adding another provider means implementing one method.
- `EmailTransport` interface: SMTP (nodemailer) or the Gmail API (a MIME message built by nodemailer's MailComposer).
- The completion email is **built at send time** (`completion-email.ts`) from current data. Photos are embedded by `cid` and attached, capped at 15 MB total.
- Event types can be switched on and off per type in Settings → WhatsApp. In-app notifications are always created. Read/unread is tracked per user.

## 8. File storage

- `StorageProvider` interface (`put`, `get`, `delete`, `signedUrl`) with an S3 implementation (AWS S3, R2, Supabase, MinIO) and a local implementation for development. Production refuses local storage unless explicitly allowed.
- Keys follow `orders/{orderId}/{images|progress|documents}/{uuid}.{ext}`. They contain no user-supplied names, and the local provider prevents path traversal.
- **Images:** extension check, then decoding by `sharp` (so content is validated), EXIF auto-rotation, metadata stripped, a 2560 px maximum, and JPEG quality 82. Browsers also downscale before upload.
- **Documents:** magic-byte sniffing (`%PDF-`, ZIP for docx/xlsx, OLE for doc/xls, JPEG/PNG signatures).
- **The 8-photo limit** is checked before processing, then rechecked inside the transaction under the order's advisory lock, so parallel uploads can't exceed it. If the database write fails, the stored objects are removed.
- **Serving:** the route authorizes the user and then redirects to a 5-minute signed URL (S3) or streams the file with `nosniff` and a sandbox CSP (local).

## 9. Background jobs

`src/server/jobs/index.ts` registers four jobs. They run in either of two ways:

- **`scripts/worker.ts`:** one long-running process that calls each job on its own interval.
- **`/api/cron/[job]`:** Bearer `CRON_SECRET`, for Vercel Cron or Cloud Scheduler.

Concurrency across web instances and workers is controlled by a **database lease** (a `settings` row with an owner and expiry, acquired with a conditional upsert). This works with pooled connections, unlike session-level advisory locks. Each job is idempotent in its own right: message IDs for Gmail, claim-by-status for notifications, and `last_overdue_alert_on` compare-and-set for overdue alerts.

## 10. Error handling & observability

- `AppError` (user-safe message plus a code mapped to an HTTP status), `ZodError` (field errors shown next to inputs), and Prisma unique-constraint errors (friendly message). Anything else is written to `system_logs` with the stack and shown to the user as a generic message.
- The System Logs page (filter by level and source) shows integration and job events. Notifications → the delivery log shows every WhatsApp message and email with its status, attempts, error, and a Retry button.

## 11. Extending

- **Mobile app:** reuse the multipart endpoints (`/api/orders/:id/updates`, `/photos`) and add a token-based session strategy alongside the cookie.
- **Another WhatsApp or SMS provider:** implement `WhatsAppProvider`.
- **OCR / LLM extraction:** add a text source in `extraction/text.ts`, or a field extractor that returns the same `PoExtraction` shape (with confidence), so the review UI keeps working.
- **Multi-instance rate limiting:** replace `src/lib/rate-limit.ts` with a Redis implementation (same signature).
