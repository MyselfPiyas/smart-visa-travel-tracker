# Smart Visa & Travel Document Tracker

Initial full-stack starter for the academic project. The frontend and backend are separate applications so each can be developed and deployed independently.

## Requirements

- Node.js 20.19+ (or 22.12+)
- npm (installed with Node.js)

## Install dependencies

From this folder:

```sh
npm run install:all
```

## Configure environment

Copy `frontend/.env.example` to `frontend/.env` and `backend/.env.example` to `backend/.env`. The example values are for local development only. Do not commit `.env` files or put real secrets in source control.

## Start the applications

On Windows, double-click `start-local.cmd` in this folder. It launches the API and website in the background, checks that both respond, and writes diagnostic logs under the Git-ignored `.local-runtime\logs` folder. Open or refresh **http://localhost:5173** in Chrome. The website binds to IPv6 loopback because Windows commonly resolves `localhost` to `::1` first; binding only to `127.0.0.1` makes that browser address time out. To have the servers start whenever you sign in to Windows, double-click `enable-local-startup.cmd`; use `disable-local-startup.cmd` to undo that setting. The computer must be on and signed in for a localhost website to be available. Use `stop-local.cmd` to stop the current servers.

If you prefer terminals, run `npm run dev:backend` and `npm run dev:frontend` in separate terminal windows from this folder, and leave both windows open. The backend readiness endpoint is http://localhost:5000/api/health (also /api/health/ready); it reports whether MongoDB is connected. The liveness endpoint at http://localhost:5000/api/health/live confirms the API process is running even during a temporary database outage.

To enable the MongoDB connection, replace the placeholder `MONGODB_URI` in `backend/.env` with your MongoDB Atlas connection string. Keep the actual URI only in the ignored `.env` file; never commit it. Without a configured URI, the API still starts and reports `database: "not_configured"` from its readiness endpoint. If Atlas is temporarily unreachable, the API remains alive, readiness reports a degraded status, and the backend retries the database connection with increasing delays (up to about 30 seconds). The sign-in and registration page also retries session checks automatically while it remains open. These retries can recover from temporary outages; they cannot fix an invalid URI, revoked database user, blocked network rule, or stopped hosting service.

Authentication also requires a private `JWT_SECRET` of at least 32 random characters in `backend/.env`. Generate one locally with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and paste the result into that ignored file. Public registration always creates a traveler. For the first administrator, set `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` only in your local shell environment, then run `npm run seed:admin` from `backend`; remove `ADMIN_PASSWORD` from the environment after seeding. Production should use HTTPS and set `AUTH_COOKIE_SAME_SITE=none` with `NODE_ENV=production`; the application then sends Secure cookies. Configure `FRONTEND_ORIGIN` to the exact frontend origin, `VITE_API_BASE_URL` to the deployed API URL, and `TRUST_PROXY_HOPS` to the actual hosting proxy count. A same-site custom domain for the frontend and API is preferable because some browsers restrict cross-site cookies.

You can also run the commands directly from each application folder with `npm run dev`.

## Available checks

```sh
npm run build:frontend
```

Run backend schema, authentication, and health-handler checks from the backend folder with `npm test`.

The backend exposes `GET /api/health` and has Mongoose schemas for users, travel documents, travel history, notifications, destination requirements, support queries, and audit logs. Authentication uses HttpOnly JWT cookies plus a CSRF token for state-changing requests. The frontend uses a React auth context and does not store JWTs in browser storage.

The traveler dashboard loads authenticated, owner-scoped summary data from `GET /api/traveler/dashboard`. After a document mutation succeeds, the frontend calls `emitTrackerDataChanged()` from `frontend/src/services/api.js` to refresh any open dashboard. The centralized expiry service uses UTC calendar-day boundaries and a configurable warning window (90, 60, and 30 days by default). Archived documents are excluded from the active dashboard total and status counts.

## Travel document management (Part 7)

Authenticated travelers can create, list, view, edit, and delete their own documents. Documents support passport, visa, travel insurance, vaccination certificate, residence permit, and other travel document types. Lists support pagination, display-name search, type/country/status filters, and expiry-date sorting. Status is calculated on the server from UTC calendar dates: an expiry earlier than today is expired; an expiry from today through the configured warning window is expiring soon; dates after that window are valid. Visa valid-from dates can yield a not-yet-valid status. Missing or malformed dates are pending information.

