CREATE SEQUENCE member_username_seq;

ALTER TABLE users
    ADD COLUMN username TEXT NOT NULL DEFAULT ('member-' || nextval('member_username_seq')) UNIQUE;

ALTER SEQUENCE member_username_seq OWNED BY users.username;
