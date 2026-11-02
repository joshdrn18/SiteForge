import { getMember } from "../../_shared/member-billing.js";

const extensionTypes = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
function notFound() {
  return new Response("Gambar tidak ditemukan.", { status: 404, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function onRequestGet({ request, env, params }) {
  if (!env.DB || !env.MEDIA) return new Response("Penyimpanan gambar tidak tersedia.", { status: 503 });
  const memberId = String(params.member || "");
  const filename = String(params.file || "");
  const match = filename.match(/^([0-9a-f-]{36})\.(png|jpg|webp|gif)$/i);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(memberId) || !match) return notFound();

  try {
    const key = memberId + "/" + filename;
    const metadata = await env.MEDIA.head(key);
    if (!metadata || metadata.customMetadata?.memberId !== memberId) return notFound();

    const member = await getMember(request, env);
    const isOwner = String(member?.id || "") === memberId;
    let isPublished = false;
    if (!isOwner) {
      const publicReference = await env.DB.prepare(
        "SELECT 1 AS ok FROM sites s JOIN site_content c ON c.site_id=s.id WHERE s.status='published' AND instr(c.content_json,?)>0 LIMIT 1"
      ).bind("/media/" + memberId + "/" + filename).first();
      isPublished = !!publicReference;
      if (!isPublished) return notFound();
    }

    const object = await env.MEDIA.get(key);
    if (!object || !object.body) return notFound();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", extensionTypes[match[2].toLowerCase()]);
    headers.set("ETag", object.httpEtag);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Cache-Control", isPublished ? "public, max-age=0, s-maxage=300, must-revalidate" : "private, no-store");
    return new Response(object.body, { headers });
  } catch (error) {
    console.error("[member-media:read]", String(error?.message || error));
    return new Response("Gambar tidak tersedia.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
