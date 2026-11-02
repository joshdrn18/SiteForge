# Member login and packages

SiteForge member accounts, saved websites, package limits, and admin controls run in Cloudflare Pages Functions with D1.

## 1. Create and bind D1

In the Cloudflare Dashboard, create a D1 database. In the SiteForge Pages project, add a D1 binding named `DB` and select that database. Pages Functions read the binding through `env.DB`.

## 2. Apply the database schema

Run both `schema.sql` and `admin-schema.sql` against the same D1 database in the D1 console or with Wrangler:

```sh
npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=schema.sql
npx wrangler d1 execute YOUR_DATABASE_NAME --remote --file=admin-schema.sql
```

After a SiteForge update that changes `admin-schema.sql`, run the latest file again. Its statements are safe to rerun; this creates or updates package catalog support without removing member data.

## 3. Set admin and payment secrets

For master-admin login, add encrypted Pages secrets:

- `ADMIN_EMAIL`: the owner's admin email.
- `ADMIN_PASSWORD_HASH`: PBKDF2 hash described in `ADMIN-SETUP.md`.
- `SESSION_SECRET`: a fresh random secret. Keep this secret stable; it signs admin sessions.

After the latest `admin-schema.sql` has been applied, the first successful master-admin login copies the configured email and password hash into the `admin_accounts` table. The admin profile can then update the login email and password in the panel. `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH` remain bootstrap credentials for initial setup or recovery. For recovery, rotate `SESSION_SECRET` in Pages to invalidate existing admin sessions, delete the single `admin_accounts` row with id `master` in D1, then sign in using the Pages `ADMIN_EMAIL` and `ADMIN_PASSWORD_HASH`; the profile is seeded again.

For monthly checkout, add encrypted Pages secrets `XENDIT_SECRET_KEY` and `XENDIT_WEBHOOK_TOKEN`. Configure the Xendit recurring/subscription webhook to:

`https://siteforge-aez.pages.dev/api/billing/webhook`

Enable the recurring plan and cycle events. Copy the endpoint callback token into `XENDIT_WEBHOOK_TOKEN`. Use Xendit test credentials while validating the flow, then switch to live credentials when ready.

## 4. Configure packages in Admin

Deploy SiteForge, run the latest `admin-schema.sql` in D1, then open `/admin.html` and sign in as the master admin. Use **Profil admin** in the panel to edit the master-admin display name, login email, or password; the current password is required. Password changes revoke other admin sessions. In the **Plans** section you can add or edit package names, descriptions, monthly prices, billing country/currency, website limits, display order, and checkout availability.

The database seeds a **Gratis** package with a two-website limit and a disabled **Pro Bulanan** package. Set its price and enable it before member checkout becomes available. You can also create more monthly packages; active paid packages appear in the member dashboard.

Members can edit their display name, email, and password from the **Profil** button on `/dashboard.html`; saving requires their current password, and changing the email or password signs out their other sessions. In **Members**, select **Paket** to assign a package to one account, optionally with an end date and reason. Select **Ganti password** to set a new password (minimum 12 characters). This immediately revokes all existing member sessions; share the new password with the account owner directly. The panel never stores the plaintext password or writes it to the audit log. Removing an admin package assignment returns the member to their current paid Xendit package or Gratis. If the member has an active Xendit recurring plan, the admin panel requires the explicit cancellation checkbox before replacing their package. This calls Xendit to stop future renewals.

Changing a package's name or website limit applies to members on that package. Changing its price applies to future checkouts; it does not change the recurring price already stored by Xendit for existing subscribers. Deactivating a package hides it from new checkouts but does not remove existing member access.

## 5. Deploy and use

Redeploy SiteForge from the repository root. Main routes:

- `/account.html` — member signup and login.
- `/dashboard.html` — member's saved websites and package status.
- `/builder.html` — create or edit a saved draft.
- `/admin.html` — platform monitoring, website moderation/editing, member status, and package management.
- `/api/auth/register`, `/api/auth/login`, `/api/auth/me`, `/api/auth/logout`, and `/api/profile`.
- `/api/admin/profile` — master-admin profile update and login credential changes.
- `/api/sites` and `/api/sites/:id` — member-owned website storage.
- `/api/billing/status`, `/api/billing/checkout`, `/api/billing/cancel`, and `/api/billing/webhook`.

Passwords are PBKDF2-hashed server-side. D1 stores password hashes and hashed session tokens. Session cookies are HttpOnly, Secure, and SameSite=Lax.

Published member websites are served at `/s/<slug>` on the same Pages project. They do not create separate Pages projects or a `<slug>.pages.dev` subdomain. Published websites remain live if a member's paid period ends, but the member cannot create additional websites beyond the current package limit until the website count is within that limit. Email verification and email-based password recovery are not connected yet.

Signups are limited to five per network per day; new websites and publications are limited to ten each per network per day. SiteForge stores a daily hash of the Cloudflare connecting IP for this limit, not the raw address.
