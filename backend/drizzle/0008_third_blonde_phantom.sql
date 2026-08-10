-- Hand-edited from drizzle-kit's generated output: SQLite refuses to add a NOT NULL
-- column with no default to a non-empty table, so this adds it nullable, then
-- backfills every existing household from its earliest household_members row
-- (ordered by id, which matches insertion order). That row is always the creator:
-- a household can't be joined via its join code before the household itself exists,
-- so the first-ever membership row for a household is always the head created
-- alongside it in authService.register. schema.ts still declares `.notNull()` — new
-- households always get a real value via the application layer; only rows that
-- existed before this migration get backfilled here.
ALTER TABLE `households` ADD `created_by_user_id` integer REFERENCES users(id);--> statement-breakpoint
UPDATE `households`
SET `created_by_user_id` = (
  SELECT `user_id` FROM `household_members`
  WHERE `household_members`.`household_id` = `households`.`id`
  ORDER BY `household_members`.`id` ASC
  LIMIT 1
)
WHERE `created_by_user_id` IS NULL;
