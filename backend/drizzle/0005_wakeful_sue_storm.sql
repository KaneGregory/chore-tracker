-- Hand-edited from drizzle-kit's generated output: SQLite refuses to add a NOT NULL
-- column with no default to a non-empty table, so this adds it nullable, backfills
-- any pre-existing rows with a placeholder, then indexes it. schema.ts still declares
-- `.notNull()` — new rows always get a real username via the application layer, only
-- rows that existed before this migration get the 'user-<id>' placeholder.
ALTER TABLE `users` ADD `username` text;--> statement-breakpoint
UPDATE `users` SET `username` = 'user-' || `id` WHERE `username` IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);