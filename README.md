# SiteForge
SiteForge membantu usaha kecil membuat website satu halaman tanpa kode lalu menerbitkannya ke `namabisnis.pages.dev`.

## Alur pengguna
1. Isi profil usaha, kategori, lokasi, kontak, dan deskripsi.
2. Pilih template responsif; SiteForge membuat teks awal yang bisa diedit.
3. Atur bagian halaman: hero, tentang, menu/layanan, galeri, testimoni, lokasi/jam, kontak, footer. Bagian bisa diurutkan, diubah, atau disembunyikan.
4. Sesuaikan warna, gambar, tombol, SEO title, meta description, favicon, dan gambar berbagi sosial.
5. Preview desktop/mobile, simpan draft, login bila perlu, pilih slug, lalu publish.
6. Dashboard pengguna menunjukkan situs, URL, status deploy, edit, publish ulang, unpublish, dan hapus.

## MVP
- 3–5 template untuk bisnis umum, satu halaman per situs.
- Editor visual ringan, upload aset tervalidasi, autosave, preview responsif.
- Status draft/deploying/published/failed/disabled yang jelas.
- Login wajib untuk simpan lintas perangkat dan publish; pengguna boleh mencoba builder sebelum login.
- Batas kuota gratis terlihat sebelum publish.
- Custom domain, multi-page, blog, toko, dan analytics lanjutan setelah MVP.

## Panel admin
- Metrik pengguna, situs aktif, keberhasilan deploy, dan laporan.
- Pencarian/filter situs berdasarkan status, pemilik, URL, dan waktu.
- Detail pemilik, histori deploy, error aman, dan domain.
- Tinjau laporan; disable/restore situs dengan alasan.
- Audit log; role admin/staf dan autentikasi kuat.
- Data admin hanya tersedia melalui API server dengan otorisasi.

## Data inti
- User(id, email, role, status, createdAt)
- Site(id, ownerId, name, slug, templateId, status, createdAt, updatedAt)
- SiteContent(siteId, sections, theme, seo, assetReferences, version)
- Deployment(id, siteId, providerId, status, url, timestamps, safeError)
- Report(id, siteId, reporter, reason, status, reviewedBy)
- AuditEvent(actorId, action, targetId, reason, timestamp)

## Deploy & keamanan
Server memvalidasi konten, slug, kuota, dan file; membangun situs statis; mengirimnya ke layanan deploy; lalu menyimpan status dan URL. Kredensial Cloudflare tidak pernah berada di browser. Pendekatan isolasi situs dan multi-tenant perlu dipastikan terhadap batas provider sebelum produksi.

Validasi tipe/ukuran aset, escape teks, larang HTML/JS bebas, reserve slug sistem, rate limit deploy, autentikasi admin, audit semua tindakan moderasi, dan sediakan laporan, unpublish, serta penghapusan data.

## Roadmap
1. Prototype builder dan preview.
2. Draft persisten, akun, dashboard pengguna.
3. Backend deploy terbatas dengan kuota, domain uji, retry, dan log.
4. Panel admin dengan metrik nyata, pencarian, laporan, dan audit.
5. Custom domain, halaman tambahan, analytics.

## Implementasi saat ini
- `index.html`: prototype builder.
- `admin.html`: panel master admin untuk monitoring, moderasi website/member, laporan, audit log, dan pengelolaan paket.
- Login member, penyimpanan draft ke D1, dashboard member, dan API admin sudah terhubung. Admin dapat mengedit teks/SEO website, menangguhkan atau memulihkan member, menonaktifkan website live, meninjau laporan, mengatur paket dan kuota per member, serta mengubah paket yang tersedia untuk checkout. Situs live tersedia di `/s/<slug>` pada Pages project yang sama.
- Paket Gratis awal dibatasi dua website. Admin dapat mengatur harga, kuota, deskripsi, wilayah penagihan, dan ketersediaan paket bulanan. Pembayaran checkout menggunakan Xendit; perubahan harga memengaruhi checkout baru, sedangkan harga tagihan yang sudah berjalan tetap dikelola oleh Xendit.
