export async function onRequestGet({env}){if(!env.DB)return Response.json({error:'D1 binding DB belum dipasang.'},{status:503});const db=env.DB;try{const [members,published,deploys,reports,queue,failed,recentSites,recentReports,activity]=await Promise.all([
db.prepare('SELECT COUNT(*) AS n FROM members').first(),
db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='published'").first(),
db.prepare("SELECT SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM deployments WHERE started_at>? ").bind(Date.now()-30*86400000).first(),
db.prepare("SELECT COUNT(*) AS n FROM abuse_reports WHERE status='open'").first(),
db.prepare("SELECT COUNT(*) AS n FROM deployments WHERE status IN ('queued','deploying')").first(),
db.prepare("SELECT COUNT(*) AS n FROM deployments WHERE status='failed' AND started_at>? ").bind(Date.now()-86400000).first(),
db.prepare('SELECT s.id,s.name,s.slug,s.status,s.updated_at,m.display_name AS owner,d.status AS deployment_status,d.url FROM sites s JOIN members m ON m.id=s.owner_id LEFT JOIN deployments d ON d.id=(SELECT d2.id FROM deployments d2 WHERE d2.site_id=s.id ORDER BY d2.started_at DESC LIMIT 1) ORDER BY s.updated_at DESC LIMIT 10').all(),
db.prepare("SELECT r.id,r.reason,r.status,r.created_at,s.name AS site_name,s.slug FROM abuse_reports r JOIN sites s ON s.id=r.site_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 10").all(),
db.prepare('SELECT id,actor_email,action,target_type,target_id,reason,created_at FROM admin_audit_events ORDER BY created_at DESC LIMIT 10').all()
]);const ok=deploys?.ok||0,bad=deploys?.failed||0,total=ok+bad;return Response.json({metrics:{members:members?.n||0,publishedSites:published?.n||0,deploySuccessRate:total?Math.round(ok*100/total):0,openReports:reports?.n||0,queue:queue?.n||0,failed24h:failed?.n||0},sites:recentSites.results||[],reports:recentReports.results||[],activity:activity.results||[]})}catch{return Response.json({error:'Gagal membaca data admin. Pastikan admin-schema.sql sudah dijalankan.'},{status:503})}}
