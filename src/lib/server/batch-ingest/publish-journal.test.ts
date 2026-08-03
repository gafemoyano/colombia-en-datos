import { access, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireCanonicalWriterLease } from '../canonical-writer-lease';
import {
	advancePublishJournal,
	beginPublishJournal,
	determinePublishRecoveryAction,
	readPublishJournal,
	reconcilePublishJournals,
	resolvePublishJournalPath,
	type PublishGenerationState
} from './publish-journal';

const stagedIntegrity = {
	algorithm: 'sha256' as const,
	digest: 'staged-manifest-digest',
	byteLength: 128
};
const candidateIntegrity = {
	algorithm: 'sha256' as const,
	digest: 'candidate-digest',
	byteLength: 1024
};

async function expectMissing(path: string) {
	await expect(access(path)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function createJournal(directory: string, batchId = 42) {
	const storageRoot = join(directory, 'ingest', 'batches');
	const journalPath = resolvePublishJournalPath(batchId, storageRoot);
	const canonicalPath = join(directory, 'observations.duckdb');
	const candidatePath = `${canonicalPath}.publish-${batchId}.candidate`;
	const previousPath = `${canonicalPath}.previous`;
	const stagedManifestPath = join(storageRoot, String(batchId), 'staged', 'manifest.v1.json');
	await writeFile(canonicalPath, 'current');
	const journal = await beginPublishJournal({
		batchId,
		journalPath,
		stagedManifestPath,
		stagedManifestIntegrity: stagedIntegrity,
		canonicalPath,
		candidatePath,
		previousPath,
		now: new Date('2026-07-19T10:00:00.000Z')
	});
	return { storageRoot, journalPath, canonicalPath, candidatePath, previousPath, journal };
}

describe('batch publish journal', () => {
	it('uses the batch id as an idempotency key and advances durable checkpoints in order', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-publish-journal-'));
		try {
			const paths = await createJournal(directory);
			const duplicate = await beginPublishJournal({
				batchId: 42,
				journalPath: paths.journalPath,
				stagedManifestPath: join(paths.storageRoot, '42', 'staged', 'manifest.v1.json'),
				stagedManifestIntegrity: stagedIntegrity,
				canonicalPath: paths.canonicalPath,
				candidatePath: paths.candidatePath,
				previousPath: paths.previousPath
			});
			expect(duplicate.publishId).toBe('42');
			expect(duplicate.checkpoints).toEqual([
				{ checkpoint: 'publishing', at: '2026-07-19T10:00:00.000Z' }
			]);

			await expect(
				advancePublishJournal({
					journalPath: paths.journalPath,
					checkpoint: 'canonical-promoted'
				})
			).rejects.toThrow('cannot skip');
			await expect(
				advancePublishJournal({
					journalPath: paths.journalPath,
					checkpoint: 'candidate-built'
				})
			).rejects.toThrow('Candidate integrity is required');

			const candidateBuilt = await advancePublishJournal({
				journalPath: paths.journalPath,
				checkpoint: 'candidate-built',
				candidateIntegrity,
				now: new Date('2026-07-19T10:01:00.000Z')
			});
			expect(candidateBuilt.generation.candidateIntegrity).toEqual(candidateIntegrity);
			expect((await readPublishJournal(paths.journalPath)).checkpoint).toBe('candidate-built');
			expect(
				(await readdir(join(paths.storageRoot, '42', 'publish'))).filter((name) =>
					name.includes('.tmp-')
				)
			).toEqual([]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('classifies interrupted generation and cross-store checkpoints without performing publish work', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-publish-recovery-'));
		try {
			const paths = await createJournal(directory);
			const currentOnly: PublishGenerationState = {
				canonicalExists: true,
				candidateExists: false,
				previousExists: false
			};
			expect(determinePublishRecoveryAction(paths.journal, currentOnly)).toBe('build-candidate');
			expect(
				determinePublishRecoveryAction(paths.journal, {
					...currentOnly,
					previousExists: true
				})
			).toBe('build-candidate');

			await writeFile(paths.candidatePath, 'candidate');
			let journal = await advancePublishJournal({
				journalPath: paths.journalPath,
				checkpoint: 'candidate-built',
				candidateIntegrity
			});
			expect(
				determinePublishRecoveryAction(journal, {
					canonicalExists: true,
					candidateExists: true,
					previousExists: false
				})
			).toBe('promote-candidate');

			await rename(paths.canonicalPath, paths.previousPath);
			await rename(paths.candidatePath, paths.canonicalPath);
			const report = await reconcilePublishJournals({
				storageRoot: paths.storageRoot,
				leasePath: join(directory, 'missing-lease.json'),
				now: new Date('2026-07-19T10:02:00.000Z')
			});
			expect(report.entries).toHaveLength(1);
			expect(report.entries[0]).toMatchObject({
				action: 'commit-lineage',
				generation: {
					canonicalExists: true,
					candidateExists: false,
					previousExists: true
				}
			});
			expect(report.entries[0].journal.recoveries).toEqual([
				{
					fromCheckpoint: 'candidate-built',
					action: 'commit-lineage',
					at: '2026-07-19T10:02:00.000Z'
				}
			]);

			journal = await advancePublishJournal({
				journalPath: paths.journalPath,
				checkpoint: 'backup-created'
			});
			journal = await advancePublishJournal({
				journalPath: paths.journalPath,
				checkpoint: 'canonical-promoted'
			});
			expect(determinePublishRecoveryAction(journal, report.entries[0].generation)).toBe(
				'commit-lineage'
			);
			journal = await advancePublishJournal({
				journalPath: paths.journalPath,
				checkpoint: 'lineage-committed'
			});
			expect(determinePublishRecoveryAction(journal, report.entries[0].generation)).toBe(
				'finalize-manifest'
			);
			journal = await advancePublishJournal({
				journalPath: paths.journalPath,
				checkpoint: 'manifest-finalized'
			});
			expect(determinePublishRecoveryAction(journal, report.entries[0].generation)).toBe(
				'complete'
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('removes only a stale batch-publish lease that has a matching durable journal', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-publish-stale-lease-'));
		const leasePath = join(directory, 'writer-lease.json');
		const paths = await createJournal(directory);
		const lease = await acquireCanonicalWriterLease({
			operation: 'batch-publish',
			operationId: '42',
			leasePath,
			now: () => new Date('2026-07-19T10:00:00.000Z')
		});
		try {
			const fresh = await reconcilePublishJournals({
				storageRoot: paths.storageRoot,
				leasePath,
				staleLeaseAfterMs: 60_000,
				now: new Date('2026-07-19T10:00:30.000Z')
			});
			expect(fresh.staleLeaseRemoved).toBe(false);
			expect(fresh.entries).toEqual([]);
			expect((await readPublishJournal(paths.journalPath)).recoveries).toEqual([]);

			const stale = await reconcilePublishJournals({
				storageRoot: paths.storageRoot,
				leasePath,
				staleLeaseAfterMs: 60_000,
				now: new Date('2026-07-19T10:02:00.000Z')
			});
			expect(stale.staleLeaseRemoved).toBe(true);
			expect(stale.entries).toHaveLength(1);
			await expectMissing(leasePath);
		} finally {
			await lease.release();
			await rm(directory, { recursive: true, force: true });
		}
	});
});
