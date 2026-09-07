// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import duckdb from 'duckdb';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';

const { getDb } = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('$lib/db/client', () => ({ getDb }));
const dir = mkdtempSync(join(tmpdir(), 'availability-'));
const registry = createClient({ url: ':memory:' });

beforeAll(async () => {
	getDb.mockReturnValue(drizzle(registry));
	await registry.executeMultiple(`
		CREATE TABLE indicators (id INTEGER, code TEXT);
		CREATE TABLE indicator_data_sources (indicator_id INTEGER, release_id INTEGER, freq TEXT);
		CREATE TABLE data_releases (id INTEGER, status TEXT);
		INSERT INTO indicators VALUES (1, 'BOTH'), (2, 'UNPUBLISHED'), (3, 'UNOBSERVED');
		INSERT INTO data_releases VALUES (1, 'published'), (2, 'draft');
		INSERT INTO indicator_data_sources VALUES
			(1, 1, 'A'), (1, 1, 'A'), (1, 1, 'M'), (2, 2, 'A'), (3, 1, 'A');
	`);
	const path = join(dir, 'observations.duckdb');
	vi.stubEnv('CANONICAL_DUCKDB_PATH', path);
	const db = new duckdb.Database(path);
	await new Promise<void>((resolve, reject) =>
		db.exec(
			`
		CREATE TABLE _meta (key VARCHAR, value VARCHAR);
		INSERT INTO _meta VALUES ('schema_version', '2');
		CREATE TABLE indicator_meta (indicator_code VARCHAR, freqs VARCHAR);
		INSERT INTO indicator_meta VALUES ('BOTH', 'A'), ('UNPUBLISHED', 'A'), ('NO_RELEASE', 'M');
	`,
			(error) => (error ? reject(error) : resolve())
		)
	);
	await new Promise<void>((resolve, reject) =>
		db.close((error) => (error ? reject(error) : resolve()))
	);
});

afterAll(() => {
	registry.close();
	vi.unstubAllEnvs();
	rmSync(dir, { recursive: true, force: true });
});

it('requires both published and observed frequency pairs, without an observations table', async () => {
	const { getPublishedFrequenciesByIndicator, getAvailableFrequenciesByIndicator } =
		await import('./duckdb');
	expect(await getPublishedFrequenciesByIndicator()).toEqual(new Map([['BOTH', ['A']]]));
	expect(await getPublishedFrequenciesByIndicator(['UNPUBLISHED', 'UNOBSERVED'])).toEqual(
		new Map()
	);
	expect(await getAvailableFrequenciesByIndicator(['BOTH'])).toEqual(new Map([['BOTH', ['A']]]));
	expect(await getPublishedFrequenciesByIndicator([])).toEqual(new Map());
});
