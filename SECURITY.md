# Security review notes (Part 14)

This is an academic project with security controls in place; it has not received an independent penetration test and must not be described as completely secure.

## Controls reviewed and strengthened

- Express sends Helmet security headers and disables `X-Powered-By`. JSON request bodies are limited to 100 KB. CORS accepts only the exact configured frontend origins and credentialed requests; production origins must use HTTPS.
- Startup validates JWT settings, cookie settings, CORS origins, MongoDB URI shape in production, auth rate limits, and the reverse-proxy hop count. Configure `TRUST_PROXY_HOPS` to the actual hosting topology; leave it `0` for direct local development.
- Sessions use an HS256 JWT with issuer/audience checks and a 30-minute default expiry (configurable up to 24 hours). The token is held only in an HttpOnly cookie, and mutating cookie-authenticated requests require a double-submit CSRF token. Production cookies are Secure and use the `__Host-` prefix when the same-site setting permits it. Cross-site deployments require HTTPS and `SameSite=None; Secure`; same-site hosting is preferable.
- Password changes require the current password, use bcrypt, and are rate-limited to five attempts per 15 minutes per IP. Login and registration also have a configurable rate limit. A shared/distributed limiter should replace the in-memory limiter before running multiple API instances.
- Login and registration also include a hidden honeypot field checked by the backend. This catches simple automated submissions; it is a low-friction layer, not a replacement for a managed challenge such as Turnstile if abuse becomes an issue.
- Traveler document, file, history, notification, profile, and support queries derive ownership from the authenticated session. Administrator APIs enforce the admin role on the server. User list responses omit hashes and file details.
- Uploads use a private local adapter, random storage names, extension/MIME/signature checks, path checks, size/count limits, and authenticated owner-scoped downloads. Rejected partial multipart uploads are cleaned up. Files are not served by a static route. The prepared Render blueprint mounts a private persistent disk for this adapter; this is not an object store and the service must remain single-instance.
- React renders user strings as text; review found no `dangerouslySetInnerHTML` use. JWTs are not stored in localStorage/sessionStorage. Keep API error rendering as text and never log user-entered fields or tokens.
- Frontend environment values are limited to non-secret settings such as the API base URL and upload display limits. `MONGODB_URI` and `JWT_SECRET` belong only in the ignored backend environment file or the deployment secret manager; MongoDB has no public client key to expose. MongoDB authorization is enforced with server-side role and owner-scoped queries (the app does not use SQL row-level security).
- Private local upload files are encrypted at rest with AES-256-GCM and authenticated before download. The 32-byte `DOCUMENT_ENCRYPTION_KEY` is server-only; losing or rotating it without re-encryption makes stored uploads unreadable. Back it up in a secret manager and configure it for the production API. No passport number field is collected by the current document schema.
- Error responses hide unexpected server details. Request logging excludes bodies, query strings, cookies, and headers. SMTP and MongoDB logs report safe error names/codes only.

## Audit events

The existing `AuditLog` model is used for registration, successful/failed login, logout where the cookie can be verified, password/profile changes, document create/update/delete/file upload/access, travel-record changes, reminder preference changes, and existing admin suspension/reactivation, destination requirement, and support administration actions. Audit metadata accepts only result/reason codes and allow-listed field labels; it does not accept field values, email addresses, names, passport numbers, original filenames, file contents, passwords, tokens, SMTP bodies, or storage paths. Existing indexes support actor/time and resource/time review. Audit read routes are administrator-only; no general update/delete route is exposed.

Audit writes from ordinary user actions are best-effort so an audit database hiccup does not turn a successful document or profile operation into an apparent failure. This means transient MongoDB failures can leave gaps; production should alert on audit-write failures and decide whether high-risk administrative actions must fail closed. Audit logs currently have no TTL. Retention, legal basis, archival, and deletion schedule must be decided before deployment; audit entries should not be deleted merely because a user removes a document.

## Data lifecycle

Document deletion stages private files before removing the database record and then removes the staged files. A cleanup failure can leave a quarantined orphan for manual/automated cleanup, but it is not exposed through the download endpoint. There is no automated orphan scanner yet. Local disk storage is for development; production needs a persistent private volume or a private object-store adapter and backup/recovery procedures.

Account suspension prevents future authenticated requests; it does not revoke a JWT already issued until the next request checks the database or the token expires (requests do check account status). A complete account deletion/export workflow has not been implemented. Define ownership, retention, support/notification history, legal requirements, and audit preservation before adding destructive deletion. Notification records have no automated retention purge yet.

## Remaining security risks and release gates

1. This workspace is not a Git repository, so no Git history or tracked-secret scan was available. `.env` files are ignored by the provided `.gitignore`; initialize Git and run a secret scanner before the first push. If secrets are ever committed, rotate them and use a deliberate history cleanup before publishing.
2. Production SMTP, MongoDB Atlas network rules, TLS, backup, monitoring, and secret-manager configuration are environment-specific. Never use `0.0.0.0/0` Atlas access for convenience. The source does not expose database credentials to the browser.
3. The Render persistent-disk option is not suitable for ephemeral/serverless hosts, horizontal scaling, or multi-region replication. It needs a tested backup/restore plan. A private object-store adapter is the preferred production storage option; objects must remain private and use authenticated streaming rather than public URLs.
4. Rate limiting uses per-process memory; distributed deployment needs a shared store, and IP-based limits need proxy configuration validation.
5. SMTP delivery is at-least-once across a narrow failure window; duplicated email is possible if SMTP accepts a message but the database cannot persist the success state.
6. Audit writes can fail best-effort and audit retention is undefined. Add monitoring and formally approve retention before production.
7. Account data export/deletion, notification retention, and orphan-file reconciliation still need defined policies and implementation.
8. Helmet supplies a backend CSP and Vercel frontend response headers are configured for MIME sniffing, framing, referrer, permissions, and HSTS. A frontend CSP is still intentionally unset until the deployed API origin is known; add one with `connect-src` restricted to that exact origin before production.
9. Immigration, visa validity, and overstay indicators are informational and depend on user-entered data; they are not legal determinations.

## Test commands

From `backend/`, run `npm test`. From the project root, run `npm run build:frontend`. These are regression/security checks, not a substitute for a production security assessment.
