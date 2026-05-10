import { sqliteTable, integer, text, primaryKey } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { users } from './users';
import { indicators } from './indicators';

export const collections = sqliteTable('collections', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id')
		.references(() => users.id)
		.notNull(),
	name: text('name', { length: 255 }).notNull(),
	description: text('description', { length: 500 }),
	createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull()
});

export const collectionIndicators = sqliteTable(
	'collection_indicators',
	{
		collectionId: integer('collection_id')
			.references(() => collections.id)
			.notNull(),
		indicatorId: integer('indicator_id')
			.references(() => indicators.id)
			.notNull(),
		createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.collectionId, table.indicatorId] })
	})
);
