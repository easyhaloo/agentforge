CREATE TABLE issue_redirects (
    organization_id text NOT NULL,
    repository text NOT NULL,
    number integer NOT NULL,
    issue_id text NOT NULL,
    PRIMARY KEY (organization_id, repository, number),
    FOREIGN KEY (organization_id, issue_id) REFERENCES issues (organization_id, id) ON DELETE CASCADE
);

ALTER TABLE issue_events DROP CONSTRAINT issue_events_event_type_check;
ALTER TABLE issue_events ADD CONSTRAINT issue_events_event_type_check CHECK (event_type IN (
    'created', 'closed', 'reopened', 'labeled', 'unlabeled', 'assigned', 'unassigned',
    'milestoned', 'demilestoned', 'renamed', 'edited', 'locked', 'unlocked',
    'linked_changeset', 'unlinked_changeset', 'commented', 'mentioned', 'referenced', 'metadata_changed', 'transferred'
));
