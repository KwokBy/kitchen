ALTER TABLE kitchens
    ADD COLUMN owner_role_name TEXT NOT NULL DEFAULT '做饭主力',
    ADD COLUMN member_role_name TEXT NOT NULL DEFAULT '点菜主力';

ALTER TABLE kitchens
    ADD CONSTRAINT kitchens_owner_role_name_length
        CHECK (char_length(owner_role_name) BETWEEN 1 AND 20),
    ADD CONSTRAINT kitchens_member_role_name_length
        CHECK (char_length(member_role_name) BETWEEN 1 AND 20);
