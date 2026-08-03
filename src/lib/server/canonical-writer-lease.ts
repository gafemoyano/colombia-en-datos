import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export const CANONICAL_WRITER_LEASE_SCHEMA_VERSION = 1 as const;
export const CANONICAL_WRITER_LEASE_FILE = '.canonical-writer-lease.v1.json';
export const DEFAULT_CANONICAL_WRITER_HEARTBEAT_MS = 10_000;
export const DEFAULT_CANONICAL_WRITER_STALE_MS = 60_000;

export type CanonicalWriterOperation = 'batch-publish' | 'canonical-rebuild';

export interface CanonicalWriterLeaseMetadata {
	schemaVersion: typeof CANONICAL_WRITER_LEASE_SCHEMA_VERSION;
	token: string;
	operation: CanonicalWriterOperation;
	operationId: string;
	processId: number;
	hostname: string;
	acquiredAt: string;
	heartbeatAt: string;
}

export interface CanonicalWriterLease {
	path: string;
	metadata: Readonly<CanonicalWriterLeaseMetadata>;
	heartbeat(): Promise<void>;
	release(): Promise<void>;
}

export class CanonicalWriterLeaseBusyError extends Error {
	readonly leasePath: string;
	readonly holder: CanonicalWriterLeaseMetadata | null;

	constructor(leasePath: string, holder: CanonicalWriterLeaseMetadata | null) {
		const owner = holder
			? `${holder.operation} ${holder.operationId} (pid ${holder.processId}, heartbeat ${holder.heartbeatAt})`
			: 'an unreadable lease holder';
		super(`Canonical DuckDB writer lease is already held by ${owner}: ${leasePath}`);
		this.name = 'CanonicalWriterLeaseBusyError';
		this.leasePath = leasePath;
		this.holder = holder;
	}
}

export function resolveCanonicalWriterLeasePath(
	options: { dataPath?: string | null; cwd?: string } = {}
): string {
	const configuredDataPath =
		options.dataPath === undefined ? process.env.DATA_PATH : options.dataPath;
	const dataPath = configuredDataPath
		? resolve(configuredDataPath)
		: resolve(options.cwd || process.cwd(), 'data');
	return resolve(dataPath, CANONICAL_WRITER_LEASE_FILE);
}

function parseLeaseMetadata(value: string): CanonicalWriterLeaseMetadata | null {
	try {
		const parsed = JSON.parse(value) as Partial<CanonicalWriterLeaseMetadata>;
		if (
			parsed.schemaVersion !== CANONICAL_WRITER_LEASE_SCHEMA_VERSION ||
			typeof parsed.token !== 'string' ||
			(parsed.operation !== 'batch-publish' && parsed.operation !== 'canonical-rebuild') ||
			typeof parsed.operationId !== 'string' ||
			typeof parsed.processId !== 'number' ||
			typeof parsed.hostname !== 'string' ||
			typeof parsed.acquiredAt !== 'string' ||
			typeof parsed.heartbeatAt !== 'string'
		) {
			return null;
		}
		return parsed as CanonicalWriterLeaseMetadata;
	} catch {
		return null;
	}
}

export async function readCanonicalWriterLease(
	leasePath = resolveCanonicalWriterLeasePath()
): Promise<CanonicalWriterLeaseMetadata | null> {
	try {
		return parseLeaseMetadata(await readFile(leasePath, 'utf8'));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
		throw error;
	}
}

export function isCanonicalWriterLeaseStale(
	metadata: CanonicalWriterLeaseMetadata,
	options: { staleAfterMs?: number; now?: Date } = {}
): boolean {
	const staleAfterMs = options.staleAfterMs ?? DEFAULT_CANONICAL_WRITER_STALE_MS;
	if (!Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
		throw new Error('Canonical writer staleAfterMs must be a positive number.');
	}
	const heartbeatAt = Date.parse(metadata.heartbeatAt);
	if (!Number.isFinite(heartbeatAt)) return false;
	return (options.now || new Date()).getTime() - heartbeatAt >= staleAfterMs;
}

