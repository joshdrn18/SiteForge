const enc=new TextEncoder();
const reserved=new Set(["account","admin","api","builder","dashboard","siteforge","assets","favicon"]);

function b64(bytes){let s="";for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
async function memberId(request,env){
  const token=(request.headers.get("Cookie")||"").split(";").map(v=>v.trim()).find(v=>v.startsWith("sf_member="))?.slice(10);
  if(!token||!env.DB)return null;
  const row=await env.DB.prepare("SELECT member_id FROM member_sessions WHERE token_hash=? AND expires_at>?").bind(b64(await crypto.subtle.digest("SHA-256",enc.encode(token))),Date.now()).first();
  return row?.member_id||null;
}
function sameOrigin(request){const origin=request.headers.get("Origin");return !origin||origin===new URL(request.url).origin}
function normalizeSlug(value){return String(value||"").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}
function inputData(body){
  const name=String(body.name||"").trim().slice(0,60);
  const slug=normalizeSlug(body.slug||name);
  if(name.length<2)return {error:"Nama website minimal 2 karakter."};
  if(!slug||slug.length>48||reserved.has(slug)||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))return {error:"Slug website tidak valid atau sudah dicadangkan."};
  const content=body.content&&typeof body.content==="object"&&!Array.isArray(body.content)?body.content:{};
  const contentJson=JSON.stringify(content);
  if(enc.encode(contentJson).length>1700000)return {error:"Draft terlalu besar. Kecilkan file gambar lalu simpan lagi."};
  return {name,slug,contentJson};
}
async function readJson(request){try{return await request.json()}catch{return null}}
function slugConflict(error){return String(error?.message||error).includes("UNIQUE constraint failed: sites.slug")}

export async function onRequestGet({request,env}){
  try{
    if(!env.DB)return Response.json({error:"Database belum dikonfigurasi."},{status:503});
    const ownerId=await memberId(request,env);
    if(!ownerId)return Response.json({error:"Sesi login tidak berlaku."},{status:401});
    const result=await env.DB.prepare("SELECT id,name,slug,status,created_at,updated_at FROM sites WHERE owner_id=? ORDER BY updated_at DESC").bind(ownerId).all();
    return Response.json({sites:result.results||[]});
  }catch(error){console.error("[member-sites:list]",error);return Response.json({error:"Gagal memuat website."},{status:500})}
}
export async function onRequestPost({request,env}){
  if(!sameOrigin(request))return Response.json({error:"Origin tidak valid."},{status:403});
  try{
    if(!env.DB)return Response.json({error:"Database belum dikonfigurasi."},{status:503});
    const ownerId=await memberId(request,env);
    if(!ownerId)return Response.json({error:"Sesi login tidak berlaku."},{status:401});
    const body=await readJson(request);
    if(!body)return Response.json({error:"Data website tidak valid."},{status:400});
    const site=inputData(body);
    if(site.error)return Response.json({error:site.error},{status:400});
    const id=crypto.randomUUID(),now=Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sites (id,owner_id,name,slug,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(id,ownerId,site.name,site.slug,"draft",now,now),
      env.DB.prepare("INSERT INTO site_content (site_id,content_json,updated_at) VALUES (?,?,?)").bind(id,site.contentJson,now)
    ]);
    return Response.json({site:{id,name:site.name,slug:site.slug,status:"draft",created_at:now,updated_at:now}},{status:201});
  }catch(error){
    console.error("[member-sites:create]",error);
    if(slugConflict(error))return Response.json({error:"Slug ini sudah dipakai. Coba alamat lain."},{status:409});
    const message=String(error?.message||error);
    if(message.includes("no such table: site_content"))return Response.json({error:"Penyimpanan draft belum disiapkan. Jalankan ulang admin-schema.sql di D1."},{status:503});
    return Response.json({error:"Gagal menyimpan draft website."},{status:500});
  }
}
