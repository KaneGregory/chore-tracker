ALTER TABLE `chore_zones` ADD `status` text DEFAULT 'to-do' NOT NULL;--> statement-breakpoint
ALTER TABLE `chores` ADD `status` text DEFAULT 'to-do' NOT NULL;