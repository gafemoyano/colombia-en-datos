import type { Config } from 'drizzle-kit';

export default {
	schema: './src/lib/db/schema/*',
	out: './drizzle',
	dialect: 'turso',
	dbCredentials: {
		url: process.env.DATABASE_URL || 'file:./drizzle/db.sqlite',
		authToken: process.env.TURSO_AUTH_TOKEN
	}
} satisfies Config;
