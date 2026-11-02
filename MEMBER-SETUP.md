# Member login setup

The member account system runs in Cloudflare Pages Functions and needs one D1 database.

## 1. Create and bind D1
In Cloudflare Dashboard, create a D1 database. In the SiteForge Pages project, add a D1 binding named `DB` and select that database. Cloudflare Pages Functions receive the binding through `env.DB`.

## 2. Apply schema
Run both `schema.sql` and `admin-schema.sql` against the database using the D1 console or Wrangler:

```sh
npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=schema.sql
npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=admin-schema.sql
```

## 3. Set admin secrets
For the separate master-admin login, add encrypted Pages secrets:
- `ADMIN_EMAIL`: the owner's chosen admin email.
- `ADMIN_PASSWORD_HASH`: PBKDF2 hash as described in `ADMIN-SETUP.md`.
- `SESSION_SECRET`: a fresh random secret.

## 4. Deploy
Redeploy SiteForge from the repository root. Member routes:
- `/account.html` — signup and login.
- `/dashboard.html` — private list of saved website drafts.
- `/builder.html` — create or edit a saved draft.
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`.
- `/api/sites` and `/api/sites/:id` — owner-scoped draft storage.

Passwords are PBKDF2-hashed server-side; the database stores only password salt/hash and hashed session tokens. Session cookies are HttpOnly, Secure, and SameSite=Lax.

## Current scope
Member authentication, draft storage, and the member dashboard use D1. `admin-schema.sql` creates `site_content` and `member_admin_status`; after an update, run the latest file again in D1 (all statements are safe to rerun). Drafts can be saved and edited. Published sites are served at `/s/<slug>` on the same Pages project. They do not create a separate Pages project or a `<slug>.pages.dev` subdomain. Password reset, email verification, and abuse rate limiting are not yet connected.

Admin master can moderate members and edit website content from `/admin.html`. Suspended member accounts cannot start new sessions, and active sessions are removed when the suspension is applied.
