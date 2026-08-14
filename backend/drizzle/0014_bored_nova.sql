CREATE TABLE `schedule_patterns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`household_id` integer NOT NULL,
	`name` text NOT NULL,
	`recurrence_type` text NOT NULL,
	`start_time` text NOT NULL,
	`interval_days` integer,
	`interval_weeks` integer,
	`weekdays` text,
	`interval_months` integer,
	`day_of_month` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
