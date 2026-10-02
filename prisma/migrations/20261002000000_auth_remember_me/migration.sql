ALTER TABLE `auth_sessions`
  ADD COLUMN `remember_me` BOOLEAN NOT NULL DEFAULT false;