export async function removeStaleCanonicalWriterLease(params: {
	leasePath?: string;
	expectedToken: string;
	staleAfterMs?: number;
	now?: Date;
}): Promise<boolean> {
	const leasePath = params.leasePath || resolveCanonicalWriterLeasePath();
	const metadata = await readCanonicalWriterLease(leasePath);
	if (
		!metadata ||
		metadata.token !== params.expectedToken ||
		!isCanonicalWriterLeaseStale(metadata, {
			staleAfterMs: params.staleAfterMs,
			now: params.now
		})
	) {
		return false;
	}
	await unlink(leasePath);
	return true;
}

async function writeMetadata(handle: FileHandle, metadata: CanonicalWriterLeaseMetadata) {
	const content = `${JSON.stringify(metadata, null, 2)}\n`;
	await handle.truncate(0);
	await handle.write(content, 0, 'utf8');
	await handle.sync();
}

export async function acquireCanonicalWriterLease(params: {
	operation: CanonicalWriterOperation;
	operationId: string;
	leasePath?: string;
	now?: () => Date;
}): Promise<CanonicalWriterLease> {
	if (!params.operationId.trim())
		throw new Error('Canonical writer operationId must not be empty.');

	const leasePath = params.leasePath || resolveCanonicalWriterLeasePath();
	const now = params.now || (() => new Date());
	await mkdir(dirname(leasePath), { recursive: true });

	let handle: FileHandle;
	try {
		handle = await open(leasePath, 'wx');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
		throw new CanonicalWriterLeaseBusyError(leasePath, await readCanonicalWriterLease(leasePath));
	}

	const acquiredAt = now().toISOString();
	let metadata: CanonicalWriterLeaseMetadata = {
		schemaVersion: CANONICAL_WRITER_LEASE_SCHEMA_VERSION,
		token: randomUUID(),
		operation: params.operation,
		operationId: params.operationId,
		processId: process.pid,
		hostname: hostname(),
		acquiredAt,
		heartbeatAt: acquiredAt
	};
	let released = false;

	try {
		await writeMetadata(handle, metadata);
	} catch (error) {
		await handle.close().catch(() => undefined);
		await unlink(leasePath).catch(() => undefined);
		throw error;
	}

	return {
		path: leasePath,
		get metadata() {
			return metadata;
		},
		async heartbeat() {
			if (released) throw new Error('Cannot heartbeat a released canonical writer lease.');
			const current = await readCanonicalWriterLease(leasePath);
			if (!current || current.token !== metadata.token) {
				throw new Error(`Canonical DuckDB writer lease ownership was lost: ${leasePath}`);
			}
			metadata = { ...metadata, heartbeatAt: now().toISOString() };
			await writeMetadata(handle, metadata);
		},
		async release() {
			if (released) return;
			released = true;
			try {
				const current = await readCanonicalWriterLease(leasePath);
				if (current?.token === metadata.token) await unlink(leasePath);
			} finally {
				await handle.close();
			}
		}
	};
}

export async function withCanonicalWriterLease<T>(params: {
	operation: CanonicalWriterOperation;
	operationId: string;
	leasePath?: string;
	heartbeatIntervalMs?: number;
	run: (lease: CanonicalWriterLease) => Promise<T>;
}): Promise<T> {
	const lease = await acquireCanonicalWriterLease(params);
	const heartbeatIntervalMs = params.heartbeatIntervalMs ?? DEFAULT_CANONICAL_WRITER_HEARTBEAT_MS;
	if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
		await lease.release();
		throw new Error('Canonical writer heartbeatIntervalMs must be a positive number.');
	}

	let heartbeatError: unknown;
	let pendingHeartbeat = Promise.resolve();
	const timer = setInterval(() => {
		pendingHeartbeat = pendingHeartbeat
			.then(() => lease.heartbeat())
			.catch((error) => {
				heartbeatError = error;
			});
	}, heartbeatIntervalMs);
	timer.unref();

	let result: T | undefined;
	let runError: unknown;
	try {
		result = await params.run(lease);
	} catch (error) {
		runError = error;
	}

	clearInterval(timer);
	await pendingHeartbeat;
	await lease.release();
	if (runError) throw runError;
	if (heartbeatError) throw heartbeatError;
	return result as T;
}
