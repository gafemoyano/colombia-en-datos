-- Canonical SDMX v2.
--
-- Brings the registry in line with the four canonical survey parquets:
-- every indicator now carries its survey, dataflow, theme and provenance, and
-- CATEGORY codelists get a per-indicator home.
--
-- Additive only: no column or table is dropped, so a rollback is a redeploy of
-- the previous build rather than a data restore.

ALTER TABLE `indicators` ADD `survey` text(50);--> statement-breakpoint
ALTER TABLE `indicators` ADD `dataflow` text(255);--> statement-breakpoint
ALTER TABLE `indicators` ADD `theme` text(255);--> statement-breakpoint
ALTER TABLE `indicators` ADD `universe` text;--> statement-breakpoint
ALTER TABLE `indicators` ADD `formula` text;--> statement-breakpoint
ALTER TABLE `indicators` ADD `source_variables` text;--> statement-breakpoint
ALTER TABLE `indicators` ADD `time_min` text(10);--> statement-breakpoint
ALTER TABLE `indicators` ADD `time_max` text(10);--> statement-breakpoint

-- CATEGORY codes mean different things in different indicators: GEIH's '1' is
-- "Hombre", "Contributivo" and "Indígena" depending on which indicator you
-- ask. dimension_values is keyed (dimension_code, code) and cannot express
-- that, so per-indicator codelists live here instead.
CREATE TABLE IF NOT EXISTS `indicator_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`indicator_id` integer NOT NULL,
	`code` text(100) NOT NULL,
	`label_es` text(512),
	`sort_order` integer,
	`obs_count` integer,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `indicator_categories_unique` ON `indicator_categories` (`indicator_id`,`code`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `indicator_categories_indicator` ON `indicator_categories` (`indicator_id`);