Uploads use private local storage for development. Files are never served from a public static directory; an authenticated owner-scoped endpoint decrypts and streams them with `private, no-store` and `nosniff` headers. The backend permits only PDF, JPEG, and PNG files whose extension, declared MIME type, and file signature agree. The defaults allow up to 5 attachments per document and 10 MB per file. Uploaded files are encrypted at rest with AES-256-GCM using a dedicated server-side key, receive random storage names, and MongoDB stores only private object keys and safe file metadata. Document deletion stages the associated encrypted files before removing the record, then permanently removes the staged copies.

Configure these settings in the ignored `backend/.env` file:

- `DOCUMENT_STORAGE_PROVIDER=local` — the included private development adapter.
- `DOCUMENT_LOCAL_STORAGE_PATH=./private_uploads` — local private directory, ignored by Git.
- `DOCUMENT_ENCRYPTION_KEY` — 32 random bytes encoded as 64 hex characters. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"` and save it only in the ignored local environment file or deployment secret manager. Keep a protected backup: encrypted uploads cannot be opened if the key is lost or rotated without re-encrypting them.
- `DOCUMENT_MAX_FILE_SIZE_MB=10` — per-file limit, configurable up to 50 MB.
- `DOCUMENT_MAX_FILES_PER_DOCUMENT=5` — attachment limit, configurable up to 5.

The frontend’s matching display/early-validation limits are `VITE_DOCUMENT_MAX_FILE_SIZE_MB=10` and `VITE_DOCUMENT_MAX_FILES_PER_DOCUMENT=5` in `frontend/.env`. Keep these values aligned with the backend values.

### Document API

All document endpoints are mounted under `/api/traveler/documents`, require an authenticated traveler session and CSRF token for writes, and always scope database queries to the session owner. Administrator sessions receive `403` on this group.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/traveler/documents` | Create document metadata |
| `GET` | `/api/traveler/documents` | List with `page`, `limit`, `q`, `documentType`, `issuingCountry`, `expiryStatus`, `sort`, and `order` filters |
| `GET` | `/api/traveler/documents/:documentId` | Get one owned document and safe attachment metadata |
| `PATCH` | `/api/traveler/documents/:documentId` | Update allowed metadata fields |
| `DELETE` | `/api/traveler/documents/:documentId` | Safely remove an owned document and its local attachments |
| `POST` | `/api/traveler/documents/:documentId/files` | Upload one or more files in the multipart `files` field |
| `GET` | `/api/traveler/documents/:documentId/files/:fileId` | Retrieve an owned attachment as a private download |

For deployment, configure an object-store adapter with private bucket/container ACLs and authenticated streaming before setting the provider to a cloud value; unsupported providers fail closed at startup. This part intentionally does not claim to implement S3/Azure storage. Local storage is suitable for development only and requires a persistent private volume if used outside development.

## Automated reminders and notifications (Part 9)

Email reminders run in a separate persistent Node.js worker, so the browser and API server do not need to remain open. The worker connects to MongoDB and SMTP, scans documents and open travel records immediately on startup and then on the configured scan interval, and polls the due notification queue on a separate interval. Start it in its own terminal with `npm run dev:worker` from the project root (or `npm run dev:worker` inside `backend`). In production, deploy `npm run worker` as a persistent worker process alongside the API and frontend. Serverless-only hosting such as a short-lived function is not sufficient for this scheduler.

Notification records use the existing `notifications` collection. A unique idempotency key per user, document, expiry date, and reminder interval prevents duplicate schedule records, including when multiple workers race. The worker claims queue records atomically with a processing lease. A restart resumes pending records; stale processing claims become eligible after the lease expires. Missed reminders are caught up at the next scan without sending a burst of every old interval: the worker schedules only the closest missed interval, while future intervals remain scheduled. User dates are evaluated against their IANA time zone and messages are scheduled for the configured local hour. Stored timestamps remain UTC.

Email delivery uses Nodemailer over SMTP. Failures receive bounded exponential retry delays, up to `REMINDER_MAX_ATTEMPTS`; the final record stores only a safe error code/category, attempts, and timestamps. No email bodies, passport numbers, files, JWTs, or SMTP error text are stored in the notification history. SMTP acceptance and MongoDB persistence cannot be made a single atomic transaction: in the rare case SMTP accepts a message and MongoDB is unavailable before the success record is saved, recovery after the processing lease can retry that message. This is an at-least-once delivery limitation of SMTP.

Copy the SMTP placeholders from `backend/.env.example` into the ignored `backend/.env` and configure them with a real provider before starting the worker. No real SMTP credentials are included. The API and frontend work without SMTP, but automated email delivery will not. `APP_BASE_URL` is the dashboard URL included in email links. Keep SMTP credentials only in local ignored environment files or the hosting provider's secret manager.

Reminder controls are under **Reminder settings**. A traveler can pause reminders, select 90/60/30/expiry-day intervals, enable expired-document, incomplete-information, and travel-record review alerts, and select a time zone. Per-document disabled reminders and interval overrides are respected. The scheduler rechecks account status, document ownership/existence, current expiry date, and preferences before sending, cancelling obsolete queued items. Potential-overstay alerts are informational only and use the recorded planned return and missing actual exit; they are not legal assessments.

## Administrator dashboard and user management (Part 12)

All administrator routes require a valid authenticated session with the `admin` role on the server. Frontend route guards are only for navigation; they are not the security boundary. The dashboard reads aggregate database counts, uses the centralized UTC expiry window, and reports notification success as `sent / (sent + failed)` (pending and processing messages are excluded). Notification stats also report attempt and retry totals. No demonstration analytics are used.

The administrator area includes the dashboard, traveler account search/filter/details, audited account suspension/reactivation, notification monitoring, destination-requirement management, and read-only support-query review. Account lists are limited to traveler name/email, status, registration date, and basic locale/time-zone settings. Password hashes and private document file details are not selected or returned. Administrator account creation remains a controlled seed operation; public registration cannot choose the admin role.

Admin APIs are mounted under `/api/admin`:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/dashboard/summary` | Real user, document, travel, notification, requirement totals and recent activity |
| `GET` | `/dashboard/activity?from=&to=&limit=` | Audited system activity with optional date range |
| `GET` | `/dashboard/compliance-summary` | Active, stale, and unverified destination requirements |
| `GET` | `/users?q=&status=&createdFrom=&createdTo=&page=&limit=` | Searchable and paginated traveler list |
| `GET` | `/users/:userId` | Limited profile information and document/trip counts |
| `PATCH` | `/users/:userId/status` | Suspend or reactivate a traveler; records an audit event |
| `GET` | `/notifications/stats` | Delivery totals, attempt counts, and retry counts |
| `GET` | `/notifications` | Safe paginated notification monitoring |
| `GET` | `/notifications/failures` | Safe failed-delivery logs |
| `GET` | `/destinations` and destination mutation routes | Existing requirement management module |
| `GET` | `/support` | Read-only support-query review |

