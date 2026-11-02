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
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`.

Passwords are PBKDF2-hashed server-side; the database stores only password salt/hash and hashed session tokens. Session cookies are HttpOnly, Secure, and SameSite=Lax.

## Current scope
Member authentication and admin monitoring APIs are implemented. The admin dashboard reads D1 metrics and supports site status/report review actions with an audit trail. Site publishing and member draft persistence are not yet connected, so site/deploy metrics remain empty until those features write to the tables. Password reset, email verification, and abuse rate limiting are not yet connected.
