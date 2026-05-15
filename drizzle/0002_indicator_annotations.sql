DROP TABLE IF EXISTS `collection_indicators`;
--> statement-breakpoint
DROP TABLE IF EXISTS `collections`;
--> statement-breakpoint
ALTER TABLE `categories` RENAME TO `indicator_groups`;
--> statement-breakpoint
ALTER TABLE `indicator_groups` ADD `source_type` text(50);
--> statement-breakpoint
ALTER TABLE `indicator_groups` ADD `filter_whitelist` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `indicator_groups_area_code_unique` ON `indicator_groups` (`area_id`,`code`);
--> statement-breakpoint
ALTER TABLE `indicators` RENAME COLUMN `category_id` TO `indicator_group_id`;
--> statement-breakpoint
ALTER TABLE `indicators` ADD `short_name` text(255);
--> statement-breakpoint
ALTER TABLE `indicators` ADD `methodology` text;
--> statement-breakpoint
ALTER TABLE `indicators` ADD `unit` text(100);
--> statement-breakpoint
ALTER TABLE `indicators` ADD `unit_mult` integer;
--> statement-breakpoint
ALTER TABLE `indicators` ADD `decimals` integer;
--> statement-breakpoint
ALTER TABLE `indicators` ADD `default_viz` text(50);
--> statement-breakpoint
ALTER TABLE `indicators` ADD `updated` text(50);
