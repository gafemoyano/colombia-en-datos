import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import 'dotenv/config';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
	throw new Error('DATABASE_URL environment variable is not set');
}

const client = createClient({
	url: databaseUrl,
	authToken: process.env.TURSO_AUTH_TOKEN
});

export const db = drizzle(client, { schema });
