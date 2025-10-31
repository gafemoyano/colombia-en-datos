import { pgTable, serial, varchar, text, timestamp, jsonb, integer } from 'drizzle-orm/pg-core';

export const areas = pgTable('areas', {
	id: serial('id').primaryKey(),
	code: varchar('code', { length: 50 }).notNull().unique(),
	name: varchar('name', { length: 255 }).notNull(),
	description: text('description'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const categories = pgTable('categories', {
	id: serial('id').primaryKey(),
	areaId: integer('area_id')
		.references(() => areas.id)
		.notNull(),
	code: varchar('code', { length: 255 }).notNull(),
	name: varchar('name', { length: 255 }).notNull(),
	description: text('description'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const indicators = pgTable('indicators', {
	id: serial('id').primaryKey(),
	categoryId: integer('category_id')
		.references(() => categories.id)
		.notNull(),
	code: varchar('code', { length: 100 }).notNull().unique(),
	name: varchar('name', { length: 255 }).notNull(),
	description: text('description'),
	frequency: varchar('frequency', { length: 1 }).notNull(),
	source: varchar('source', { length: 255 }),
	metadata: jsonb('metadata'),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const indicatorFiles = pgTable('indicator_files', {
	id: serial('id').primaryKey(),
	indicatorId: integer('indicator_id')
		.references(() => indicators.id)
		.notNull(),
	refArea: varchar('ref_area', { length: 50 }).notNull(),
	year: integer('year').notNull(),
	filePath: text('file_path').notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull()
});
