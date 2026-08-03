CREATE TABLE IF NOT EXISTS `ingest_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`data_source_id` integer,
	`original_name` text,
	`checksum` text,
	`source_format` text(50),
	`row_count` integer,
	`status` text(50) DEFAULT 'uploaded' NOT NULL,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`published_at` text,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `data_releases` ADD `ingest_batch_id` integer REFERENCES `ingest_batches`(`id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `data_releases_ingest_batch_idx` ON `data_releases` (`ingest_batch_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ingest_batch_slices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer NOT NULL,
	`indicator_code` text(100) NOT NULL,
	`freq` text(1) NOT NULL,
	`indicator_id` integer,
	`row_count` integer,
	`period_start` text,
	`period_end` text,
	`status` text(50) DEFAULT 'proposed' NOT NULL,
	`release_id` integer,
	`created_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `ingest_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`indicator_id`) REFERENCES `indicators`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`release_id`) REFERENCES `data_releases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `ingest_batch_slices_unique` ON `ingest_batch_slices` (`batch_id`,`indicator_code`,`freq`);
