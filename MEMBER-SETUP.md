# Member login setup

The member account system runs in Cloudflare Pages Functions and needs one D1 database.

## 1. Create and bind D1
In Cloudflare Dashboard, create a D1 database. In the SiteForge Pages project, add a D1 binding named `DB` and select that database. Cloudflare Pages Functions receive the binding through `env.DB`.

## 2. Apply schema
Run `schema.sql` against the database using the D1 console or Wrangler:

```sh
npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=schema.sql
```

## 3. Set admin secrets
For the separate master-admin login, add encrypted Pages secrets:
- `ADMIN_EMAIL`: the owner's chosen admin email.
- `ADMIN_PASSWORD_HASH`: PBKDF2 hash as described in `ADMIN-SETUP.md`.
- `SESSION_SECRET`: a fresh random secret.

## 4. Deploy
Redeploy SiteForge from the repository root. Member routes:
- `/account.html` — signup and login.
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`.

Passwords are PBKDF2-hashed server-side; the database stores only password salt/hash and hashed session tokens. Session cookies are HttpOnly, Secure, and SameSite=Lax.

## Current scope
Authentication and account sessions are implemented. Saving drafts/sites to member accounts, password reset, email verification, abuse rate limiting, and live admin metrics are not yet connected.
