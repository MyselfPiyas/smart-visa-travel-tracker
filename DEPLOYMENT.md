# Production deployment preparation (Part 16)

## Current state

Deployment configuration is prepared, but **the application has not been deployed** and there is no live URL. A read-only MongoDB Atlas ping using the ignored local backend configuration succeeded, and the local API readiness endpoint returned `database: "connected"` after this computer's current IP was added to the Atlas access list. That IP can change; the production API must be allowed from its own outbound network address. No user or document data was written during the connection check. SMTP credentials are not configured locally. There is no Git repository/remote in this project folder, and no Vercel or Render deployment session is available here.

The frontend deployment must be created before setting the backend's exact `FRONTEND_ORIGIN`; the Render service URL is then used in Vercel's `VITE_API_BASE_URL`. Do not put backend credentials in Vercel.

## Prepared configuration

- `frontend/vercel.json` includes an SPA fallback rewrite and response security headers. Set Vercel's project root to `frontend`, build command to `npm run build`, output directory to `dist`, and production `VITE_API_BASE_URL` to the API's `/api` URL.
- `render.yaml` describes a separate Render Node web service (`npm start`, `/api/health/live`) and persistent background worker (`npm run worker`). The live check does not fail just because Atlas has a temporary interruption; `/api/health/ready` (also `/api/health`) remains the check for whether database-backed features are ready. The backend retries Atlas connections with bounded exponential backoff. The worker runs independently of browser sessions. The API service disables its reminder worker so only the worker service schedules and sends reminders.
- The API service has a 1 GB private persistent disk mounted at `/var/data`; `DOCUMENT_LOCAL_STORAGE_PATH` points to `/var/data/private_uploads`. This keeps the current private local storage adapter across restarts. It is a single-service disk, not a private object-store bucket: it prevents public static access but does not support horizontal API scaling or automatic object-store replication. Confirm a backup plan before storing real documents.
- Both Render services use the same Atlas URI configured through secret prompts. The API gets a generated JWT secret. SMTP credentials are requested only for the worker. No real credentials are in these files.
- `backend/env.production.example` and `frontend/env.production.example` document production variable names. `.gitignore` allows these placeholder-only examples while continuing to ignore real `.env` files.

## Manual steps needed to create the deployment

1. Put this project in a private or appropriately licensed GitHub repository, then connect that repository to Vercel and Render. The current project folder has no Git remote. Alternatively, use the provider CLIs after signing in and linking the local folder.
2. Configure production MongoDB Atlas access. Create a separate production database and least-privilege application user. Add only the deployed backend's outbound IP addresses to the Atlas Network Access list; do not allow `0.0.0.0/0`. Store the production URI in the backend host's secret settings, not in source control, and do not assume the local URI is production-ready. Confirm Atlas backups/point-in-time recovery are enabled for the chosen tier, and verify required Mongoose indexes after the first successful connection.
3. Create the Vercel project with root directory `frontend`; deploy a temporary frontend build to obtain its HTTPS origin. The landing page can load while the API is not connected, but account features will not work yet.
4. In Render, create the Blueprint from `render.yaml`. Supply the production Mongo URI, exact Vercel origin, and worker SMTP settings when prompted. Store the same Mongo URI on the API and worker. Confirm pricing before creating services: this Blueprint requests paid `0.5c-512mb` compute plans, and the API's persistent disk also requires a paid service. Costs depend on the current Render plan and region.
5. Set Vercel's production `VITE_API_BASE_URL` to the deployed API URL ending in `/api` and set the matching file size/count settings, then redeploy the frontend. Use `AUTH_COOKIE_SAME_SITE=none` and `AUTH_COOKIE_SECURE=true` for separate Vercel/Render hostnames. If using a custom same-site domain or a Vercel API proxy, configure that exact origin and verify cookies in the target browser. Cross-site cookie policies vary by browser.
6. Wait for `GET https://<render-service>/api/health/ready` to report `status: "ok"` and `database: "connected"`. A successful `/api/health/live` only means the API process is running. Create the first admin only through `npm run seed:admin` in an authorized one-off backend environment with `ADMIN_NAME`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD` supplied as temporary secret variables; remove the password immediately after seeding. Then verify frontend registration/login/logout using dedicated test accounts before adding any test data.
7. Verify the worker starts with MongoDB and SMTP, then create only synthetic test documents and use a test mail sink/provider. Confirm one reminder of each interval, retries, duplicate prevention, and worker restart behavior. Do not test against real travelers or a production mailing list.
8. Upload a harmless synthetic PDF and verify owner-authorized download and deletion, then confirm no static/public bucket URL is available. Confirm a backup/restore procedure for the mounted disk.

## Production verification checklist

Do not call the service production-ready until the following are verified on the actual deployment:

- Frontend landing, public route refresh/deep links, static assets, and mobile navigation.
- API health reports MongoDB connected.
- Registration, login, session restoration, CSRF writes, logout, and account suspension behavior.
- Traveler-only ownership for records and private files; administrator denial/allow paths.
- Synthetic document upload/download/delete on persistent storage.
- Worker SMTP verification, schedule and delivery, retries, duplicate prevention, and restart recovery.
- Notification settings, travel/checklist/profile/support flows, and administrator metrics.
- HTTPS, cookie attributes, exact CORS origin, proxy trust, no leaked environment values, and monitoring.

See [QA-REPORT.md](./QA-REPORT.md) for tests that were actually run and known gaps; see [SECURITY.md](./SECURITY.md) for security limitations and retention guidance.
