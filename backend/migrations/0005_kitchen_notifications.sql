CREATE TABLE kitchen_notifications (
    id UUID PRIMARY KEY,
    kitchen_id UUID NOT NULL REFERENCES kitchens(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('menu_ready', 'pick_reminder')),
    plan_date DATE,
    dish_names TEXT[] NOT NULL DEFAULT '{}',
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX kitchen_notifications_recipient_idx
    ON kitchen_notifications(recipient_user_id, created_at DESC);
