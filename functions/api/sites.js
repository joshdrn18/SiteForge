import { FREE_SITE_LIMIT, PRO_SITE_LIMIT, getMember, getMemberPlan, sameOrigin } from "../_shared/member-billing.js";
const enc=new TextEncoder();
const reserved=new Set(["account","admin","api","builder","dashboard","siteforge","assets","favicon"]);

function b64(bytes){let s="";for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_")}
async function consumeIpLimit(env,request,action,limit){
  const ip=(request.headers.get("CF-Connecting-IP")||"").trim();
  if(!ip)return {allowed:true,attempts:0};
  const day=Math.floor(Date.now()/86400000),ipHash=await digestIp(day+"|"+ip),now=Date.now();
  const row=await env.DB.prepare("INSERT INTO ip_rate_limits (action,ip_hash,window_start,attempts,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(action,ip_hash) DO UPDATE SET attempts=ip_rate_limits.attempts+1,updated_at=excluded.updated_at RETURNING attempts").bind(action,ipHash,day,1,now).first();
  const attempts=Number(row?.attempts||0);
  if(attempts===1)await env.DB.prepare("DELETE FROM ip_rate_limits WHERE window_start<?").bind(day-7).run();
  return {allowed:attempts>0&&attempts<=limit,attempts};
}
async function digestIp(value){return b64(await crypto.subtle.digest("SHA-256",enc.encode(value)))}
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
    const member=await getMember(request,env);
    if(!member)return Response.json({error:"Sesi login tidak berlaku."},{status:401});
    const plan=await getMemberPlan(env,member.id);
    const result=await env.DB.prepare("SELECT id,name,slug,status,created_at,updated_at FROM sites WHERE owner_id=? ORDER BY updated_at DESC").bind(member.id).all();
    return Response.json({sites:result.results||[],...plan});
  }catch(error){console.error("[member-sites:list]",error);if(String(error?.message||error).includes("no such table: member_subscriptions"))return Response.json({error:"Langganan belum disiapkan. Jalankan ulang admin-schema.sql di D1."},{status:503});return Response.json({error:"Gagal memuat website."},{status:500})}
}
export async function onRequestPost({request,env}){
  if(!sameOrigin(request))return Response.json({error:"Origin tidak valid."},{status:403});
  try{
    if(!env.DB)return Response.json({error:"Database belum dikonfigurasi."},{status:503});
    const member=await getMember(request,env);
    if(!member)return Response.json({error:"Sesi login tidak berlaku."},{status:401});
    const ownerId=member.id;
    const plan=await getMemberPlan(env,ownerId);
    const body=await readJson(request);
    if(!body)return Response.json({error:"Data website tidak valid."},{status:400});
    const site=inputData(body);
    if(site.error)return Response.json({error:site.error},{status:400});
    const currentUsage=await env.DB.prepare("SELECT COUNT(*) AS count FROM sites WHERE owner_id=?").bind(ownerId).first();
    if(Number(currentUsage?.count||0)>=plan.siteLimit)return Response.json({error:plan.plan==="pro"?"Kuota Pro sudah penuh.":"Paket gratis hanya boleh menyimpan maksimal 2 website. Upgrade Pro untuk membuat lebih banyak.",code:plan.plan==="pro"?"PRO_SITE_LIMIT":"FREE_SITE_LIMIT",plan:plan.plan,siteCount:Number(currentUsage?.count||0),siteLimit:plan.siteLimit},{status:409});
    const createLimit=await consumeIpLimit(env,request,"site-create",10);
    if(!createLimit.allowed)return Response.json({error:"Terlalu banyak website baru dari jaringan ini hari ini. Coba lagi besok."},{status:429});
    const id=crypto.randomUUID(),now=Date.now();
    const result=await env.DB.batch([
      env.DB.prepare("INSERT INTO sites (id,owner_id,name,slug,status,created_at,updated_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM sites WHERE owner_id=?) < CASE WHEN EXISTS (SELECT 1 FROM member_subscriptions WHERE member_id=? AND current_period_end>?) THEN ? ELSE ? END").bind(id,ownerId,site.name,site.slug,"draft",now,now,ownerId,ownerId,now,PRO_SITE_LIMIT,FREE_SITE_LIMIT),
      env.DB.prepare("INSERT INTO site_content (site_id,content_json,updated_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM sites WHERE id=? AND owner_id=?)").bind(id,site.contentJson,now,id,ownerId)
    ]);
    if(!result[0]?.meta?.changes){const usage=await env.DB.prepare("SELECT COUNT(*) AS count FROM sites WHERE owner_id=?").bind(ownerId).first();const currentPlan=await getMemberPlan(env,ownerId);return Response.json({error:currentPlan.plan==="pro"?"Kuota Pro sudah penuh.":"Paket gratis hanya boleh menyimpan maksimal 2 website. Upgrade Pro untuk membuat lebih banyak.",code:currentPlan.plan==="pro"?"PRO_SITE_LIMIT":"FREE_SITE_LIMIT",plan:currentPlan.plan,siteCount:Number(usage?.count||0),siteLimit:currentPlan.siteLimit},{status:409})}
    const finalUsage=await env.DB.prepare("SELECT COUNT(*) AS count FROM sites WHERE owner_id=?").bind(ownerId).first();
    const currentPlan=await getMemberPlan(env,ownerId);
    return Response.json({site:{id,name:site.name,slug:site.slug,status:"draft",created_at:now,updated_at:now},...currentPlan,siteCount:Number(finalUsage?.count||0)},{status:201});
  }catch(error){
    console.error("[member-sites:create]",error);
    if(slugConflict(error))return Response.json({error:"Slug ini sudah dipakai. Coba alamat lain."},{status:409});
    const message=String(error?.message||error);
    if(message.includes("no such table: member_subscriptions"))return Response.json({error:"Langganan belum disiapkan. Jalankan ulang admin-schema.sql di D1."},{status:503});
    if(message.includes("no such table: ip_rate_limits"))return Response.json({error:"Batas pembuatan website belum disiapkan. Jalankan ulang admin-schema.sql di D1."},{status:503});
    if(message.includes("no such table: site_content"))return Response.json({error:"Penyimpanan draft belum disiapkan. Jalankan ulang admin-schema.sql di D1."},{status:503});
    return Response.json({error:"Gagal menyimpan draft website."},{status:500});
  }
}
