CREATE TABLE IF NOT EXISTS sites (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'draft',
 disabled_reason TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS deployments (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 provider_deployment_id TEXT, status TEXT NOT NULL, url TEXT, error TEXT,
 started_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_deployments_started ON deployments(started_at);
CREATE INDEX IF NOT EXISTS idx_deployments_site ON deployments(site_id);
CREATE TABLE IF NOT EXISTS abuse_reports (
 id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
 created_at INTEGER NOT NULL, reviewed_by TEXT, reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_reports_status ON abuse_reports(status,created_at);
CREATE TABLE IF NOT EXISTS admin_audit_events (
 id TEXT PRIMARY KEY, actor_email TEXT NOT NULL, action TEXT NOT NULL,
 target_type TEXT NOT NULL, target_id TEXT NOT NULL, reason TEXT,
 created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS site_content (
 site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
 content_json TEXT NOT NULL DEFAULT '{}',
 updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS member_admin_status (
 member_id TEXT PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 reason TEXT,
 updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ip_rate_limits (
 action TEXT NOT NULL,
 ip_hash TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 attempts INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(action,ip_hash)
);
CREATE INDEX IF NOT EXISTS idx_ip_rate_limits_window ON ip_rate_limits(window_start);


CREATE TABLE IF NOT EXISTS member_subscriptions (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 provider TEXT NOT NULL DEFAULT 'xendit',
 provider_reference_id TEXT NOT NULL UNIQUE,
 provider_session_id TEXT,
 provider_plan_id TEXT,
 checkout_url TEXT,
 checkout_expires_at INTEGER,
 plan_code TEXT NOT NULL DEFAULT 'pro_monthly',
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','past_due','cancelled','failed','expired')),
 amount REAL NOT NULL,
 currency TEXT NOT NULL,
 first_renewal_at INTEGER,
 current_period_end INTEGER,
 provider_updated_at INTEGER NOT NULL DEFAULT 0,
 last_cycle_number INTEGER NOT NULL DEFAULT 0,
 last_cycle_status TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_member_status ON member_subscriptions(member_id,status,updated_at);
CREATE INDEX IF NOT EXISTS idx_member_subscriptions_period_end ON member_subscriptions(current_period_end);

CREATE TABLE IF NOT EXISTS member_subscription_cycles (
 cycle_id TEXT PRIMARY KEY,
 provider_reference_id TEXT NOT NULL REFERENCES member_subscriptions(provider_reference_id) ON DELETE CASCADE,
 cycle_number INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_member_subscription_cycles_reference ON member_subscription_cycles(provider_reference_id,cycle_number);
