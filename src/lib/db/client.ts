import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

let cachedDb: ReturnType<typeof drizzle> | null = null;

export function getDb() {
	if (cachedDb) {
		return cachedDb;
	}

	const databaseUrl = env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('DATABASE_URL environment variable is not set');
	}

	const sqlite = new Database(databaseUrl);
	cachedDb = drizzle(sqlite, { schema });
	return cachedDb;
}
