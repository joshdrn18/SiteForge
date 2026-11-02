const enc=new TextEncoder();
function b64(bytes){let s='';for(const b of new Uint8Array(bytes))s+=String.fromCharCode(b);return btoa(s).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function sha(value){return b64(await crypto.subtle.digest('SHA-256',enc.encode(value)))}
export async function onRequestPost({request,env}){const value=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('sf_member='))?.slice(10);if(value&&env.DB)await env.DB.prepare('DELETE FROM member_sessions WHERE token_hash=?').bind(await sha(value)).run();return new Response(JSON.stringify({ok:true}),{headers:{'Content-Type':'application/json','Set-Cookie':'sf_member=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'}})}
