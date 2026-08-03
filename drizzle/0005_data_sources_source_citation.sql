PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `data_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text(50) NOT NULL,
	`name` text(255) NOT NULL,
	`description` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
INSERT INTO `data_sources` (`id`, `code`, `name`, `description`, `created_at`, `updated_at`)
SELECT `id`, `code`, `name`, `description`, `created_at`, `updated_at`
FROM `areas`
WHERE EXISTS (SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'areas');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `data_sources_code_unique` ON `data_sources` (`code`);
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_indicator_groups`;
--> statement-breakpoint
CREATE TABLE `__new_indicator_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data_source_id` integer NOT NULL,
	`code` text(255) NOT NULL,
	`name` text(255) NOT NULL,
	`description` text,
	`source_type` text(50),
	`filter_whitelist` text,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_indicator_groups` (
	`id`,
	`data_source_id`,
	`code`,
	`name`,
	`description`,
	`source_type`,
	`filter_whitelist`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`area_id`,
	`code`,
	`name`,
	`description`,
	`source_type`,
	`filter_whitelist`,
	`created_at`,
	`updated_at`
FROM `indicator_groups`;
--> statement-breakpoint
DROP TABLE `indicator_groups`;
--> statement-breakpoint
ALTER TABLE `__new_indicator_groups` RENAME TO `indicator_groups`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `indicator_groups_data_source_code_unique` ON `indicator_groups` (`data_source_id`,`code`);
--> statement-breakpoint
DROP TABLE IF EXISTS `__new_indicators`;
--> statement-breakpoint
CREATE TABLE `__new_indicators` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`indicator_group_id` integer NOT NULL,
	`code` text(100) NOT NULL,
	`name` text(255) NOT NULL,
	`short_name` text(255),
	`description` text,
	`methodology` text,
	`frequency` text(1),
	`source_citation` text(255),
	`unit` text(100),
	`unit_mult` integer,
	`decimals` integer,
	`default_viz` text(50),
	`updated` text(50),
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`indicator_group_id`) REFERENCES `indicator_groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_indicators` (
	`id`,
	`indicator_group_id`,
	`code`,
	`name`,
	`short_name`,
	`description`,
	`methodology`,
	`frequency`,
	`source_citation`,
	`unit`,
	`unit_mult`,
	`decimals`,
	`default_viz`,
	`updated`,
	`created_at`,
	`updated_at`
)
SELECT
	`id`,
	`indicator_group_id`,
	`code`,
	`name`,
	`short_name`,
	`description`,
	`methodology`,
	`frequency`,
	`source`,
	`unit`,
	`unit_mult`,
	`decimals`,
	`default_viz`,
	`updated`,
	`created_at`,
	`updated_at`
FROM `indicators`;
--> statement-breakpoint
DROP TABLE `indicators`;
--> statement-breakpoint
ALTER TABLE `__new_indicators` RENAME TO `indicators`;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `indicators_code_unique` ON `indicators` (`code`);
--> statement-breakpoint
DROP TABLE IF EXISTS `areas`;
--> statement-breakpoint
PRAGMA foreign_keys=ON;
