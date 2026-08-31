CREATE UNIQUE INDEX kitchen_members_one_kitchen_per_user_idx
    ON kitchen_members(user_id);

CREATE UNIQUE INDEX kitchen_members_one_invited_member_idx
    ON kitchen_members(kitchen_id)
    WHERE role = 'member';
