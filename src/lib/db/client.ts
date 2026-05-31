import { createClient } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

let cachedDb: LibSQLDatabase<typeof schema> | null = null;

export function getDb() {
	if (cachedDb) {
		return cachedDb;
	}

	const databaseUrl = env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('DATABASE_URL environment variable is not set');
	}

	const client = createClient({
		url: databaseUrl,
		authToken: env.TURSO_AUTH_TOKEN
	});

	cachedDb = drizzle(client, { schema });
	return cachedDb;
}
