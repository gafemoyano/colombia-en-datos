import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	acquireCanonicalWriterLease,
	readCanonicalWriterLease,
	resolveCanonicalWriterLeasePath,
	withCanonicalWriterLease
} from './canonical-writer-lease';

async function expectMissing(path: string) {
	await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

function runCanonicalRebuild(
	env: NodeJS.ProcessEnv
): Promise<{ code: number | null; output: string }> {
	return new Promise((resolveResult, reject) => {
		const child = spawn(
			resolve(process.cwd(), 'node_modules/.bin/tsx'),
			[resolve(process.cwd(), 'scripts/create-canonical-store.ts')],
			{ cwd: process.cwd(), env: { ...process.env, ...env } }
		);
		let output = '';
		child.stdout.on('data', (chunk) => (output += String(chunk)));
		child.stderr.on('data', (chunk) => (output += String(chunk)));
		child.on('error', reject);
		child.on('close', (code) => resolveResult({ code, output }));
	});
}

describe('canonical DuckDB writer lease', () => {
	it('resolves one shared lease path from DATA_PATH', () => {
		expect(resolveCanonicalWriterLeasePath({ dataPath: '/data' })).toBe(
			'/data/.canonical-writer-lease.v1.json'
		);
		expect(resolveCanonicalWriterLeasePath({ dataPath: null, cwd: '/workspace/app' })).toBe(
			resolve('/workspace/app/data/.canonical-writer-lease.v1.json')
		);
	});

	it('creates the lease atomically, records holder metadata, and updates its heartbeat', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-writer-lease-'));
		const leasePath = join(directory, 'writer.json');
		const times = [new Date('2026-07-18T10:00:00.000Z'), new Date('2026-07-18T10:00:10.000Z')];
		const lease = await acquireCanonicalWriterLease({
			operation: 'batch-publish',
			operationId: 'batch-42',
			leasePath,
			now: () => times.shift()!
		});

		try {
			expect(await readCanonicalWriterLease(leasePath)).toMatchObject({
				schemaVersion: 1,
				operation: 'batch-publish',
				operationId: 'batch-42',
				processId: process.pid,
				acquiredAt: '2026-07-18T10:00:00.000Z',
				heartbeatAt: '2026-07-18T10:00:00.000Z'
			});

			await expect(
				acquireCanonicalWriterLease({
					operation: 'canonical-rebuild',
					operationId: 'manual-rebuild',
					leasePath
				})
			).rejects.toMatchObject({
				name: 'CanonicalWriterLeaseBusyError',
				holder: { operationId: 'batch-42' }
			});

			await lease.heartbeat();
			expect((await readCanonicalWriterLease(leasePath))?.heartbeatAt).toBe(
				'2026-07-18T10:00:10.000Z'
			);
		} finally {
			await lease.release();
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('releases the lease when guarded work fails', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-writer-release-'));
		const leasePath = join(directory, 'writer.json');
		try {
			await expect(
				withCanonicalWriterLease({
					operation: 'canonical-rebuild',
					operationId: 'failed-rebuild',
					leasePath,
					run: async () => {
						throw new Error('build failed');
					}
				})
			).rejects.toThrow('build failed');
			await expectMissing(leasePath);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('makes the canonical rebuild command honor an existing shared lease', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-rebuild-lease-'));
		const leasePath = resolveCanonicalWriterLeasePath({ dataPath: directory });
		const lease = await acquireCanonicalWriterLease({
			operation: 'batch-publish',
			operationId: 'publish-77',
			leasePath
		});

		try {
			const result = await runCanonicalRebuild({
				DATA_PATH: directory,
				CANONICAL_REBUILD_ID: 'blocked-rebuild'
			});
			expect(result.code).toBe(1);
			expect(result.output).toContain('Canonical DuckDB writer lease is already held');
			expect(result.output).toContain('publish-77');
			expect(await readCanonicalWriterLease(leasePath)).toMatchObject({
				operation: 'batch-publish',
				operationId: 'publish-77'
			});
		} finally {
			await lease.release();
			await rm(directory, { recursive: true, force: true });
		}
	}, 15_000);
});
