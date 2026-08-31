ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN avatar BYTEA;
ALTER TABLE users ADD COLUMN avatar_content_type TEXT;

ALTER TABLE users ADD CONSTRAINT users_nickname_length
    CHECK (char_length(nickname) <= 40);
