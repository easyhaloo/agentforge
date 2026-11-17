-- Organization slug: a unique, human-readable path handle. The id stays the
-- primary key. The column is nullable so INSERT INTO organizations (id, name)
-- keeps working; the API falls back to the id for rows without a slug.
ALTER TABLE organizations
    ADD COLUMN IF NOT EXISTS slug TEXT;

-- Deterministic backfill, oldest organization first; ties are broken by id in
-- byte order (COLLATE "C") so the result does not depend on the database
-- collation. The base slug follows identity.Slugify (ASCII only, so it does not
-- depend on the database locale either). A candidate is skipped, and -2, -3, ...
-- is tried, when it is the reserved word 'current', another organization's
-- slug, or a different organization's id.
DO $$
DECLARE
    organization RECORD;
    base_slug TEXT;
    candidate TEXT;
    suffix TEXT;
    attempt INTEGER;
BEGIN
    FOR organization IN
        SELECT id, name FROM organizations WHERE slug IS NULL ORDER BY created_at, id COLLATE "C"
    LOOP
        base_slug := trim(both '-' from regexp_replace(
            translate(organization.name, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'),
            '[^a-z0-9]+', '-', 'g'));
        base_slug := trim(both '-' from left(base_slug, 39));
        IF base_slug = '' THEN
            base_slug := 'org';
        END IF;

        candidate := base_slug;
        attempt := 1;
        WHILE candidate = 'current'
              OR EXISTS (SELECT 1 FROM organizations WHERE slug = candidate)
              OR EXISTS (SELECT 1 FROM organizations WHERE id = candidate AND id <> organization.id)
        LOOP
            attempt := attempt + 1;
            suffix := '-' || attempt;
            candidate := trim(both '-' from left(base_slug, 39 - length(suffix))) || suffix;
        END LOOP;

        UPDATE organizations SET slug = candidate WHERE id = organization.id;
    END LOOP;
END
$$;

ALTER TABLE organizations
    DROP CONSTRAINT IF EXISTS organizations_slug_check;
ALTER TABLE organizations
    ADD CONSTRAINT organizations_slug_check
    CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{0,37}[a-z0-9])?$' AND slug <> 'current');

CREATE UNIQUE INDEX IF NOT EXISTS organizations_slug_key
    ON organizations (slug);
