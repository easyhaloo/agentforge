-- Settings tables for user preferences, notifications, SSH keys, and agent settings

-- User preferences (appearance/language settings)
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('light', 'dark', 'auto')),
    language TEXT NOT NULL DEFAULT 'en-US' CHECK (language IN ('en-US', 'zh-CN')),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Notification preferences
CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email_evaluation_complete BOOLEAN NOT NULL DEFAULT true,
    email_review_assigned BOOLEAN NOT NULL DEFAULT true,
    email_changeset_status BOOLEAN NOT NULL DEFAULT true,
    email_org_invitation BOOLEAN NOT NULL DEFAULT true,
    web_push_enabled BOOLEAN NOT NULL DEFAULT false,
    notification_frequency TEXT NOT NULL DEFAULT 'real-time' CHECK (notification_frequency IN ('real-time', 'hourly', 'daily')),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SSH public keys
CREATE TABLE IF NOT EXISTS ssh_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    key_type TEXT NOT NULL CHECK (key_type IN ('RSA', 'Ed25519', 'ECDSA')),
    key_bits INTEGER NOT NULL,
    public_key TEXT NOT NULL,
    fingerprint TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ssh_keys_user_id ON ssh_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_ssh_keys_fingerprint ON ssh_keys(fingerprint);

-- Agent preferences (AI assistant behavior settings)
CREATE TABLE IF NOT EXISTS agent_preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    output_verbosity TEXT NOT NULL DEFAULT 'standard' CHECK (output_verbosity IN ('concise', 'standard', 'verbose')),
    confirmation_strategy TEXT NOT NULL DEFAULT 'batch' CHECK (confirmation_strategy IN ('always', 'batch', 'auto')),
    automation_level TEXT NOT NULL DEFAULT 'balanced' CHECK (automation_level IN ('conservative', 'balanced', 'aggressive')),
    cross_session_memory_enabled BOOLEAN NOT NULL DEFAULT true,
    auto_evaluate_on_push BOOLEAN NOT NULL DEFAULT false,
    notify_evaluation_results BOOLEAN NOT NULL DEFAULT true,
    evaluation_strictness TEXT NOT NULL DEFAULT 'standard' CHECK (evaluation_strictness IN ('strict', 'standard', 'lenient')),
    agent_review_enabled BOOLEAN NOT NULL DEFAULT false,
    agent_can_approve_low_risk BOOLEAN NOT NULL DEFAULT false,
    review_focus JSONB NOT NULL DEFAULT '{"security":true,"performance":true,"code_style":false,"test_coverage":true,"documentation":false}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add email_verified column to users table if it doesn't exist
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT false;
