import { randomUUID } from 'node:crypto';
import { access, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
	isCanonicalWriterLeaseStale,
	readCanonicalWriterLease,
	removeStaleCanonicalWriterLease,
	resolveCanonicalWriterLeasePath,
	type CanonicalWriterLeaseMetadata
} from '../canonical-writer-lease';
import { batchStoragePaths, resolveBatchStorageRoot, type BatchSourceIntegrity } from './storage';

export const PUBLISH_JOURNAL_SCHEMA_VERSION = 1 as const;
export const PUBLISH_JOURNAL_ARTIFACT = 'publish/journal.v1.json';

export const PUBLISH_CHECKPOINTS = [
	'publishing',
	'candidate-built',
	'backup-created',
	'canonical-promoted',
	'lineage-committed',
	'manifest-finalized'
] as const;

export type PublishCheckpoint = (typeof PUBLISH_CHECKPOINTS)[number];
export type PublishRecoveryAction =
	| 'build-candidate'
	| 'promote-candidate'
	| 'commit-lineage'
	| 'finalize-manifest'
	| 'complete'
	| 'manual-recovery';

export interface PublishJournalCheckpointEntry {
	checkpoint: PublishCheckpoint;
	at: string;
}

export interface PublishJournalRecoveryEntry {
	fromCheckpoint: PublishCheckpoint;
	action: PublishRecoveryAction;
	at: string;
}

export interface PublishJournal {
	schemaVersion: typeof PUBLISH_JOURNAL_SCHEMA_VERSION;
	batchId: number;
	publishId: string;
	checkpoint: PublishCheckpoint;
	startedAt: string;
	updatedAt: string;
	stagedManifest: {
		path: string;
		integrity: BatchSourceIntegrity;
	};
	generation: {
		canonicalPath: string;
		candidatePath: string;
		previousPath: string;
		candidateIntegrity: BatchSourceIntegrity | null;
	};
	checkpoints: PublishJournalCheckpointEntry[];
	recoveries: PublishJournalRecoveryEntry[];
}

export interface PublishGenerationState {
	canonicalExists: boolean;
	candidateExists: boolean;
	previousExists: boolean;
}

export interface PublishReconciliation {
	journalPath: string;
	journal: PublishJournal;
	generation: PublishGenerationState;
	action: PublishRecoveryAction;
}

export interface PublishReconciliationReport {
	entries: PublishReconciliation[];
	staleLeaseRemoved: boolean;
	lease: CanonicalWriterLeaseMetadata | null;
}

const checkpointIndex = new Map<PublishCheckpoint, number>(
	PUBLISH_CHECKPOINTS.map((checkpoint, index) => [checkpoint, index])
);
const recoveryActions = new Set<PublishRecoveryAction>([
	'build-candidate',
	'promote-candidate',
	'commit-lineage',
	'finalize-manifest',
	'complete',
	'manual-recovery'
]);

function isIntegrity(value: unknown): value is BatchSourceIntegrity {
	if (!value || typeof value !== 'object') return false;
	const integrity = value as Partial<BatchSourceIntegrity>;
	return (
		integrity.algorithm === 'sha256' &&
		typeof integrity.digest === 'string' &&
		integrity.digest.length > 0 &&
		Number.isSafeInteger(integrity.byteLength) &&
		(integrity.byteLength ?? -1) >= 0
	);
}

function isCheckpoint(value: unknown): value is PublishCheckpoint {
	return typeof value === 'string' && checkpointIndex.has(value as PublishCheckpoint);
}

function requirePublishJournal(value: unknown, path: string): PublishJournal {
	if (!value || typeof value !== 'object') {
		throw new Error(`Invalid publish journal at ${path}: expected an object.`);
	}
	const journal = value as Partial<PublishJournal>;
	if (journal.schemaVersion !== PUBLISH_JOURNAL_SCHEMA_VERSION) {
		throw new Error(
			`Unsupported publish journal schema version at ${path}: ${String(journal.schemaVersion)}`
		);
	}
	if (!Number.isSafeInteger(journal.batchId) || (journal.batchId ?? 0) < 1) {
		throw new Error(`Invalid publish journal batch id at ${path}.`);
	}
	if (journal.publishId !== String(journal.batchId)) {
		throw new Error(`Publish journal idempotency key does not match its batch id at ${path}.`);
	}
	if (
		!isCheckpoint(journal.checkpoint) ||
		typeof journal.startedAt !== 'string' ||
		typeof journal.updatedAt !== 'string' ||
		!journal.stagedManifest ||
		typeof journal.stagedManifest.path !== 'string' ||
		!isIntegrity(journal.stagedManifest.integrity) ||
		!journal.generation ||
		typeof journal.generation.canonicalPath !== 'string' ||
		typeof journal.generation.candidatePath !== 'string' ||
		typeof journal.generation.previousPath !== 'string' ||
		(journal.generation.candidateIntegrity !== null &&
			!isIntegrity(journal.generation.candidateIntegrity)) ||
		!Array.isArray(journal.checkpoints) ||
		!Array.isArray(journal.recoveries)
	) {
		throw new Error(`Invalid publish journal shape at ${path}.`);
	}
	for (const entry of journal.checkpoints) {
		if (!isCheckpoint(entry?.checkpoint) || typeof entry.at !== 'string') {
			throw new Error(`Invalid publish journal checkpoint history at ${path}.`);
		}
	}
	for (const entry of journal.recoveries) {
		if (
			!isCheckpoint(entry?.fromCheckpoint) ||
			!recoveryActions.has(entry.action) ||
			typeof entry.at !== 'string'
		) {
			throw new Error(`Invalid publish journal recovery history at ${path}.`);
		}
	}
	return journal as PublishJournal;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, 'r');
	try {
		await handle.sync();
	} finally {
		await handle.close();
	}
}

