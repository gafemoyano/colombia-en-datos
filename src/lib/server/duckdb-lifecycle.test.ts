import duckdb from 'duckdb';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	CanonicalQueryDrain,
	prepareCanonicalGeneration,
	promoteCanonicalGeneration,
	runCanonicalQuery
} from './duckdb';

function exec(database: duckdb.Database, sql: string): Promise<void> {
	return new Promise((resolveExec, reject) => {
		database.exec(sql, (error) => {
			if (error) reject(error);
			else resolveExec();
		});
	});
}

function close(database: duckdb.Database): Promise<void> {
	return new Promise((resolveClose, reject) => {
		database.close((error) => {
			if (error) reject(error);
			else resolveClose();
		});
	});
}

async function createGeneration(path: string, generation: string, schemaVersion = 1) {
	const database = new duckdb.Database(path);
	try {
		await exec(
			database,
			`CREATE TABLE _meta (key VARCHAR PRIMARY KEY, value VARCHAR NOT NULL);
			 INSERT INTO _meta VALUES ('schema_version', '${schemaVersion}');
			 CREATE TABLE generation (value VARCHAR NOT NULL);
			 INSERT INTO generation VALUES ('${generation}');`
		);
	} finally {
		await close(database);
	}
}

async function readGeneration(path: string): Promise<string> {
	const database = new duckdb.Database(path, { access_mode: 'READ_ONLY' });
	try {
		return await new Promise((resolveRows, reject) => {
			database.all('SELECT value FROM generation', (error, rows) => {
				if (error) reject(error);
				else resolveRows(String(rows[0].value));
			});
		});
	} finally {
		await close(database);
	}
}

async function expectMissing(path: string) {
	await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

function waitForNextTurn(): Promise<void> {
	return new Promise((resolve) => setImmediate(resolve));
}

const originalCanonicalPath = process.env.CANONICAL_DUCKDB_PATH;

afterEach(() => {
	if (originalCanonicalPath === undefined) delete process.env.CANONICAL_DUCKDB_PATH;
	else process.env.CANONICAL_DUCKDB_PATH = originalCanonicalPath;
});

describe('CanonicalQueryDrain', () => {
	it('waits for active queries and blocks new queries until the drained operation finishes', async () => {
		const coordinator = new CanonicalQueryDrain();
		let finishActive!: () => void;
		let finishDrain!: () => void;
		let drainStarted = false;
		let queuedStarted = false;

		const active = coordinator.run(
			() =>
				new Promise<void>((resolveActive) => {
					finishActive = resolveActive;
				})
		);
		const draining = coordinator.drain(
			() =>
				new Promise<void>((resolveDrain) => {
					drainStarted = true;
					finishDrain = resolveDrain;
				})
		);
		const queued = coordinator.run(async () => {
			queuedStarted = true;
		});

		await waitForNextTurn();
		expect(drainStarted).toBe(false);
		expect(queuedStarted).toBe(false);

		finishActive();
		await active;
		await waitForNextTurn();
		expect(drainStarted).toBe(true);
		expect(queuedStarted).toBe(false);

		finishDrain();
		await draining;
		await queued;
		expect(queuedStarted).toBe(true);
	});
});

describe('canonical DuckDB generation lifecycle', () => {
	it('closes, promotes, reopens, rolls back invalid candidates, and retains one previous generation', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-duckdb-generation-'));
		const canonicalPath = join(directory, 'observations.duckdb');
		const candidatePath = join(directory, 'observations.duckdb.next');
		const previousPath = `${canonicalPath}.previous`;
		process.env.CANONICAL_DUCKDB_PATH = canonicalPath;

		try {
			await createGeneration(canonicalPath, 'initial');
			expect(await runCanonicalQuery<{ value: string }>('SELECT value FROM generation')).toEqual([
				{ value: 'initial' }
			]);

			await prepareCanonicalGeneration(candidatePath);
			await createGeneration(candidatePath, 'published-1');
			await promoteCanonicalGeneration(candidatePath);
			expect(await runCanonicalQuery<{ value: string }>('SELECT value FROM generation')).toEqual([
				{ value: 'published-1' }
			]);
			expect(await readGeneration(previousPath)).toBe('initial');

			await prepareCanonicalGeneration(candidatePath);
			await expectMissing(previousPath);
			await createGeneration(candidatePath, 'invalid', 999);
			await expect(promoteCanonicalGeneration(candidatePath)).rejects.toThrow(
				'Canonical DuckDB schema version mismatch'
			);
			expect(await runCanonicalQuery<{ value: string }>('SELECT value FROM generation')).toEqual([
				{ value: 'published-1' }
			]);
			await expectMissing(previousPath);

			await prepareCanonicalGeneration(candidatePath);
			await createGeneration(candidatePath, 'published-2');
			await promoteCanonicalGeneration(candidatePath);
			expect(await runCanonicalQuery<{ value: string }>('SELECT value FROM generation')).toEqual([
				{ value: 'published-2' }
			]);
			expect(await readGeneration(previousPath)).toBe('published-1');
			await expectMissing(candidatePath);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);
});