Set `DESTINATION_REQUIREMENT_STALE_DAYS` in `backend/.env` to control when an active destination requirement is considered stale (default: 180 days). Existing database indices support role/status filtering, registration-date sorting, owner/date access, and notification status queries.

### Notification API

Traveler routes require a traveler session; mutations also require the existing CSRF header. All traveler queries are scoped to the signed-in owner. Admin routes require the admin role and expose only safe operational metadata, not recipient addresses, document contents, email bodies, or storage paths.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/traveler/notifications/preferences` | Read reminder preferences and time zone |
| `PUT` | `/api/traveler/notifications/preferences` | Update allowed preferences |
| `GET` | `/api/traveler/notifications/upcoming` | List the user's scheduled pending reminders |
| `GET` | `/api/traveler/notifications` | Paginated history; supports `type` and `status` filters |
| `GET` | `/api/traveler/notifications/:notificationId` | View one owned notification |
| `PATCH` | `/api/traveler/notifications/:notificationId/read` | Mark one owned notification as read |
| `GET` | `/api/admin/notifications/stats` | Counts by delivery status |
| `GET` | `/api/admin/notifications/failures` | Paginated failed deliveries |
| `GET` | `/api/admin/notifications` | Paginated safe delivery logs; supports `status` |

New backend settings in `backend/.env`:

- `APP_BASE_URL` — application dashboard origin used in email links.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` — SMTP transport configuration.

## Security review and audit logging (Part 14)

