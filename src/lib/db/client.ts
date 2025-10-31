import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '$env/dynamic/private';
import * as schema from './schema';

let cachedDb: ReturnType<typeof drizzle> | null = null;
let cachedClient: ReturnType<typeof postgres> | null = null;

export function getDb() {
	if (cachedDb) {
		return cachedDb;
	}

	const databaseUrl = env.DATABASE_URL;
	if (!databaseUrl) {
		throw new Error('DATABASE_URL environment variable is not set');
	}

	cachedClient = postgres(databaseUrl);
	cachedDb = drizzle(cachedClient, { schema });
	return cachedDb;
}
