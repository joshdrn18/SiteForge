const enc = new TextEncoder();

function b64(bytes) {
  let value = "";
  for (const byte of new Uint8Array(bytes)) value += String.fromCharCode(byte);
  return btoa(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return b64(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256));
}

async function sha(value) {
  return b64(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}

async function consumeIpLimit(env,request,limit){
  const ip=(request.headers.get("CF-Connecting-IP")||"").trim();
  if(!ip)return {allowed:true,attempts:0};
  const day=Math.floor(Date.now()/86400000),ipHash=await sha(day+"|"+ip),now=Date.now();
  const row=await env.DB.prepare("INSERT INTO ip_rate_limits (action,ip_hash,window_start,attempts,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(action,ip_hash) DO UPDATE SET attempts=ip_rate_limits.attempts+1,updated_at=excluded.updated_at RETURNING attempts").bind("signup",ipHash,day,1,now).first();
  const attempts=Number(row?.attempts||0);
  if(attempts===1)await env.DB.prepare("DELETE FROM ip_rate_limits WHERE window_start<?").bind(day-7).run();
  return {allowed:attempts>0&&attempts<=limit,attempts};
}

function cookie(value, maxAge) {
  return "sf_member=" + value + "; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=" + maxAge;
}

function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return !origin || origin === new URL(request.url).origin;
}

export async function onRequestPost({ request, env }) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Origin tidak valid." }, { status: 403 });
    if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });

    let body;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Data tidak valid." }, { status: 400 });
    }

    const name = String(body.name || "").trim().slice(0, 60);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
      return Response.json({ error: "Isi nama, email valid, dan password minimal 12 karakter." }, { status: 400 });
    }

    let signupLimit;
    try { signupLimit=await consumeIpLimit(env,request,5); }
    catch(error) {
      if(String(error?.message||error).includes("no such table: ip_rate_limits"))return Response.json({error:"Proteksi pendaftaran belum disiapkan. Jalankan ulang admin-schema.sql di D1."},{status:503});
      throw error;
    }
    if(!signupLimit.allowed)return Response.json({error:"Terlalu banyak akun baru dari jaringan ini hari ini. Coba lagi besok."},{status:429});

    const salt = crypto.getRandomValues(new Uint8Array(16));
    const saltText = b64(salt);
    const hash = await passwordHash(password, salt);
    const now = Date.now();
    const id = crypto.randomUUID();
    const token = b64(crypto.getRandomValues(new Uint8Array(32)));
    const expires = now + 30 * 24 * 60 * 60 * 1000;

    try {
      await env.DB.prepare("INSERT INTO members (id,email,display_name,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?)")
        .bind(id, email, name, saltText, hash, now).run();
      await env.DB.prepare("INSERT INTO member_sessions (token_hash,member_id,expires_at,created_at) VALUES (?,?,?,?)")
        .bind(await sha(token), id, expires, now).run();
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes("UNIQUE constraint failed: members.email")) {
        return Response.json({ error: "Email ini sudah terdaftar. Silakan masuk." }, { status: 409 });
      }
      console.error("[member-register:database]", error);
      return Response.json({ error: "Database gagal menyimpan akun. Periksa tabel members dan member_sessions di D1." }, { status: 500 });
    }

    return new Response(JSON.stringify({ ok: true, user: { id, email, name } }), {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": cookie(token, 30 * 24 * 60 * 60)
      }
    });
  } catch (error) {
    console.error("[member-register]", error);
    return Response.json({ error: "Pendaftaran gagal karena kesalahan internal server." }, { status: 500 });
  }
}
