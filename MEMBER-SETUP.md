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
Member authentication, draft storage, and the member dashboard use D1. `admin-schema.sql` creates `site_content`, `member_admin_status`, `ip_rate_limits`, `member_subscriptions`, and `member_subscription_cycles`; after an update, run the latest file again in D1 (all statements are safe to rerun). Drafts can be saved and edited. Published sites are served at `/s/<slug>` on the same Pages project. They do not create a separate Pages project or a `<slug>.pages.dev` subdomain. Password reset and email verification are not yet connected.

Admin master can moderate members and edit website content from `/admin.html`. Suspended member accounts cannot start new sessions, and active sessions are removed when the suspension is applied.

Free accounts can create up to two websites. Pro accounts can create up to ten websites while their paid period is active. Signups are limited to 5 per network per day; new sites and publications are limited to 10 each per network per day; the app stores a daily hash of the Cloudflare connecting IP for this limit, not the raw address.


## Pro monthly subscription (Xendit)

The member dashboard includes hosted monthly checkout through Xendit. The first payment is requested at checkout, then Xendit schedules monthly renewals. SiteForge grants Pro only after an authenticated `recurring.cycle.succeeded` webhook; a browser redirect alone never upgrades an account. Canceling stops future renewal and keeps Pro access until the paid period ends. Published sites already online remain live after Pro expires, but a free account cannot publish additional websites beyond its two-site limit; reducing the saved website count to two is required before creating more.

1. Run the latest `admin-schema.sql` in D1. It adds `member_subscriptions` and `member_subscription_cycles`.
2. In the Pages project, add encrypted secrets `XENDIT_SECRET_KEY` and `XENDIT_WEBHOOK_TOKEN`.
3. Add the variable `PRO_MONTHLY_AMOUNT` with the price you choose. The default billing region is `BILLING_COUNTRY=ID` and `BILLING_CURRENCY=IDR`. Malaysia is also supported with `BILLING_COUNTRY=MY` and `BILLING_CURRENCY=MYR`. Keep the country/currency pair aligned.
4. In Xendit, point the Subscription/Recurring webhook to `https://siteforge-aez.pages.dev/api/billing/webhook`, enable recurring plan and cycle events, and copy that endpoint's callback token into the Pages secret `XENDIT_WEBHOOK_TOKEN`.
5. Redeploy. The Pro button stays disabled until the amount and both secrets are present.

Routes: `/api/billing/status`, `/api/billing/checkout`, `/api/billing/cancel`, and `/api/billing/webhook`. Use Xendit test credentials first, then replace them with live credentials after verifying the callback and checkout flow.
