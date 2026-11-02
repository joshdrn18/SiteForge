export async function onRequestGet({env}){
 if(!env.DB)return Response.json({error:'D1 binding DB belum dipasang.'},{status:503});
 const db=env.DB,now=Date.now(),cutoff=String(now);
 const assignmentCode="(SELECT a.plan_code FROM member_plan_assignments a WHERE a.member_id=m.id AND (a.ends_at IS NULL OR a.ends_at>"+cutoff+") LIMIT 1)";
 const paidCode="(SELECT s.plan_code FROM member_subscriptions s WHERE s.member_id=m.id AND s.current_period_end>"+cutoff+" ORDER BY s.current_period_end DESC LIMIT 1)";
 const effectiveCode="COALESCE("+assignmentCode+","+paidCode+",'free')";
 try{
  const [members,published,deploys,reports,queue,failed,proSubscriptions,recentSites,recentReports,activity,memberList,plans]=await Promise.all([
   db.prepare('SELECT COUNT(*) AS n FROM members').first(),
   db.prepare("SELECT COUNT(*) AS n FROM sites WHERE status='published'").first(),
   db.prepare("SELECT SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM deployments WHERE started_at>?").bind(now-30*86400000).first(),
   db.prepare("SELECT COUNT(*) AS n FROM abuse_reports WHERE status='open'").first(),
   db.prepare("SELECT COUNT(*) AS n FROM deployments WHERE status IN ('queued','deploying')").first(),
   db.prepare("SELECT COUNT(*) AS n FROM deployments WHERE status='failed' AND started_at>?").bind(now-86400000).first(),
   db.prepare("SELECT COUNT(DISTINCT member_id) AS n FROM (SELECT member_id FROM member_subscriptions WHERE current_period_end>"+cutoff+" AND plan_code!='free' UNION SELECT a.member_id FROM member_plan_assignments a WHERE (a.ends_at IS NULL OR a.ends_at>"+cutoff+") AND a.plan_code!='free')").first(),
   db.prepare("SELECT s.id,s.name,s.slug,s.status,s.updated_at,m.display_name AS owner,d.status AS deployment_status,d.url FROM sites s JOIN members m ON m.id=s.owner_id LEFT JOIN deployments d ON d.id=(SELECT d2.id FROM deployments d2 WHERE d2.site_id=s.id ORDER BY d2.started_at DESC LIMIT 1) ORDER BY s.updated_at DESC LIMIT 100").all(),
   db.prepare("SELECT r.id,r.reason,r.status,r.created_at,s.name AS site_name,s.slug FROM abuse_reports r JOIN sites s ON s.id=r.site_id WHERE r.status='open' ORDER BY r.created_at DESC LIMIT 10").all(),
   db.prepare("SELECT id,actor_email,action,target_type,target_id,reason,created_at FROM admin_audit_events ORDER BY created_at DESC LIMIT 10").all(),
   db.prepare("SELECT m.id,m.email,m.display_name,m.created_at,COALESCE(a.status,'active') AS status,a.reason,(SELECT COUNT(*) FROM sites s WHERE s.owner_id=m.id) AS website_count,"+effectiveCode+" AS plan_code,ep.name AS plan_name,CASE WHEN EXISTS (SELECT 1 FROM member_plan_assignments x WHERE x.member_id=m.id AND (x.ends_at IS NULL OR x.ends_at>"+cutoff+")) THEN 'admin' WHEN EXISTS (SELECT 1 FROM member_subscriptions x WHERE x.member_id=m.id AND x.current_period_end>"+cutoff+") THEN 'xendit' ELSE 'free' END AS plan_source,COALESCE((SELECT x.ends_at FROM member_plan_assignments x WHERE x.member_id=m.id AND (x.ends_at IS NULL OR x.ends_at>"+cutoff+") LIMIT 1),(SELECT x.current_period_end FROM member_subscriptions x WHERE x.member_id=m.id AND x.current_period_end>"+cutoff+" ORDER BY x.current_period_end DESC LIMIT 1)) AS plan_until,(SELECT x.ends_at FROM member_plan_assignments x WHERE x.member_id=m.id AND (x.ends_at IS NULL OR x.ends_at>"+cutoff+") LIMIT 1) AS manual_plan_ends_at,(SELECT x.status FROM member_subscriptions x WHERE x.member_id=m.id ORDER BY x.updated_at DESC LIMIT 1) AS subscription_status,EXISTS(SELECT 1 FROM member_subscriptions x WHERE x.member_id=m.id AND x.provider_plan_id IS NOT NULL AND x.status IN ('pending','active','past_due')) AS has_provider_subscription FROM members m LEFT JOIN member_admin_status a ON a.member_id=m.id LEFT JOIN subscription_plans ep ON ep.code="+effectiveCode+" ORDER BY m.created_at DESC LIMIT 100").all(),
   db.prepare("SELECT code,name,description,amount,currency,country,billing_interval,site_limit,is_active,sort_order,created_at,updated_at FROM subscription_plans ORDER BY sort_order,name").all()
  ]);
  const ok=deploys?.ok||0,bad=deploys?.failed||0,total=ok+bad;
  return Response.json({
   metrics:{members:members?.n||0,publishedSites:published?.n||0,deploySuccessRate:total?Math.round(ok*100/total):0,openReports:reports?.n||0,queue:queue?.n||0,failed24h:failed?.n||0,proSubscriptions:proSubscriptions?.n||0},
   sites:recentSites.results||[],reports:recentReports.results||[],activity:activity.results||[],memberList:memberList.results||[],plans:plans.results||[]
  });
 }catch(error){
  console.error('[admin-overview]',error);
  return Response.json({error:'Data admin belum siap. Jalankan ulang admin-schema.sql versi terbaru di D1.'},{status:503});
 }
}
