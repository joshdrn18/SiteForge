import { getMember } from "../../_shared/member-billing.js";

export async function onRequestGet({ request, env }) {
  if (!env.DB) return Response.json({ error: "Database member belum dikonfigurasi." }, { status: 503 });
  try {
    const session = await getMember(request, env);
    if (!session) return Response.json({ error: "Sesi login tidak berlaku." }, { status: 401 });
    const member = await env.DB.prepare("SELECT id,email,display_name,created_at FROM members WHERE id=?").bind(session.id).first();
    if (!member) return Response.json({ error: "Akun tidak ditemukan." }, { status: 404 });

    const [sites, subscriptions, cycles] = await Promise.all([
      env.DB.prepare("SELECT s.name,s.slug,s.status,s.created_at,s.updated_at,c.content_json FROM sites s LEFT JOIN site_content c ON c.site_id=s.id WHERE s.owner_id=? ORDER BY s.created_at").bind(session.id).all(),
      env.DB.prepare("SELECT provider,provider_reference_id,plan_code,status,amount,currency,current_period_end,created_at,updated_at FROM member_subscriptions WHERE member_id=? ORDER BY created_at").bind(session.id).all(),
      env.DB.prepare("SELECT c.cycle_number,c.status,c.updated_at,s.plan_code,s.amount,s.currency FROM member_subscription_cycles c JOIN member_subscriptions s ON s.provider_reference_id=c.provider_reference_id WHERE s.member_id=? ORDER BY c.updated_at").bind(session.id).all()
    ]);

    const websites = (sites.results || []).map(row => {
      let content = {};
      try { content = JSON.parse(row.content_json || "{}"); } catch {}
      return { name: row.name, slug: row.slug, status: row.status, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), content };
    });
    const data = {
      exportedAt: new Date().toISOString(),
      account: { email: member.email, displayName: member.display_name, createdAt: Number(member.created_at) },
      websites,
      subscriptions: (subscriptions.results || []).map(row => ({
        provider: row.provider, referenceId: row.provider_reference_id, planCode: row.plan_code, status: row.status,
        amount: Number(row.amount || 0), currency: row.currency, currentPeriodEnd: row.current_period_end ? Number(row.current_period_end) : null,
        createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
      })),
      billingCycles: (cycles.results || []).map(row => ({
        cycleNumber: Number(row.cycle_number || 0), status: row.status, updatedAt: Number(row.updated_at || 0),
        planCode: row.plan_code, amount: Number(row.amount || 0), currency: row.currency
      }))
    };
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json;charset=utf-8",
        "Content-Disposition": 'attachment; filename="siteforge-account-data.json"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    console.error("[account:export]", String(error?.message || error));
    const message = String(error?.message || error);
    if (["members", "sites", "site_content", "member_subscriptions", "member_subscription_cycles"].some(table => message.includes("no such table: " + table))) {
      return Response.json({ error: "Ekspor data belum siap. Jalankan ulang schema.sql dan admin-schema.sql di D1." }, { status: 503 });
    }
    return Response.json({ error: "Data akun gagal diekspor." }, { status: 500 });
  }
}
