import { pgTable, serial, varchar, timestamp } from 'drizzle-orm/pg-core';

export const departamentos = pgTable('departamentos', {
	id: serial('id').primaryKey(),
	code: varchar('code', { length: 10 }).notNull().unique(),
	name: varchar('name', { length: 255 }).notNull(),
	createdAt: timestamp('created_at').defaultNow().notNull(),
	updatedAt: timestamp('updated_at').defaultNow().notNull()
});
