const enc=new TextEncoder();
function decode(value){value=value.replace(/-/g,'+').replace(/_/g,'/');while(value.length%4)value+='=';return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
function b64(bytes){let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function token(request){return (request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('sf_admin='))?.slice(9)}
function tokenData(request){try{const payload=token(request)?.split('.')[0];return payload?JSON.parse(new TextDecoder().decode(decode(payload))):null}catch{return null}}
function sameOrigin(request){const origin=request.headers.get('Origin');return !origin||origin===new URL(request.url).origin}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256))}
async function verifyPassword(password,saltText,hashText){try{const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']),actual=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:decode(saltText),iterations:100000},key,256)),expected=decode(hashText);if(actual.length!==expected.length)return false;let diff=0;for(let i=0;i<actual.length;i++)diff|=actual[i]^expected[i];return diff===0}catch{return false}}
function bootstrap(env){if(!env.ADMIN_EMAIL||!env.ADMIN_PASSWORD_HASH)return null;const parts=String(env.ADMIN_PASSWORD_HASH).trim().split('.');if(parts.length!==2||!/^[-_A-Za-z0-9]{22}$/.test(parts[0])||!/^[-_A-Za-z0-9]{43}$/.test(parts[1]))return null;return {email:String(env.ADMIN_EMAIL).trim().toLowerCase(),salt:parts[0],hash:parts[1]}}
async function ensureAccount(env,request){let account=await env.DB.prepare("SELECT id,email,display_name,password_salt,password_hash,session_version FROM admin_accounts WHERE id='master'").first();if(account)return account;const initial=bootstrap(env),session=tokenData(request);if(!initial||String(session?.email||'').trim().toLowerCase()!==initial.email)throw new Error('Admin belum disiapkan. Masuk kembali dengan kredensial Pages.');const now=Date.now();await env.DB.prepare("INSERT OR IGNORE INTO admin_accounts (id,email,display_name,password_salt,password_hash,session_version,created_at,updated_at) VALUES ('master',?,'Master Admin',?,?,?, ?,?)").bind(initial.email,initial.salt,initial.hash,freshVersion(),now,now).run();account=await env.DB.prepare("SELECT id,email,display_name,password_salt,password_hash,session_version FROM admin_accounts WHERE id='master'").first();if(!account)throw new Error('Profil master admin gagal disiapkan.');return account}
async function signToken(email,version,secret){const payload=b64(enc.encode(JSON.stringify({email,exp:Date.now()+8*60*60*1000,ver:version})));const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=b64(await crypto.subtle.sign('HMAC',key,enc.encode(payload)));return payload+'.'+signature}
async function sessionCookie(email,version,env){return 'sf_admin='+await signToken(email,version,String(env.SESSION_SECRET||''))+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800'}
function freshVersion(){const value=crypto.getRandomValues(new Uint32Array(2));return ((value[0]&0xffff)*4294967296+value[1])||1}
function schemaError(error){return String(error?.message||error).includes('no such table: admin_accounts')}
export async function onRequestGet({request,env}){
 if(!env.DB)return Response.json({error:'D1 belum dipasang.'},{status:503});
 try{
  const account=await ensureAccount(env,request),session=tokenData(request),version=Number(account.session_version)||1;
  const headers=new Headers({'Content-Type':'application/json'});
  if(String(session?.email||'').trim().toLowerCase()!==String(account.email).trim().toLowerCase()||Number(session?.ver)!==version)headers.set('Set-Cookie',await sessionCookie(account.email,version,env));
  return new Response(JSON.stringify({profile:{email:account.email,display_name:account.display_name}}),{headers});
 }catch(error){if(schemaError(error))return Response.json({error:'Profil admin belum disiapkan. Jalankan ulang admin-schema.sql terbaru di D1.'},{status:503});console.error('[admin-profile:get]',String(error?.message||error));return Response.json({error:String(error?.message||'Profil admin gagal dimuat.')},{status:503})}
}
export async function onRequestPut({request,env}){
 if(!sameOrigin(request))return Response.json({error:'Origin tidak valid.'},{status:403});
 if(!env.DB)return Response.json({error:'D1 belum dipasang.'},{status:503});
 let body;try{body=await request.json()}catch{return Response.json({error:'Data profil tidak valid.'},{status:400})}
 if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Data profil tidak valid.'},{status:400});
 if(typeof body.current_password!=='string'||!body.current_password)return Response.json({error:'Masukkan password saat ini.'},{status:400});
 const name=typeof body.display_name==='string'?body.display_name.trim():'';
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 if(name.length<2||name.length>60||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return Response.json({error:'Isi nama (2–60 karakter) dan email yang valid.'},{status:400});
 if(body.new_password!==undefined&&typeof body.new_password!=='string')return Response.json({error:'Password baru tidak valid.'},{status:400});
 const hasNewPassword=typeof body.new_password==='string'&&body.new_password.length>0;
 if(hasNewPassword&&(body.new_password.length<12||body.new_password.length>256))return Response.json({error:'Password baru harus 12 sampai 256 karakter.'},{status:400});
 try{
  const account=await ensureAccount(env,request);
  if(!await verifyPassword(body.current_password,account.password_salt,account.password_hash))return Response.json({error:'Password saat ini salah.'},{status:401});
  const emailChanged=email!==String(account.email).trim().toLowerCase(),nameChanged=name!==account.display_name;
  const salt=hasNewPassword?crypto.getRandomValues(new Uint8Array(16)):decode(account.password_salt);
  const saltText=hasNewPassword?b64(salt):account.password_salt;
  const hash=hasNewPassword?await passwordHash(body.new_password,salt):account.password_hash;
  const authChanged=emailChanged||hasNewPassword,version=(Number(account.session_version)||1)+(authChanged?1:0),now=Date.now();
  if(emailChanged||nameChanged||hasNewPassword){
   const changed=[];if(nameChanged)changed.push('display_name');if(emailChanged)changed.push('email');if(hasNewPassword)changed.push('password');const reason=changed.join(', ');
   await env.DB.batch([
    env.DB.prepare("UPDATE admin_accounts SET email=?,display_name=?,password_salt=?,password_hash=?,session_version=session_version+?,updated_at=? WHERE id='master'").bind(email,name,saltText,hash,authChanged?1:0,now),
    env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),account.email,'admin-profile-update','admin','master',reason,now)
   ]);
  }
  const cookieValue=await sessionCookie(email,version,env);
  return new Response(JSON.stringify({ok:true,profile:{email,display_name:name}}),{headers:{'Content-Type':'application/json','Set-Cookie':cookieValue}});
 }catch(error){
  if(schemaError(error))return Response.json({error:'Profil admin belum disiapkan. Jalankan ulang admin-schema.sql terbaru di D1.'},{status:503});
  if(String(error?.message||error).includes('UNIQUE constraint failed: admin_accounts.email'))return Response.json({error:'Email tersebut sudah dipakai.'},{status:409});
  console.error('[admin-profile:update]',String(error?.message||error));
  return Response.json({error:'Profil admin gagal disimpan.'},{status:500});
 }
}
