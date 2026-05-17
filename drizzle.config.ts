import 'dotenv/config';
import type { Config } from 'drizzle-kit';

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL environment variable is required for Drizzle commands');
}

export default {
	schema: './src/lib/db/schema/*',
	out: './drizzle',
	dialect: 'turso',
	dbCredentials: {
		url: process.env.DATABASE_URL,
		authToken: process.env.TURSO_AUTH_TOKEN
	}
} satisfies Config;
