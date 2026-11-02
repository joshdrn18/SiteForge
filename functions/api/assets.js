import { getMember, sameOrigin } from "../_shared/member-billing.js";

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_MEMBER_FILES = 25;
const MAX_MEMBER_BYTES = 20 * 1024 * 1024;

function imageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { extension: "png", contentType: "image/png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { extension: "jpg", contentType: "image/jpeg" };
  if (bytes.length >= 6 && String.fromCharCode(...bytes.slice(0, 6)).match(/^GIF8[79]a$/)) return { extension: "gif", contentType: "image/gif" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { extension: "webp", contentType: "image/webp" };
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin tidak valid." }, { status: 403 });
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  if (!env.MEDIA) return Response.json({ error: "Penyimpanan gambar belum aktif. Tambahkan binding R2 bernama MEDIA lalu deploy ulang." }, { status: 503 });

  try {
    const member = await getMember(request, env);
    if (!member) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const memberId = String(member.id || "");
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(memberId)) return Response.json({ error: "ID akun tidak valid." }, { status: 500 });

    const length = Number(request.headers.get("Content-Length") || 0);
    if (length > MAX_FILE_SIZE + 65536) return Response.json({ error: "Ukuran gambar maksimal 2 MB." }, { status: 413 });
    const form = await request.formData();
    const file = form.get("file");
    if (!file || typeof file.arrayBuffer !== "function" || typeof file.size !== "number") {
      return Response.json({ error: "Pilih file gambar terlebih dahulu." }, { status: 400 });
    }
    if (file.size < 1 || file.size > MAX_FILE_SIZE) return Response.json({ error: "Ukuran gambar maksimal 2 MB." }, { status: 413 });

    const bytes = await file.arrayBuffer();
    const type = imageType(new Uint8Array(bytes));
    if (!type) return Response.json({ error: "Gunakan gambar PNG, JPEG, WebP, atau GIF yang valid." }, { status: 415 });

    const prefix = memberId + "/";
    const listed = await env.MEDIA.list({ prefix, limit: 1000 });
    const currentBytes = (listed.objects || []).reduce((sum, object) => sum + Number(object.size || 0), 0);
    if (listed.truncated || (listed.objects || []).length >= MAX_MEMBER_FILES || currentBytes + file.size > MAX_MEMBER_BYTES) {
      return Response.json({ error: "Penyimpanan gambar akun penuh (maksimal 25 file atau 20 MB). Hapus atau ganti gambar lama pada website, lalu simpan kembali." }, { status: 413 });
    }

    const filename = crypto.randomUUID() + "." + type.extension;
    const key = prefix + filename;
    await env.MEDIA.put(key, bytes, {
      httpMetadata: { contentType: type.contentType, cacheControl: "public, max-age=300" },
      customMetadata: { memberId, uploadedAt: String(Date.now()) }
    });
    return Response.json({ url: "/media/" + memberId + "/" + filename, size: file.size, contentType: type.contentType }, { status: 201 });
  } catch (error) {
    console.error("[member-media:upload]", String(error?.message || error));
    return Response.json({ error: "Gambar gagal diunggah." }, { status: 500 });
  }
}
