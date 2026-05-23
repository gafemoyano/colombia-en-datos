PRAGMA foreign_keys=OFF;
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
	`source` text(255),
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
	`source`,
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
PRAGMA foreign_keys=ON;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dimension_definitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text(100) NOT NULL,
	`name` text(255) NOT NULL,
	`sort_order` integer,
	`is_standard` integer DEFAULT true,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `dimension_definitions_code_unique` ON `dimension_definitions` (`code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `dimension_values` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`dimension_code` text(100) NOT NULL,
	`code` text(100) NOT NULL,
	`label_es` text(255),
	`sort_order` integer,
	FOREIGN KEY (`dimension_code`) REFERENCES `dimension_definitions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `dimension_values_unique` ON `dimension_values` (`dimension_code`,`code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `indicator_dimensions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`indicator_id` integer NOT NULL,
	`freq` text(1) DEFAULT '*' NOT NULL,
	`dimension_code` text(100) NOT NULL,
	`default_value` text(100),
	`is_filterable` integer DEFAULT true,
	`is_splitable` integer DEFAULT true,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`dimension_code`) REFERENCES `dimension_definitions`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `indicator_dimensions_unique` ON `indicator_dimensions` (`indicator_id`,`freq`,`dimension_code`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `data_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`indicator_id` integer NOT NULL,
	`release_date` text DEFAULT (CURRENT_TIMESTAMP),
	`period_start` text,
	`period_end` text,
	`row_count` integer,
	`source_format` text(50),
	`source_name` text,
	`uploaded_by` text,
	`status` text(50) DEFAULT 'published',
	`checksum` text,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `indicator_data_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`indicator_id` integer NOT NULL,
	`ref_area` text(50) NOT NULL,
	`freq` text(1) NOT NULL,
	`year_min` integer,
	`year_max` integer,
	`row_count` integer,
	`release_id` integer,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `data_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `indicator_data_sources_unique` ON `indicator_data_sources` (`indicator_id`,`ref_area`,`freq`);
