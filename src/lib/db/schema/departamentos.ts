import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const departamentos = sqliteTable('departamentos', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code', { length: 10 }).notNull().unique(),
	name: text('name', { length: 255 }).notNull(),
	createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull()
});
