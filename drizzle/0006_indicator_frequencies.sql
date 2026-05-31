CREATE TABLE IF NOT EXISTS `indicator_frequencies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`indicator_id` integer NOT NULL,
	`freq` text(1) NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `indicator_frequencies_unique` ON `indicator_frequencies` (`indicator_id`,`freq`);
--> statement-breakpoint
INSERT OR IGNORE INTO `indicator_frequencies` (`indicator_id`, `freq`)
SELECT DISTINCT `indicator_id`, `freq`
FROM `indicator_dimensions`
WHERE `freq` <> '*';
--> statement-breakpoint
INSERT OR IGNORE INTO `indicator_frequencies` (`indicator_id`, `freq`)
SELECT DISTINCT `indicator_id`, `freq`
FROM `indicator_data_sources`;
--> statement-breakpoint
INSERT OR IGNORE INTO `indicator_frequencies` (`indicator_id`, `freq`)
SELECT `id`, `frequency`
FROM `indicators`
WHERE `frequency` IS NOT NULL;
