ALTER TABLE notification_preferences
    ADD COLUMN inbox_participating BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN inbox_watching BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE repository_watches (
    organization_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (organization_id, repository, user_id),
    FOREIGN KEY (organization_id, repository) REFERENCES delivery_repositories(organization_id, slug) ON DELETE CASCADE
);

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN ('comment', 'mention', 'state_change', 'assigned', 'issue_created'));
