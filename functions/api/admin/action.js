const enc=new TextEncoder();
function decode(s){s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),c=>c.charCodeAt(0))}
async function actor(request){try{const t=(request.headers.get('Cookie')||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('sf_admin='))?.slice(9),p=t?.split('.')[0];return p?JSON.parse(new TextDecoder().decode(decode(p))).email:'admin'}catch{return 'admin'}}
function sameOrigin(request){const origin=request.headers.get('Origin');return !origin||origin===new URL(request.url).origin}
async function audit(env,who,action,targetType,targetId,reason,now){await env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who,action,targetType,targetId,reason||null,now).run()}
function jsonError(error,status,extra={}){return Response.json({error,...extra},{status})}
function b64(bytes){let value='';for(const byte of new Uint8Array(bytes))value+=String.fromCharCode(byte);return btoa(value).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_')}
async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);return b64(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:100000},key,256))}
function amountValid(amount,currency){return Number.isFinite(amount)&&amount>=0&&(currency==='IDR'?Number.isInteger(amount):Math.round(amount*100)===amount*100)}
export async function onRequestPost({request,env}){
  if(!env.DB)return jsonError('D1 binding DB belum dipasang.',503);
  if(!sameOrigin(request))return jsonError('Origin tidak valid.',403);
  let b;try{b=await request.json()}catch{return jsonError('Data tidak valid.',400)}
  const now=Date.now(),who=await actor(request);
  try{
    if(b.action==='site-disable'||b.action==='site-restore'){
      if(!b.id)return jsonError('ID situs wajib.',400);
      const current=await env.DB.prepare('SELECT status FROM sites WHERE id=?').bind(b.id).first();
      if(!current)return jsonError('Website tidak ditemukan.',404);
      if(b.action==='site-disable'&&current.status!=='published')return jsonError('Hanya website yang sudah live bisa dinonaktifkan.',409);
      if(b.action==='site-restore'&&current.status!=='disabled')return jsonError('Website ini tidak sedang dinonaktifkan.',409);
      const status=b.action==='site-disable'?'disabled':'published';
      await env.DB.batch([
        env.DB.prepare('UPDATE sites SET status=?,disabled_reason=?,updated_at=? WHERE id=?').bind(status,b.action==='site-disable'?String(b.reason||'Ditinjau admin').slice(0,300):null,now,b.id),
        env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who,b.action,'site',b.id,b.reason||null,now)
      ]);
    }else if(b.action==='member-suspend'||b.action==='member-restore'){
      if(!b.id)return jsonError('ID member wajib.',400);
      const member=await env.DB.prepare('SELECT id FROM members WHERE id=?').bind(b.id).first();
      if(!member)return jsonError('Member tidak ditemukan.',404);
      const status=b.action==='member-suspend'?'suspended':'active',reason=status==='suspended'?String(b.reason||'Ditinjau admin').slice(0,300):null;
      const batch=[env.DB.prepare("INSERT INTO member_admin_status (member_id,status,reason,updated_at) VALUES (?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET status=excluded.status,reason=excluded.reason,updated_at=excluded.updated_at").bind(b.id,status,reason,now)];
      if(status==='suspended')batch.push(env.DB.prepare('DELETE FROM member_sessions WHERE member_id=?').bind(b.id));
      batch.push(env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who,b.action,'member',b.id,reason,now));
      await env.DB.batch(batch);
    }else if(b.action==='report-review'){
      if(!b.id)return jsonError('ID laporan wajib.',400);
      const result=await env.DB.prepare("UPDATE abuse_reports SET status='reviewed',reviewed_by=?,reviewed_at=? WHERE id=? AND status='open'").bind(who,now,b.id).run();
      if(!result.meta?.changes)return jsonError('Laporan tidak ditemukan atau sudah ditinjau.',404);
      await audit(env,who,b.action,'report',b.id,null,now);
    }else if(b.action==='member-password-set'){
      const memberId=String(b.member_id||'');
      if(!memberId)return jsonError('ID member wajib.',400);
      if(typeof b.password!=='string')return jsonError('Password baru tidak valid.',400);
      const password=b.password;
      if(password.length<12||password.length>256)return jsonError('Password baru harus 12 sampai 256 karakter.',400);
      const member=await env.DB.prepare('SELECT id FROM members WHERE id=?').bind(memberId).first();
      if(!member)return jsonError('Member tidak ditemukan.',404);
      const salt=crypto.getRandomValues(new Uint8Array(16));
      const saltText=b64(salt);
      const hash=await passwordHash(password,salt);
      await env.DB.batch([
        env.DB.prepare('UPDATE members SET password_salt=?,password_hash=? WHERE id=?').bind(saltText,hash,memberId),
        env.DB.prepare('DELETE FROM member_sessions WHERE member_id=?').bind(memberId),
        env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who,b.action,'member',memberId,'Password diganti admin; seluruh sesi member dicabut',now)
      ]);
    }else if(b.action==='plan-save'){
      const code=String(b.code||'').trim().toLowerCase();
      const name=String(b.name||'').trim().slice(0,60);
      const description=String(b.description||'').trim().slice(0,180);
      const country=String(b.country||'ID').trim().toUpperCase();
      const currency=country==='MY'?'MYR':'IDR';
      const amount=Number(b.amount);
      const siteLimit=Number(b.site_limit);
      const active=b.is_active===true||Number(b.is_active)===1;
      if(!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code))return jsonError('Kode paket hanya boleh memakai huruf kecil, angka, strip, dan garis bawah.',400);
      if(name.length<2)return jsonError('Nama paket minimal 2 karakter.',400);
      if(!Number.isInteger(siteLimit)||siteLimit<1||siteLimit>100)return jsonError('Kuota website harus antara 1 sampai 100.',400);
      if(!['ID','MY'].includes(country)||!amountValid(amount,currency))return jsonError('Harga atau mata uang paket tidak valid.',400);
      if(code==='free'&&(amount!==0||!active))return jsonError('Paket Gratis harus aktif dan tidak berbayar.',400);
      if(code!=='free'&&active&&amount<=0)return jsonError('Paket aktif harus memiliki harga di atas nol.',400);
      const interval=code==='free'?'FREE':'MONTH';
      let sortOrder=Number(b.sort_order);
      if(!Number.isFinite(sortOrder)){const current=await env.DB.prepare('SELECT sort_order FROM subscription_plans WHERE code=?').bind(code).first();if(current)sortOrder=Number(current.sort_order)||0;else{const max=await env.DB.prepare('SELECT MAX(sort_order) AS n FROM subscription_plans').first();sortOrder=Number(max?.n||0)+10}}
      await env.DB.batch([
        env.DB.prepare("INSERT INTO subscription_plans (code,name,description,amount,currency,country,billing_interval,site_limit,is_active,sort_order,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,amount=excluded.amount,currency=excluded.currency,country=excluded.country,billing_interval=excluded.billing_interval,site_limit=excluded.site_limit,is_active=excluded.is_active,sort_order=excluded.sort_order,updated_at=excluded.updated_at")
          .bind(code,name,description,amount,currency,country,interval,siteLimit,active?1:0,sortOrder,now,now),
        env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who,b.action,'package',code,String(b.reason||name).slice(0,300),now)
      ]);
    }else if(b.action==='member-plan-set'){
      const memberId=String(b.member_id||'');
      const planCode=String(b.plan_code||'').trim().toLowerCase();
      if(!memberId||!planCode)return jsonError('Member dan paket wajib dipilih.',400);
      const member=await env.DB.prepare('SELECT id FROM members WHERE id=?').bind(memberId).first();
      if(!member)return jsonError('Member tidak ditemukan.',404);
      const plan=await env.DB.prepare('SELECT code,name FROM subscription_plans WHERE code=?').bind(planCode).first();
      if(!plan)return jsonError('Paket tidak ditemukan.',404);
      let endsAt=null;
      if(b.ends_at){
        if(!/^\d{4}-\d{2}-\d{2}$/.test(String(b.ends_at)))return jsonError('Tanggal akhir tidak valid.',400);
        endsAt=Date.parse(String(b.ends_at)+'T23:59:59Z');
        if(!Number.isFinite(endsAt)||endsAt<=now)return jsonError('Tanggal akhir harus berada di masa depan.',400);
      }
      const provider=await env.DB.prepare("SELECT id,provider_plan_id FROM member_subscriptions WHERE member_id=? AND provider_plan_id IS NOT NULL AND status IN ('pending','active','past_due') ORDER BY updated_at DESC LIMIT 1").bind(memberId).first();
      if(provider){
        if(b.cancel_recurring!==true)return jsonError('Member masih memiliki tagihan Xendit. Centang opsi pembatalan tagihan sebelum mengubah paket.',409,{code:'ACTIVE_XENDIT_SUBSCRIPTION'});
        if(!env.XENDIT_SECRET_KEY)return jsonError('Xendit belum dikonfigurasi, tagihan otomatis tidak dapat dibatalkan.',503);
        const response=await fetch('https://api.xendit.co/recurring/plans/'+encodeURIComponent(provider.provider_plan_id)+'/deactivate',{method:'POST',headers:{Authorization:'Basic '+btoa(String(env.XENDIT_SECRET_KEY)+':'),'api-version':'2026-01-01'}});
        let result={};try{result=await response.json()}catch{}
        if(!response.ok){console.error('[admin-member-plan:cancel]',response.status,result?.error_code||'deactivation_failed');return jsonError('Tagihan otomatis Xendit gagal dibatalkan. Paket member belum diubah.',502)}
        const providerUpdatedAt=Date.parse(result.updated||'')||now;
        await env.DB.prepare("UPDATE member_subscriptions SET status='cancelled',provider_updated_at=MAX(provider_updated_at,?),updated_at=? WHERE id=?").bind(providerUpdatedAt,now,provider.id).run();
      }
      const reason=String(b.reason||'Paket diatur admin').trim().slice(0,300);
      await env.DB.batch([
        env.DB.prepare('INSERT INTO member_plan_assignments (member_id,plan_code,ends_at,reason,assigned_by,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(member_id) DO UPDATE SET plan_code=excluded.plan_code,ends_at=excluded.ends_at,reason=excluded.reason,assigned_by=excluded.assigned_by,updated_at=excluded.updated_at').bind(memberId,planCode,endsAt,reason,who,now),
        env.DB.prepare('INSERT INTO admin_audit_events (id,actor_email,action,target_type,target_id,reason,created_at) VALUES (?,?,?,?,?,?,?)').bind(crypto.randomUUID(),who,b.action,'member',memberId,reason+' → '+planCode,now)
      ]);
    }else if(b.action==='member-plan-clear'){
      const memberId=String(b.member_id||'');
      if(!memberId)return jsonError('ID member wajib.',400);
      const result=await env.DB.prepare('DELETE FROM member_plan_assignments WHERE member_id=?').bind(memberId).run();
      if(!result.meta?.changes)return jsonError('Paket manual member tidak ditemukan.',404);
      await audit(env,who,b.action,'member',memberId,'Paket manual dihapus',now);
    }else return jsonError('Aksi tidak dikenal.',400);
    return Response.json({ok:true});
  }catch(error){
    console.error('[admin-action]',error);
    const message=String(error?.message||error);
    if(['subscription_plans','member_plan_assignments'].some(table=>message.includes('no such table: '+table)))return jsonError('Paket member belum disiapkan. Jalankan ulang admin-schema.sql di D1.',503);
    return jsonError('Aksi gagal. Jalankan ulang admin-schema.sql versi terbaru dan periksa targetnya.',503);
  }
}