The API now uses Helmet headers, strict configured CORS origins, bounded JSON bodies, validated production environment settings, and rate limits for authentication and password-change attempts. Existing HttpOnly JWT cookies, CSRF checks, server-side role checks, owner-scoped data and file endpoints, upload signature checks, and safe error responses were reviewed and covered by regression checks. Selected user and administrator actions write data-minimized events to the existing `auditlogs` collection. Audit metadata records action/result and allow-listed field names only; it does not record submitted values, passwords, tokens, passport numbers, filenames, email bodies, or private paths.

Read [SECURITY.md](./SECURITY.md) before deployment. It describes the audit event coverage, remaining risks, and release requirements. In particular, local file storage is development-only, rate limiting is per process, and retention policies for audit, notification, account deletion/export, and orphan cleanup still need an explicit decision. Do not describe this project as fully secure or as independently penetration-tested.
- `REMINDER_WORKER_ENABLED` — set `false` to disable the worker.
- `REMINDER_SEND_HOUR` — local wall-clock hour, 0–23, default 9.
- `REMINDER_SCAN_INTERVAL_MS` and `REMINDER_POLL_INTERVAL_MS` — schedule scan and queue poll intervals.
- `REMINDER_BATCH_SIZE` — maximum notifications processed per poll.
- `REMINDER_MAX_ATTEMPTS`, `REMINDER_RETRY_BASE_MS`, `REMINDER_RETRY_MAX_MS` — bounded retry policy.
- `REMINDER_PROCESSING_LEASE_MS` — recovery window for crashed worker claims.
- `REMINDER_EXPIRED_WINDOW_DAYS` — how far back to scan for an expired-document warning (max 3650 days).

Backend test suite covers reminder generation/idempotency, preference suppression, timezone/DST conversion, test-transport success/failure, safe retry metadata, owner-scoped history, preference validation, admin safe logs, and the existing API/model checks. Run `npm test` from `backend` and `npm run build` from `frontend`.

## Travel history (Part 10)

Travel records reuse the existing `TravelHistory` model and collection. One record represents one country visit; for a multi-country itinerary, add one record per country. Each record belongs to the signed-in traveler, stores a two-letter ISO country code, travel purpose, planned departure/return dates, optional user-confirmed entry/exit dates, optional visa and other document references, and optional notes. Historical records are not removed when a document is replaced; if a linked document is later deleted, the travel record remains and the populated reference becomes unavailable.

The API validates calendar dates and date ordering, restricts visa and related-document references to documents owned by the current traveler, and never accepts an owner ID from the client. Returned visa summaries contain only a display name, type, validity dates, entry type, and recorded allowed-stay length. The app does not automatically decrement single-entry visas: users record confirmed travel dates themselves, and document validity does not establish immigration eligibility.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/traveler/travel-history` | Create a country-visit record |
| `GET` | `/api/traveler/travel-history` | List with `page`, `limit`, `country`, `purpose`, `period`, `dateFrom`, `dateTo`, and `sort` filters |
| `GET` | `/api/traveler/travel-history/:recordId` | View one owned record |
| `PATCH` | `/api/traveler/travel-history/:recordId` | Update an owned record |
| `DELETE` | `/api/traveler/travel-history/:recordId` | Delete an owned record without deleting linked documents |

The traveler dashboard now includes owner-scoped trip totals, recent past trips, upcoming trips, and recently visited country codes. The travel history page supports past/upcoming grouping, country-code and purpose filters, departure-date ranges, sorting, pagination, record details, edits, and confirmed deletion. Use two-letter country codes in this version (for example, `IN` or `JP`); display labels are localized in the browser. Travel-purpose values include Tourism, Business, Education, Employment, Family Visit, Medical, Transit, and Other; older stored purpose values remain accepted for compatibility.

Travel-history API tests cover create/read/update/delete, date validation, country and purpose filtering, pagination, empty results, cross-user access, owned visa references, and dashboard totals. Run the existing commands above to execute the complete suite and production frontend build.

## Destination requirements and checklist (Part 11)

The existing `DestinationRequirement` collection stores source-backed checklist entries. It is intentionally not populated with example travel rules. Administrators must verify an entry against an official authority before creating it and supply its HTTPS source URL and last-verified date. HTTPS syntax is validated; the application cannot certify the publisher or the accuracy of an administrator’s interpretation. Entries with no verification date are marked unverified, and dates older than `DESTINATION_REQUIREMENT_STALE_DAYS` (default 180) are marked outdated. Travelers are prompted to recheck all sources before departure.

The traveler checklist requires destination country, nationality, purpose, planned departure, and planned return. It returns only active entries matching that country and nationality, plus entries whose purpose is `any`. It compares passport, visa, insurance, and vaccination-certificate requirement wording with only the signed-in traveler’s saved documents. A potential match means only that a document of a relevant type is saved and its recorded dates appear to cover the trip; it is never marked as satisfying an immigration rule. A document’s title and type are not proof of eligibility. Requirements that cannot be mapped to a document type are labelled uncertain. Visa matching uses the saved issuing-country field as a hint and asks the traveler to verify the source.

Traveler endpoints require a traveler session:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/traveler/destinations` | Search and paginate active entries with `destinationCountry`, `nationality`, `purpose`, and `q` filters |
| `GET` | `/api/traveler/destinations/checklist` | Build a date-aware checklist and cautious comparison with the traveler’s own saved documents |

