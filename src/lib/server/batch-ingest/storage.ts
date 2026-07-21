import { createHash, randomUUID } from 'node:crypto';
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
	BatchDiagnostic,
	BatchMappingTransform,
	BatchProfile,
	CanonicalBatchField,
	CanonicalDimensionField
} from './types';

export const BATCH_INTAKE_MANIFEST_SCHEMA_VERSION = 1 as const;
export const ACCEPTED_MAPPING_MANIFEST_SCHEMA_VERSION = 1 as const;
export const BATCH_STAGING_INPUT_SCHEMA_VERSION = 1 as const;
export const STAGED_BATCH_MANIFEST_SCHEMA_VERSION = 1 as const;

export const BATCH_SOURCE_ARTIFACT = 'source/source.parquet';
export const BATCH_PROFILE_ARTIFACT = 'analysis/profile.v1.json';
export const BATCH_INTAKE_MANIFEST_ARTIFACT = 'manifests/intake.v1.json';
export const ACCEPTED_MAPPING_MANIFEST_ARTIFACT = 'manifests/accepted-mapping.v1.json';
export const BATCH_STAGING_INPUT_ARTIFACT = 'manifests/staging-input.v1.json';
export const STAGED_BATCH_MANIFEST_ARTIFACT = 'staged/manifest.v1.json';

export interface BatchSourceIntegrity {
	algorithm: 'sha256';
	digest: string;
	byteLength: number;
}

export interface BatchIntakeManifest {
	schemaVersion: typeof BATCH_INTAKE_MANIFEST_SCHEMA_VERSION;
	batchId: number;
	createdAt: string;
	dataSourceCode: string | null;
	source: {
		artifact: typeof BATCH_SOURCE_ARTIFACT;
		originalName: string;
		format: 'parquet';
		integrity: BatchSourceIntegrity;
	};
	analysis: {
		artifact: typeof BATCH_PROFILE_ARTIFACT;
		profileSchemaVersion: BatchProfile['schemaVersion'];
		analyzedAt: string;
	};
}

export interface AcceptedBatchColumnMapping {
	sourceColumn: string;
	canonicalField: CanonicalBatchField | null;
	transforms: BatchMappingTransform[];
}

export interface CollapsedFixedDimension {
	sliceKey: string;
	sourceColumn: string;
	canonicalField: CanonicalDimensionField;
	dimensionCode: string;
	value: string | null;
}

export interface AcceptedMappingManifest {
	schemaVersion: typeof ACCEPTED_MAPPING_MANIFEST_SCHEMA_VERSION;
	batchId: number;
	acceptedAt: string;
	sourceIntegrity: BatchSourceIntegrity;
	mappings: AcceptedBatchColumnMapping[];
	collapsedDimensions: CollapsedFixedDimension[];
}

export interface BatchStagingInput {
	schemaVersion: typeof BATCH_STAGING_INPUT_SCHEMA_VERSION;
	batchId: number;
	createdAt: string;
	source: {
		artifact: typeof BATCH_SOURCE_ARTIFACT;
		integrity: BatchSourceIntegrity;
	};
	acceptedMapping: {
		artifact: typeof ACCEPTED_MAPPING_MANIFEST_ARTIFACT;
		schemaVersion: typeof ACCEPTED_MAPPING_MANIFEST_SCHEMA_VERSION;
	};
}

export type StagedSliceArtifact = `staged/slices/${number}.parquet`;

export interface StagedCanonicalColumn {
	name: string;
	type: 'VARCHAR' | 'DOUBLE';
	nullable: boolean;
}

export interface StagedRefAreaSummary {
	refArea: string;
	rowCount: number;
	periodStart: string | null;
	periodEnd: string | null;
}

export interface StagedSliceSummary {
	sliceId: number;
	indicatorCode: string;
	freq: string;
	indicatorId: number | null;
	artifact: StagedSliceArtifact | null;
	integrity: BatchSourceIntegrity | null;
	canonicalSchema: StagedCanonicalColumn[];
	rowCount: number;
	periodStart: string | null;
	periodEnd: string | null;
	refAreas: StagedRefAreaSummary[];
	collapsedDimensions: CollapsedFixedDimension[];
	validation: {
		valid: boolean;
		errorCount: number;
		warningCount: number;
		diagnostics: BatchDiagnostic[];
	};
}

