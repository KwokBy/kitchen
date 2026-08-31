CREATE TABLE users (
    id UUID PRIMARY KEY,
    openid TEXT NOT NULL UNIQUE,
    unionid TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kitchens (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
    invite_code CHAR(6) NOT NULL UNIQUE,
    owner_user_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE kitchen_members (
    kitchen_id UUID NOT NULL REFERENCES kitchens(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (kitchen_id, user_id)
);

CREATE INDEX kitchen_members_user_id_idx ON kitchen_members(user_id);
