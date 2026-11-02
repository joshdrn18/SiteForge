const enc=new TextEncoder();
function decode(value){value=value.replace(/-/g,'+').replace(/_/g,'/');while(value.length%4)value+='=';return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
function b64(bytes){let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function hashPassword(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256))}
async function verifyPassword(password,saltText,hashText){try{const actual=await hashPassword(password,decode(saltText)),expected=decode(hashText);if(actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];return diff===0}catch{return false}}
function cookie(value){return 'sf_admin='+value+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800'}
function freshVersion(){const value=crypto.getRandomValues(new Uint32Array(2));return ((value[0]&0xffff)*4294967296+value[1])||1}
async function issueToken(email,version,secret){const payloadObject={email,exp:Date.now()+8*60*60*1000};if(version!==null)payloadObject.ver=version;const payload=b64(enc.encode(JSON.stringify(payloadObject)));const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=b64(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));return payload+'.'+signature}
function splitBootstrap(env){if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD_HASH)return null;const parts=String(env.ADMIN_PASSWORD_HASH).trim().split('.');if(parts.length!==2||!/^[-_A-Za-z0-9]{22}$/.test(parts[0])||!/^[-_A-Za-z0-9]{43}$/.test(parts[1]))return null;return {email:String(env.ADMIN_EMAIL).trim().toLowerCase(),salt:parts[0],hash:parts[1]}}
export async function onRequestPost({request,env}){
 const origin=request.headers.get('Origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Origin tidak valid.'},{status:403});
 if(!env.SESSION_SECRET)return Response.json({error:'SESSION_SECRET belum dikonfigurasi di Cloudflare.'},{status:503});
 let body;try{body=await request.json()}catch{return Response.json({error:'Request tidak valid.'},{status:400})}
 if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Request tidak valid.'},{status:400});
 const email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
 if(!email||!password)return Response.json({error:'Email atau password salah.'},{status:401});
 try{
  let account=null,tableAvailable=!!env.DB;
  if(env.DB){try{account=await env.DB.prepare("SELECT id,email,display_name,password_salt,password_hash,session_version FROM admin_accounts WHERE id='master'").first()}catch(error){if(String(error?.message||error).includes('no such table: admin_accounts'))tableAvailable=false;else throw error}}
  if(account){
   if(email!==String(account.email).trim().toLowerCase()||!await verifyPassword(password,account.password_salt,account.password_hash))return Response.json({error:'Email atau password salah.'},{status:401});
  }else{
   const bootstrap=splitBootstrap(env);
   if(!bootstrap)return Response.json({error:'Admin belum punya profil. Periksa secret ADMIN_EMAIL dan ADMIN_PASSWORD_HASH.'},{status:503});
   if(email!==bootstrap.email||!await verifyPassword(password,bootstrap.salt,bootstrap.hash))return Response.json({error:'Email atau password salah.'},{status:401});
   if(env.DB&&tableAvailable){
    const now=Date.now();
    await env.DB.prepare("INSERT OR IGNORE INTO admin_accounts (id,email,display_name,password_salt,password_hash,session_version,created_at,updated_at) VALUES ('master',?,'Master Admin',?,?,?, ?,?)").bind(bootstrap.email,bootstrap.salt,bootstrap.hash,freshVersion(),now,now).run();
    account=await env.DB.prepare("SELECT id,email,display_name,password_salt,password_hash,session_version FROM admin_accounts WHERE id='master'").first();
    if(!account||email!==String(account.email).trim().toLowerCase()||!await verifyPassword(password,account.password_salt,account.password_hash))return Response.json({error:'Email atau password salah.'},{status:401});
   }
  }
  const activeEmail=account?String(account.email).trim().toLowerCase():email;
  const version=account?Number(account.session_version)||1:null;
  const token=await issueToken(activeEmail,version,String(env.SESSION_SECRET));
  return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':cookie(token)}});
 }catch(error){console.error('[admin-login]',error);return Response.json({error:'Login admin gagal. Periksa D1 dan konfigurasi admin.'},{status:500})}
}
