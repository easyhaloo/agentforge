ALTER TABLE organizations ADD COLUMN personal_owner_id text REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX organizations_personal_owner ON organizations (personal_owner_id) WHERE personal_owner_id IS NOT NULL;

-- Local signup creates the user, workspace and owner membership in the same transaction.
-- Backfill only unambiguous legacy workspaces with that transaction's exact timestamp.
WITH candidates AS (
    SELECT o.id, u.id AS user_id, count(*) OVER (PARTITION BY u.id) AS matches
    FROM organizations o
    JOIN organization_memberships m ON m.organization_id = o.id AND m.role = 'owner'
    JOIN users u ON u.id = m.user_id AND u.created_at = o.created_at AND u.created_at = m.created_at
    JOIN platform_credentials c ON c.user_id = u.id
    JOIN external_identities e ON e.user_id = u.id AND e.issuer = 'platform:internal' AND e.subject = u.id
    WHERE o.name LIKE '%''s Workspace'
)
UPDATE organizations o SET personal_owner_id = candidates.user_id
FROM candidates WHERE o.id = candidates.id AND candidates.matches = 1;

ALTER TABLE delivery_repositories ADD COLUMN description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 350);