Administrator endpoints require an administrator session:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/destinations` | Search/paginate active or inactive entries |
| `POST` | `/api/admin/destinations` | Create a requirement with an HTTPS source and verification date |
| `PATCH` | `/api/admin/destinations/:requirementId` | Update reviewed details; edits to requirement content require a new verification date |
| `PATCH` | `/api/admin/destinations/:requirementId/deactivate` | Deactivate an outdated entry while retaining its record |
| `DELETE` | `/api/admin/destinations/:requirementId` | Permanently remove an entry |
| `GET` | `/api/admin/destinations/history` | View safe audit events for requirement changes |

The admin page records the updating administrator and writes audit events containing action, record identifier, time, and allow-listed changed field names. It does not keep historical copies of requirement text or source content. Country and nationality values use two-letter codes, and purpose can be specific or `any`. `DESTINATION_REQUIREMENT_STALE_DAYS=180` controls the stale-source warning period.

Part 11 tests cover active filtering, nationality/purpose matching, pagination, empty results, source links, stale verification dates, saved-document matches and uncertainty, dates, traveler write denial, admin CRUD, and audit history. Run `npm test` from `backend` and `npm run build` from `frontend`.

## Expiry tracking (Part 8)

`DOCUMENT_EXPIRY_WARNING_DAYS=90,60,30` configures the warning thresholds in `backend/.env`. The largest number sets the `expiring_soon` status window; the closest configured threshold is returned with a document’s calculated `remainingDays`. Calendar dates are stored as UTC midnight and compared by UTC date, preventing display timezone offsets from moving an expiry across a day. Dates are recalculated on reads rather than saved as a status that can become stale overnight.

Visa `validFrom`, `expiryDate` (valid until), entry type, and optional recorded allowed-stay days are separate fields. Visa usage is kept on travel-history records through user-reported actual entry/exit dates and an optional visa reference. Open trips whose planned return or recorded stay limit has passed produce informational review alerts only. They do not determine immigration eligibility or legal overstay; users should verify the facts and check official destination rules.

Expiry APIs (all require a traveler session):

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/traveler/documents/expiry/summary` | Configured thresholds, active counts, next expiry, and upcoming expiries |
| `GET` | `/api/traveler/documents/expiry/upcoming?withinDays=90` | Upcoming expirations, up to 365 days |
| `GET` | `/api/traveler/documents/expiry/expired` | Expired documents |
| `GET` | `/api/traveler/documents/expiry/potential-overstay-warnings` | Informational open-trip review warnings |
| `GET` | `/api/traveler/documents/:documentId/status` | Current status and remaining days for an owned document |
| `POST` | `/api/traveler/documents/:documentId/recalculate-status` | Recalculate current status without persisting a time-dependent value |

## Deployment preparation (Part 16)

Vercel SPA routing/security headers are configured in `frontend/vercel.json`. `render.yaml` defines a separate API and persistent reminder-worker service. Production environment templates are `frontend/env.production.example` and `backend/env.production.example`; enter real values in provider secret settings only. The API uses a private persistent disk for uploads in the proposed Render setup; it is not an object-store adapter and is single-instance only.

**Deployment is not yet complete.** Local Atlas connectivity is confirmed and the local API reports MongoDB connected. SMTP is not configured locally, this folder has no Git remote, and no provider deployment was created. Production Atlas access must be configured for the deployed backend's outbound IP. Follow [DEPLOYMENT.md](./DEPLOYMENT.md) to finish provider setup and test the actual live URLs. Do not invent/share a live URL before the provider reports a successful deploy and health check.
