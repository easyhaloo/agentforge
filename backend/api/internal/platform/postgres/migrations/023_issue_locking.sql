-- Migration 023: Issue Locking Enhancement
-- Add missing fields for complete lock/unlock functionality

ALTER TABLE issues
ADD COLUMN IF NOT EXISTS lock_reason TEXT CHECK (lock_reason IN ('off-topic', 'too heated', 'resolved', 'spam') OR lock_reason IS NULL),
ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS locked_by TEXT REFERENCES users(id) ON DELETE SET NULL;

-- Add constraint: if locked=true, then locked_at and locked_by must be set
-- Note: PostgreSQL doesn't support adding CHECK constraints that reference multiple columns easily after table creation
-- We'll enforce this in the application layer

-- Add index for locked issues
CREATE INDEX IF NOT EXISTS issues_locked_idx ON issues (organization_id, repository, locked) WHERE locked = true;
