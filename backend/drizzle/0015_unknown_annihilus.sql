-- Hand-edited from drizzle-kit's generated output: todo_since has no way to know
-- a pre-existing to-do chore/zone's *real* transition instant, so this backfills
-- the migration's own run time for anything currently 'to-do' — a reasonable
-- "the clock starts now" default. complete/overdue rows are left NULL; they get a
-- real todoSince the next time they actually transition into 'to-do' (see
-- choreService.ts).
ALTER TABLE `chore_schedules` ADD `overdue_after_amount` integer;--> statement-breakpoint
ALTER TABLE `chore_schedules` ADD `overdue_after_unit` text;--> statement-breakpoint
ALTER TABLE `chore_schedules` ADD `overdue_at` integer;--> statement-breakpoint
CREATE INDEX `chore_schedules_overdue_at_idx` ON `chore_schedules` (`overdue_at`);--> statement-breakpoint
ALTER TABLE `chore_zones` ADD `todo_since` integer;--> statement-breakpoint
ALTER TABLE `chores` ADD `todo_since` integer;--> statement-breakpoint
ALTER TABLE `schedule_patterns` ADD `overdue_after_amount` integer;--> statement-breakpoint
ALTER TABLE `schedule_patterns` ADD `overdue_after_unit` text;--> statement-breakpoint
UPDATE `chores` SET `todo_since` = (unixepoch() * 1000) WHERE `status` = 'to-do';--> statement-breakpoint
UPDATE `chore_zones` SET `todo_since` = (unixepoch() * 1000) WHERE `status` = 'to-do';