ALTER TABLE issues ADD COLUMN custom_fields JSONB NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(custom_fields) = 'object');

ALTER TABLE issue_events DROP CONSTRAINT issue_events_event_type_check;
ALTER TABLE issue_events ADD CONSTRAINT issue_events_event_type_check CHECK (event_type IN (
    'created', 'closed', 'reopened', 'labeled', 'unlabeled', 'assigned', 'unassigned',
    'milestoned', 'demilestoned', 'renamed', 'edited', 'locked', 'unlocked',
    'linked_changeset', 'unlinked_changeset', 'commented', 'mentioned', 'referenced', 'metadata_changed'
));