export interface StagedBatchManifest {
	schemaVersion: typeof STAGED_BATCH_MANIFEST_SCHEMA_VERSION;
	batchId: number;
	stagedAt: string;
	stagingInput: {
		artifact: typeof BATCH_STAGING_INPUT_ARTIFACT;
		schemaVersion: typeof BATCH_STAGING_INPUT_SCHEMA_VERSION;
	};
	sourceIntegrity: BatchSourceIntegrity;
	acceptedMappingIntegrity: BatchSourceIntegrity;
	validation: {
		valid: boolean;
		errorCount: number;
		warningCount: number;
		diagnostics: BatchDiagnostic[];
	};
	slices: StagedSliceSummary[];
	totals: {
		sliceCount: number;
		rowCount: number;
		validSliceCount: number;
		failedSliceCount: number;
	};
}

export interface BatchStoragePaths {
	root: string;
	batchDir: string;
	source: string;
	profile: string;
	intakeManifest: string;
	acceptedMappingManifest: string;
	stagingInput: string;
	stagedManifest: string;
}

export function resolveBatchStorageRoot(
	options: {
		dataPath?: string | null;
		cwd?: string;
	} = {}
): string {
	const configuredDataPath =
		options.dataPath === undefined ? process.env.DATA_PATH : options.dataPath;
	const dataPath = configuredDataPath
		? resolve(configuredDataPath)
		: resolve(options.cwd || process.cwd(), 'data');
	return join(dataPath, 'ingest', 'batches');
}

export function batchStoragePaths(
	batchId: number,
	root = resolveBatchStorageRoot()
): BatchStoragePaths {
	if (!Number.isSafeInteger(batchId) || batchId < 1) {
		throw new Error(`Invalid ingest batch id: ${String(batchId)}`);
	}

	const batchDir = join(root, String(batchId));
	return {
		root,
		batchDir,
		source: join(batchDir, BATCH_SOURCE_ARTIFACT),
		profile: join(batchDir, BATCH_PROFILE_ARTIFACT),
		intakeManifest: join(batchDir, BATCH_INTAKE_MANIFEST_ARTIFACT),
		acceptedMappingManifest: join(batchDir, ACCEPTED_MAPPING_MANIFEST_ARTIFACT),
		stagingInput: join(batchDir, BATCH_STAGING_INPUT_ARTIFACT),
		stagedManifest: join(batchDir, STAGED_BATCH_MANIFEST_ARTIFACT)
	};
}

export function sourceIntegrity(buffer: Uint8Array): BatchSourceIntegrity {
	return {
		algorithm: 'sha256',
		digest: createHash('sha256').update(buffer).digest('hex'),
		byteLength: buffer.byteLength
	};
}

async function writeImmutable(path: string, content: Uint8Array | string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const bytes = Buffer.from(content);
	const temporaryPath = `${path}.tmp-${randomUUID()}`;

	try {
		const handle = await open(temporaryPath, 'wx');
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}

		try {
			await link(temporaryPath, path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
			const existing = await readFile(path);
			if (!existing.equals(bytes)) {
				throw new Error(`Immutable batch artifact already exists with different content: ${path}`);
			}
		}
	} finally {
		await unlink(temporaryPath).catch(() => undefined);
	}
}

