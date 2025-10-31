import { pgTable, serial, varchar, integer, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { users } from './users';
import { indicators } from './indicators';

export const collections = pgTable('collections', {
	id: serial('id').primaryKey(),
	userId: integer('user_id')
		.references(() => users.id)
		.notNull(),
	name: varchar('name', { length: 255 }).notNull(),
	description: varchar('description', { length: 500 }),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});

export const collectionIndicators = pgTable(
	'collection_indicators',
	{
		collectionId: integer('collection_id')
			.references(() => collections.id)
			.notNull(),
		indicatorId: integer('indicator_id')
			.references(() => indicators.id)
			.notNull(),
		createdAt: timestamp('created_at').defaultNow().notNull()
	},
	(table) => ({
		pk: primaryKey({ columns: [table.collectionId, table.indicatorId] })
	})
);
