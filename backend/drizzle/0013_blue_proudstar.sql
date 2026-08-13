CREATE TABLE `chore_schedules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chore_id` integer,
	`chore_zone_id` integer,
	`recurrence_type` text NOT NULL,
	`start_at` integer NOT NULL,
	`interval_days` integer,
	`interval_weeks` integer,
	`weekdays` text,
	`interval_months` integer,
	`day_of_month` integer,
	`next_run_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chore_id`) REFERENCES `chores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chore_zone_id`) REFERENCES `chore_zones`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "chore_schedules_exactly_one_target" CHECK(("chore_schedules"."chore_id" IS NULL) != ("chore_schedules"."chore_zone_id" IS NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chore_schedules_chore_id_unique` ON `chore_schedules` (`chore_id`) WHERE "chore_schedules"."chore_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `chore_schedules_chore_zone_id_unique` ON `chore_schedules` (`chore_zone_id`) WHERE "chore_schedules"."chore_zone_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `chore_schedules_next_run_at_idx` ON `chore_schedules` (`next_run_at`);--> statement-breakpoint
ALTER TABLE `households` ADD `timezone` text;