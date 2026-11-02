import { getMember, sameOrigin, xenditAuth } from "../../_shared/member-billing.js";

const enc = new TextEncoder();
function from64(value) {
  value = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (value.length % 4) value += "=";
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}
async function verifyPassword(password, saltText, hashText) {
  try {
    const actual = await passwordHash(password, from64(saltText));
    const expected = from64(hashText);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let index = 0; index < actual.length; index++) difference |= actual[index] ^ expected[index];
    return difference === 0;
  } catch { return false; }
}
async function eraseMemberMedia(bucket, memberId) {
  if (!bucket) return;
  try {
    const keys = [];
    let cursor;
    let hasMore = true;
    while (hasMore) {
      const listed = await bucket.list({ prefix: String(memberId) + "/", limit: 1000, cursor });
      keys.push(...(listed.objects || []).map(object => object.key));
      hasMore = !!listed.truncated;
      cursor = listed.cursor;
    }
    for (let offset = 0; offset < keys.length; offset += 1000) await bucket.delete(keys.slice(offset, offset + 1000));
  } catch (error) {
    console.error("[account:delete:media]", String(error?.message || error));
  }
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return Response.json({ error: "Origin tidak valid." }, { status: 403 });
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  let body;
  try { body = await request.json(); } catch { return Response.json({ error: "Konfirmasi penghapusan tidak valid." }, { status: 400 }); }
  if (body?.confirmation !== "HAPUS AKUN") return Response.json({ error: "Ketik HAPUS AKUN persis seperti yang diminta." }, { status: 400 });

  try {
    const session = await getMember(request, env);
    if (!session) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const member = await env.DB.prepare("SELECT id,password_salt,password_hash FROM members WHERE id=?").bind(session.id).first();
    if (!member || !await verifyPassword(String(body.current_password || ""), member.password_salt, member.password_hash)) {
      return Response.json({ error: "Password saat ini salah." }, { status: 401 });
    }

    const subscriptions = await env.DB.prepare(
      "SELECT id,provider_plan_id,status,checkout_expires_at FROM member_subscriptions WHERE member_id=? AND status IN ('pending','active','past_due') ORDER BY created_at DESC"
    ).bind(member.id).all();
    const now = Date.now();
    const rows = subscriptions.results || [];
    const openCheckout = rows.find(row => !row.provider_plan_id && Number(row.checkout_expires_at || 0) > now);
    if (openCheckout) {
      return Response.json({ error: "Checkout Xendit masih terbuka. Selesaikan atau tunggu sampai checkout kedaluwarsa sebelum menghapus akun." }, { status: 409 });
    }
    const recurring = rows.filter(row => row.provider_plan_id);
    if (recurring.length && !env.XENDIT_SECRET_KEY) {
      return Response.json({ error: "Langganan aktif belum bisa dibatalkan karena pembayaran belum dikonfigurasi." }, { status: 503 });
    }
    for (const subscription of recurring) {
      const response = await fetch("https://api.xendit.co/recurring/plans/" + encodeURIComponent(subscription.provider_plan_id) + "/deactivate", {
        method: "POST",
        headers: { Authorization: xenditAuth(env), "api-version": "2026-01-01" }
      });
      if (!response.ok) {
        console.error("[account:delete:subscription]", response.status);
        return Response.json({ error: "Langganan belum berhasil dibatalkan. Akun belum dihapus; coba lagi sebentar." }, { status: 502 });
      }
      await env.DB.prepare("UPDATE member_subscriptions SET status='cancelled',updated_at=? WHERE id=? AND member_id=?")
        .bind(Date.now(), subscription.id, member.id).run();
    }

    const pendingWithoutCheckout = rows.filter(row => !row.provider_plan_id && !row.checkout_expires_at);
    for (const subscription of pendingWithoutCheckout) {
      await env.DB.prepare("UPDATE member_subscriptions SET status='expired',updated_at=? WHERE id=? AND member_id=?")
        .bind(Date.now(), subscription.id, member.id).run();
    }

    await env.DB.prepare("DELETE FROM members WHERE id=?").bind(member.id).run();
    await eraseMemberMedia(env.MEDIA, member.id);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json", "Set-Cookie": "sf_member=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0" } });
  } catch (error) {
    console.error("[account:delete]", String(error?.message || error));
    const message = String(error?.message || error);
    if (["members", "member_sessions", "member_subscriptions"].some(table => message.includes("no such table: " + table))) {
      return Response.json({ error: "Penghapusan akun belum siap. Jalankan schema.sql dan admin-schema.sql terbaru di D1." }, { status: 503 });
    }
    return Response.json({ error: "Akun gagal dihapus." }, { status: 500 });
  }
}