async function writeJournalAtomically(path: string, journal: PublishJournal): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${randomUUID()}`;
	const handle = await open(temporaryPath, 'wx');
	try {
		await handle.writeFile(`${JSON.stringify(journal, null, 2)}\n`);
		await handle.sync();
	} finally {
		await handle.close();
	}

	try {
		await rename(temporaryPath, path);
		await syncDirectory(dirname(path));
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
}

export function resolvePublishJournalPath(batchId: number, storageRoot?: string): string {
	return join(batchStoragePaths(batchId, storageRoot).batchDir, PUBLISH_JOURNAL_ARTIFACT);
}

export function resolvePublishCandidatePath(batchId: number, canonicalPath: string): string {
	if (!Number.isSafeInteger(batchId) || batchId < 1) {
		throw new Error(`Invalid ingest batch id: ${String(batchId)}`);
	}
	return `${resolve(canonicalPath)}.publish-${batchId}.candidate`;
}

export async function readPublishJournal(path: string): Promise<PublishJournal> {
	return requirePublishJournal(JSON.parse(await readFile(path, 'utf8')), path);
}

export async function beginPublishJournal(params: {
	batchId: number;
	journalPath: string;
	stagedManifestPath: string;
	stagedManifestIntegrity: BatchSourceIntegrity;
	canonicalPath: string;
	candidatePath: string;
	previousPath: string;
	now?: Date;
}): Promise<PublishJournal> {
	if (!Number.isSafeInteger(params.batchId) || params.batchId < 1) {
		throw new Error(`Invalid ingest batch id: ${String(params.batchId)}`);
	}
	if (!isIntegrity(params.stagedManifestIntegrity)) {
		throw new Error('A valid staged manifest integrity is required to begin publishing.');
	}
	if (await pathExists(params.journalPath)) {
		const existing = await readPublishJournal(params.journalPath);
		if (
			existing.batchId !== params.batchId ||
			existing.stagedManifest.path !== resolve(params.stagedManifestPath) ||
			existing.stagedManifest.integrity.digest !== params.stagedManifestIntegrity.digest ||
			existing.generation.canonicalPath !== resolve(params.canonicalPath) ||
			existing.generation.candidatePath !== resolve(params.candidatePath) ||
			existing.generation.previousPath !== resolve(params.previousPath)
		) {
			throw new Error(`Publish journal ${params.journalPath} conflicts with this publish request.`);
		}
		return existing;
	}

	const at = (params.now || new Date()).toISOString();
	const journal: PublishJournal = {
		schemaVersion: PUBLISH_JOURNAL_SCHEMA_VERSION,
		batchId: params.batchId,
		publishId: String(params.batchId),
		checkpoint: 'publishing',
		startedAt: at,
		updatedAt: at,
		stagedManifest: {
			path: resolve(params.stagedManifestPath),
			integrity: params.stagedManifestIntegrity
		},
		generation: {
			canonicalPath: resolve(params.canonicalPath),
			candidatePath: resolve(params.candidatePath),
			previousPath: resolve(params.previousPath),
			candidateIntegrity: null
		},
		checkpoints: [{ checkpoint: 'publishing', at }],
		recoveries: []
	};
	await writeJournalAtomically(params.journalPath, journal);
	return journal;
}

export async function advancePublishJournal(params: {
	journalPath: string;
	checkpoint: PublishCheckpoint;
	candidateIntegrity?: BatchSourceIntegrity;
	now?: Date;
}): Promise<PublishJournal> {
	const journal = await readPublishJournal(params.journalPath);
	const currentIndex = checkpointIndex.get(journal.checkpoint)!;
	const nextIndex = checkpointIndex.get(params.checkpoint);
	if (nextIndex === undefined) throw new Error(`Invalid publish checkpoint: ${params.checkpoint}`);
	if (nextIndex < currentIndex) {
		throw new Error(
			`Publish journal cannot move backward from ${journal.checkpoint} to ${params.checkpoint}.`
		);
	}
	if (nextIndex === currentIndex) return journal;
	if (nextIndex !== currentIndex + 1) {
		throw new Error(
			`Publish journal cannot skip from ${journal.checkpoint} to ${params.checkpoint}.`
		);
	}
	if (params.checkpoint === 'candidate-built' && !isIntegrity(params.candidateIntegrity)) {
		throw new Error('Candidate integrity is required at the candidate-built checkpoint.');
	}

	const at = (params.now || new Date()).toISOString();
	const updated: PublishJournal = {
		...journal,
		checkpoint: params.checkpoint,
		updatedAt: at,
		generation: {
			...journal.generation,
			candidateIntegrity: params.candidateIntegrity || journal.generation.candidateIntegrity
		},
		checkpoints: [...journal.checkpoints, { checkpoint: params.checkpoint, at }]
	};
	await writeJournalAtomically(params.journalPath, updated);
	return updated;
}

export function determinePublishRecoveryAction(
	journal: PublishJournal,
	generation: PublishGenerationState
): PublishRecoveryAction {
	if (journal.checkpoint === 'manifest-finalized') return 'complete';
	if (journal.checkpoint === 'lineage-committed') return 'finalize-manifest';
	if (journal.checkpoint === 'canonical-promoted') return 'commit-lineage';
	if (journal.checkpoint === 'publishing') return 'build-candidate';

	if (generation.previousExists && !generation.canonicalExists && !generation.candidateExists) {
		return 'manual-recovery';
	}
	if (generation.previousExists && generation.canonicalExists && !generation.candidateExists) {
		return 'commit-lineage';
	}
	if (journal.checkpoint === 'backup-created') {
		return generation.candidateExists ? 'promote-candidate' : 'manual-recovery';
	}
	return generation.candidateExists ? 'promote-candidate' : 'build-candidate';
}

async function inspectGeneration(journal: PublishJournal): Promise<PublishGenerationState> {
	const [canonicalExists, candidateExists, previousExists] = await Promise.all([
		pathExists(journal.generation.canonicalPath),
		pathExists(journal.generation.candidatePath),
		pathExists(journal.generation.previousPath)
	]);
	return { canonicalExists, candidateExists, previousExists };
}

async function recordRecovery(
	journalPath: string,
	journal: PublishJournal,
	action: PublishRecoveryAction,
	now: Date
): Promise<PublishJournal> {
	if (action === 'complete') return journal;
	const at = now.toISOString();
	const updated: PublishJournal = {
		...journal,
		updatedAt: at,
		recoveries: [...journal.recoveries, { fromCheckpoint: journal.checkpoint, action, at }]
	};
	await writeJournalAtomically(journalPath, updated);
	return updated;
}

function batchIdFromLease(lease: CanonicalWriterLeaseMetadata): number | null {
	if (lease.operation !== 'batch-publish' || !/^\d+$/.test(lease.operationId)) return null;
	const batchId = Number(lease.operationId);
	return Number.isSafeInteger(batchId) && batchId > 0 ? batchId : null;
}

export async function reconcilePublishJournals(
	options: {
		storageRoot?: string;
		leasePath?: string;
		staleLeaseAfterMs?: number;
		now?: Date;
	} = {}
): Promise<PublishReconciliationReport> {
	const storageRoot = options.storageRoot || resolveBatchStorageRoot();
	const now = options.now || new Date();
	const leasePath = options.leasePath || resolveCanonicalWriterLeasePath();
	const lease = await readCanonicalWriterLease(leasePath);
	const leasedBatchId = lease ? batchIdFromLease(lease) : null;
	const leaseIsFresh =
		lease !== null &&
		!isCanonicalWriterLeaseStale(lease, {
			staleAfterMs: options.staleLeaseAfterMs,
			now
		});
	let directories: string[] = [];
	try {
		directories = (await readdir(storageRoot, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
			.map((entry) => entry.name)
			.sort((left, right) => Number(left) - Number(right));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}

	const entries: PublishReconciliation[] = [];
	for (const directory of directories) {
		const journalPath = resolvePublishJournalPath(Number(directory), storageRoot);
		if (!(await pathExists(journalPath))) continue;
		let journal = await readPublishJournal(journalPath);
		if (leaseIsFresh && journal.batchId === leasedBatchId) continue;
		const generation = await inspectGeneration(journal);
		const action = determinePublishRecoveryAction(journal, generation);
		journal = await recordRecovery(journalPath, journal, action, now);
		entries.push({ journalPath, journal, generation, action });
	}

	let staleLeaseRemoved = false;
	if (lease) {
		const batchId = batchIdFromLease(lease);
		const hasMatchingJournal =
			batchId !== null && entries.some((entry) => entry.journal.batchId === batchId);
		if (hasMatchingJournal) {
			staleLeaseRemoved = await removeStaleCanonicalWriterLease({
				leasePath,
				expectedToken: lease.token,
				staleAfterMs: options.staleLeaseAfterMs,
				now
			});
		}
	}

	return { entries, staleLeaseRemoved, lease };
}
