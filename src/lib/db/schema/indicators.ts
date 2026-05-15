import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const areas = sqliteTable('areas', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code', { length: 50 }).notNull().unique(),
	name: text('name', { length: 255 }).notNull(),
	description: text('description'),
	createdAt: text('created_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull(),
	updatedAt: text('updated_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull()
});

export const indicatorGroups = sqliteTable(
	'indicator_groups',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		areaId: integer('area_id')
			.references(() => areas.id)
			.notNull(),
		code: text('code', { length: 255 }).notNull(),
		name: text('name', { length: 255 }).notNull(),
		description: text('description'),
		sourceType: text('source_type', { length: 50 }),
		filterWhitelist: text('filter_whitelist', { mode: 'json' }).$type<string[]>(),
		createdAt: text('created_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull(),
		updatedAt: text('updated_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull()
	},
	(table) => ({
		indicatorGroupsUnique: uniqueIndex('indicator_groups_area_code_unique').on(
			table.areaId,
			table.code
		)
	})
);

export const indicators = sqliteTable('indicators', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	indicatorGroupId: integer('indicator_group_id')
		.references(() => indicatorGroups.id)
		.notNull(),
	code: text('code', { length: 100 }).notNull().unique(),
	name: text('name', { length: 255 }).notNull(),
	shortName: text('short_name', { length: 255 }),
	description: text('description'),
	methodology: text('methodology'),
	frequency: text('frequency', { length: 1 }).notNull(),
	source: text('source', { length: 255 }),
	unit: text('unit', { length: 100 }),
	unitMult: integer('unit_mult'),
	decimals: integer('decimals'),
	defaultViz: text('default_viz', { length: 50 }),
	updated: text('updated', { length: 50 }),
	createdAt: text('created_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull(),
	updatedAt: text('updated_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull()
});

export const indicatorFiles = sqliteTable(
	'indicator_files',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		indicatorId: integer('indicator_id')
			.references(() => indicators.id)
			.notNull(),
		refArea: text('ref_area', { length: 50 }).notNull(),
		year: integer('year').notNull(),
		filePath: text('file_path').notNull(),
		createdAt: text('created_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull()
	},
	(table) => ({
		indicatorFilesUnique: uniqueIndex('indicator_files_unique').on(
			table.indicatorId,
			table.refArea,
			table.year,
			table.filePath
		)
	})
);
