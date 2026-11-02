# Admin master setup (Cloudflare Pages)

Admin authentication is not active until the encrypted secrets below are configured in the Cloudflare Pages project. Do not commit password or secret values to Git.

## Secrets

In Cloudflare Dashboard → Workers & Pages → SiteForge → Settings → Variables and Secrets, add encrypted secrets for Production (and Preview only if desired):

- `ADMIN_EMAIL`: the master admin email supplied by the owner.
- `ADMIN_PASSWORD_HASH`: PBKDF2 hash in `base64url(salt).base64url(hash)` format. Use SHA-256, 100,000 iterations, 16-byte random salt, and 32-byte output.
- `SESSION_SECRET`: at least 32 random bytes, base64url encoded.

Redeploy after setting secrets. The Pages middleware protects `/admin.html`; sessions use signed, HttpOnly, Secure, SameSite=Strict cookies that expire after 8 hours.

## Generate password hash locally

Choose a unique password and keep it in a password manager. Run this from a trusted Node.js environment; it prints only the encoded hash.

```js
const { webcrypto } = require('node:crypto');
const password = process.env.SITEFORGE_ADMIN_PASSWORD;
if (!password) throw new Error('Set SITEFORGE_ADMIN_PASSWORD first');
const salt = webcrypto.getRandomValues(new Uint8Array(16));
const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
const bits = new Uint8Array(await webcrypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256));
const enc = b => Buffer.from(b).toString('base64url');
console.log(enc(salt)+'.'+enc(bits));
```

Deploy the Pages Functions from the repository root. The admin dashboard reads its metrics, websites, members, reports, and audit log from the bound D1 database.


## Panel admin

Panel master admin menampilkan metrik, daftar website dan member, laporan terbuka, serta audit log. Admin dapat mengedit nama, slug, teks utama, dan metadata SEO website; menonaktifkan atau memulihkan website; menangguhkan atau memulihkan member; serta meninjau laporan. Menangguhkan member akan mengakhiri semua sesi login dan mencegah login baru. Perubahan konten website yang sudah tayang langsung terlihat di `/s/<slug>`.

Jalankan ulang `admin-schema.sql` di D1 agar tabel `member_admin_status` dibuat. File aman dijalankan ulang.
