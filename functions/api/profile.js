const enc=new TextEncoder();
function b64(bytes){let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
function from64(value){value=value.replace(/-/g,'+').replace(/_/g,'/');while(value.length%4)value+='=';return Uint8Array.from(atob(value),c=>c.charCodeAt(0))}
async function sha(value){return b64(await crypto.subtle.digest('SHA-256',enc.encode(value)))}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256))}
function sameOrigin(request){const origin=request.headers.get('Origin');return !origin||origin===new URL(request.url).origin}
function token(request){return (request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('sf_member='))?.slice(10)}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0}
export async function onRequestPut({request,env}){
 if(!sameOrigin(request))return Response.json({error:'Origin tidak valid.'},{status:403});
 if(!env.DB)return Response.json({error:'Database member belum dikonfigurasi.'},{status:503});
 const sessionToken=token(request);
 if(!sessionToken)return Response.json({error:'Sesi login tidak berlaku.'},{status:401});
 let body;try{body=await request.json()}catch{return Response.json({error:'Data profil tidak valid.'},{status:400})}
 if(!body||typeof body!=='object'||Array.isArray(body))return Response.json({error:'Data profil tidak valid.'},{status:400});
 const currentPassword=typeof body.current_password==='string'?body.current_password:'';
 if(!currentPassword)return Response.json({error:'Masukkan password saat ini untuk menyimpan profil.'},{status:400});
 const name=typeof body.name==='string'?body.name.trim():'';
 const email=typeof body.email==='string'?body.email.trim().toLowerCase():'';
 if(name.length<2||name.length>60||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return Response.json({error:'Isi nama (2–60 karakter) dan email yang valid.'},{status:400});
 const hasNewPassword=typeof body.new_password==='string'&&body.new_password.length>0;
 if(body.new_password!==undefined&&typeof body.new_password!=='string')return Response.json({error:'Password baru tidak valid.'},{status:400});
 if(hasNewPassword&&(body.new_password.length<12||body.new_password.length>256))return Response.json({error:'Password baru harus 12 sampai 256 karakter.'},{status:400});
 try{
  const tokenHash=await sha(sessionToken),now=Date.now();
  const member=await env.DB.prepare('SELECT m.id,m.email,m.display_name,m.password_salt,m.password_hash FROM member_sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>?').bind(tokenHash,now).first();
  if(!member)return Response.json({error:'Sesi login tidak berlaku. Masuk kembali.'},{status:401});
  const actual=from64(await passwordHash(currentPassword,from64(member.password_salt))),expected=from64(member.password_hash);
  if(!equal(actual,expected))return Response.json({error:'Password saat ini salah.'},{status:401});
  const emailChanged=email!==member.email;
  const salt=hasNewPassword?crypto.getRandomValues(new Uint8Array(16)):from64(member.password_salt);
  const saltText=hasNewPassword?b64(salt):member.password_salt;
  const hash=hasNewPassword?await passwordHash(body.new_password,salt):member.password_hash;
  const statements=[env.DB.prepare('UPDATE members SET display_name=?,email=?,password_salt=?,password_hash=? WHERE id=?').bind(name,email,saltText,hash,member.id)];
  if(emailChanged||hasNewPassword)statements.push(env.DB.prepare('DELETE FROM member_sessions WHERE member_id=? AND token_hash<>?').bind(member.id,tokenHash));
  await env.DB.batch(statements);
  return Response.json({ok:true,user:{id:member.id,email,name}});
 }catch(error){
  const message=String(error?.message||error);
  if(message.includes('UNIQUE constraint failed: members.email'))return Response.json({error:'Email tersebut sudah dipakai akun lain.'},{status:409});
  if(['members','member_sessions'].some(table=>message.includes('no such table: '+table)))return Response.json({error:'Tabel akun belum siap. Jalankan schema.sql terbaru di D1.'},{status:503});
  console.error('[member-profile]',error);
  return Response.json({error:'Profil gagal disimpan.'},{status:500});
 }
}
