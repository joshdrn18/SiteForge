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
