import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	email: text('email', { length: 255 }).notNull().unique(),
	passwordHash: text('password_hash', { length: 255 }).notNull(),
	name: text('name', { length: 255 }),
	createdAt: text('created_at').default(sql`(CURRENT_TIMESTAMP)`).notNull(),
	updatedAt: text('updated_at').default(sql`(CURRENT_TIMESTAMP)`).notNull()
});
