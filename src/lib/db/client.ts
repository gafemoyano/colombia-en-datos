import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { env } from '$env/dynamic/private';
import * as schema from './schema';
import { measure } from '$lib/server/performance';

let cachedDb: ReturnType<typeof drizzle> | null = null;

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

	// Drizzle's async libSQL reads use execute; keep the native receiver intact.
	const execute = client.execute.bind(client);
	client.execute = (...args: Parameters<typeof client.execute>) =>
		measure('turso_execute', () => execute(...args));
	cachedDb = drizzle(client, { schema });
	return cachedDb;
}
