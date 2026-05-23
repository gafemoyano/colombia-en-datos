import { json } from '@sveltejs/kit';
import { runCanonicalQuery, getCanonicalDbPath, CANONICAL_SCHEMA_VERSION } from '$lib/server/duckdb';
import { getDb } from '$lib/db/client';
import { indicators } from '$lib/db/schema';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const checks: Record<string, { ok: boolean; latencyMs: number; error?: string }> = {};

	// Check canonical DuckDB
	const t0 = performance.now();
	try {
		await runCanonicalQuery('SELECT 1');
		checks.canonicalDb = { ok: true, latencyMs: Math.round(performance.now() - t0) };
	} catch (e) {
		checks.canonicalDb = {
			ok: false,
			latencyMs: Math.round(performance.now() - t0),
			error: e instanceof Error ? e.message : String(e)
		};
	}

	// Check SQLite metadata DB
	const t1 = performance.now();
	try {
		const db = getDb();
		await db.select({ count: sql<number>`count(*)` }).from(indicators).limit(1);
		checks.metadataDb = { ok: true, latencyMs: Math.round(performance.now() - t1) };
	} catch (e) {
		checks.metadataDb = {
			ok: false,
			latencyMs: Math.round(performance.now() - t1),
			error: e instanceof Error ? e.message : String(e)
		};
	}

	const allOk = Object.values(checks).every((c) => c.ok);

	return json(
		{
			status: allOk ? 'ok' : 'error',
			canonicalDbPath: getCanonicalDbPath(),
			canonicalSchemaVersion: CANONICAL_SCHEMA_VERSION,
			checks
		},
		{ status: allOk ? 200 : 503 }
	);
};