async function writeImmutableJson(path: string, value: unknown): Promise<void> {
	await writeImmutable(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function readVersionedJson<T extends { schemaVersion: number }>(
	path: string,
	expectedVersion: number,
	label: string
): Promise<T> {
	const value = JSON.parse(await readFile(path, 'utf8')) as T;
	if (value.schemaVersion !== expectedVersion) {
		throw new Error(
			`Unsupported ${label} schema version: ${String(value.schemaVersion)} (expected ${expectedVersion})`
		);
	}
	return value;
}

export async function persistBatchSource(
	paths: BatchStoragePaths,
	source: Uint8Array
): Promise<void> {
	await writeImmutable(paths.source, source);
}

export async function persistBatchAnalysisArtifacts(params: {
	paths: BatchStoragePaths;
	profile: BatchProfile;
	manifest: BatchIntakeManifest;
}): Promise<void> {
	await writeImmutableJson(params.paths.profile, params.profile);
	await writeImmutableJson(params.paths.intakeManifest, params.manifest);
}

export async function persistAcceptedMappingArtifacts(params: {
	paths: BatchStoragePaths;
	manifest: AcceptedMappingManifest;
	stagingInput: BatchStagingInput;
}): Promise<void> {
	await writeImmutableJson(params.paths.acceptedMappingManifest, params.manifest);
	await writeImmutableJson(params.paths.stagingInput, params.stagingInput);
}

export async function persistStagedBatchManifest(
	paths: BatchStoragePaths,
	manifest: StagedBatchManifest
): Promise<void> {
	await writeImmutableJson(paths.stagedManifest, manifest);
}

export async function readBatchIntakeManifest(
	paths: BatchStoragePaths
): Promise<BatchIntakeManifest> {
	return readVersionedJson(
		paths.intakeManifest,
		BATCH_INTAKE_MANIFEST_SCHEMA_VERSION,
		'batch intake manifest'
	);
}

export async function readAcceptedMappingManifest(
	paths: BatchStoragePaths
): Promise<AcceptedMappingManifest> {
	return readVersionedJson(
		paths.acceptedMappingManifest,
		ACCEPTED_MAPPING_MANIFEST_SCHEMA_VERSION,
		'accepted mapping manifest'
	);
}

export async function readBatchStagingInput(paths: BatchStoragePaths): Promise<BatchStagingInput> {
	return readVersionedJson(
		paths.stagingInput,
		BATCH_STAGING_INPUT_SCHEMA_VERSION,
		'batch staging input'
	);
}

export async function readStagedBatchManifest(
	paths: BatchStoragePaths
): Promise<StagedBatchManifest> {
	return readVersionedJson(
		paths.stagedManifest,
		STAGED_BATCH_MANIFEST_SCHEMA_VERSION,
		'staged batch manifest'
	);
}

export function createAcceptedMappingManifest(params: {
	batchId: number;
	acceptedAt?: string;
	sourceIntegrity: BatchSourceIntegrity;
	mappings: AcceptedBatchColumnMapping[];
	collapsedDimensions: CollapsedFixedDimension[];
}): AcceptedMappingManifest {
	return {
		schemaVersion: ACCEPTED_MAPPING_MANIFEST_SCHEMA_VERSION,
		batchId: params.batchId,
		acceptedAt: params.acceptedAt || new Date().toISOString(),
		sourceIntegrity: params.sourceIntegrity,
		mappings: params.mappings
			.map((mapping) => ({ ...mapping, transforms: [...mapping.transforms] }))
			.sort((a, b) => a.sourceColumn.localeCompare(b.sourceColumn)),
		collapsedDimensions: params.collapsedDimensions
			.map((dimension) => ({ ...dimension }))
			.sort(
				(a, b) =>
					a.sliceKey.localeCompare(b.sliceKey) ||
					a.dimensionCode.localeCompare(b.dimensionCode) ||
					a.sourceColumn.localeCompare(b.sourceColumn)
			)
	};
}

export function createBatchStagingInput(
	manifest: AcceptedMappingManifest,
	createdAt = new Date().toISOString()
): BatchStagingInput {
	return {
		schemaVersion: BATCH_STAGING_INPUT_SCHEMA_VERSION,
		batchId: manifest.batchId,
		createdAt,
		source: {
			artifact: BATCH_SOURCE_ARTIFACT,
			integrity: manifest.sourceIntegrity
		},
		acceptedMapping: {
			artifact: ACCEPTED_MAPPING_MANIFEST_ARTIFACT,
			schemaVersion: ACCEPTED_MAPPING_MANIFEST_SCHEMA_VERSION
		}
	};
}

export function stagedSliceArtifact(sliceId: number): StagedSliceArtifact {
	if (!Number.isSafeInteger(sliceId) || sliceId < 1) {
		throw new Error(`Invalid ingest batch slice id: ${String(sliceId)}`);
	}
	return `staged/slices/${sliceId}.parquet`;
}

export function createStagedBatchManifest(params: {
	batchId: number;
	stagedAt?: string;
	sourceIntegrity: BatchSourceIntegrity;
	acceptedMappingIntegrity: BatchSourceIntegrity;
	validation: StagedBatchManifest['validation'];
	slices: StagedSliceSummary[];
}): StagedBatchManifest {
	const slices = [...params.slices].sort(
		(a, b) => a.indicatorCode.localeCompare(b.indicatorCode) || a.freq.localeCompare(b.freq)
	);
	return {
		schemaVersion: STAGED_BATCH_MANIFEST_SCHEMA_VERSION,
		batchId: params.batchId,
		stagedAt: params.stagedAt || new Date().toISOString(),
		stagingInput: {
			artifact: BATCH_STAGING_INPUT_ARTIFACT,
			schemaVersion: BATCH_STAGING_INPUT_SCHEMA_VERSION
		},
		sourceIntegrity: params.sourceIntegrity,
		acceptedMappingIntegrity: params.acceptedMappingIntegrity,
		validation: params.validation,
		slices,
		totals: {
			sliceCount: slices.length,
			rowCount: slices.reduce((total, slice) => total + slice.rowCount, 0),
			validSliceCount: slices.filter((slice) => slice.validation.valid).length,
			failedSliceCount: slices.filter((slice) => !slice.validation.valid).length
		}
	};
}
