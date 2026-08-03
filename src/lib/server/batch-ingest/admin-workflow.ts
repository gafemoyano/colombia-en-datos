import { readFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import { dataSources, ingestBatches, ingestBatchSlices } from '$lib/db/schema';
import { normalizeDataSourceCode } from '$lib/ingest/definitions';
import {
	DEFINITION_DRAFT_HEADERS,
	generateDefinitionDrafts,
	saveAcceptedDefinitionDraftRows,
	type DefinitionDraftHeader,
	type DefinitionDraftRow,
	type GenerateDefinitionDraftsResult,
	type SaveAcceptedDefinitionDraftRowsResult
} from './definition-drafts';
import { intakeBatch, type IntakeBatchResult } from './intake';
import { createBatchManifestSummary, requireBatchStatus, requireSliceStatus } from './manifest';
import { publishBatch, type PublishBatchResult } from './publish';
import { stageBatch, type StageBatchResult } from './stage';
import {
	batchStoragePaths,
	createAcceptedMappingManifest,
	createBatchStagingInput,
	persistAcceptedMappingArtifacts,
	readAcceptedMappingManifest,
	readBatchIntakeManifest,
	readStagedBatchManifest,
	type AcceptedBatchColumnMapping,
	type AcceptedMappingManifest,
	type CollapsedFixedDimension,
	type StagedBatchManifest
} from './storage';
import { BATCH_PROFILE_SCHEMA_VERSION, type BatchProfile } from './types';

export type AdminBatchWorkflowErrorCode =
	| 'invalid-input'
	| 'data-source-conflict'
	| 'batch-not-found'
	| 'artifact-missing'
	| 'mapping-immutable'
	| 'action-not-allowed'
	| 'operation-failed';

export type AdminBatchWorkflowAction =
	| 'analyze'
	| 'save-definitions'
	| 'accept-and-stage'
	| 'publish'
	| 'load';

export interface AdminBatchWorkflowErrorShape {
	code: AdminBatchWorkflowErrorCode;
	message: string;
	action: AdminBatchWorkflowAction;
	retryable: boolean;
	batchId: number | null;
}

export class AdminBatchWorkflowError extends Error {
	readonly code: AdminBatchWorkflowErrorCode;
	readonly action: AdminBatchWorkflowAction;
	readonly retryable: boolean;
	readonly batchId: number | null;

	constructor(error: AdminBatchWorkflowErrorShape) {
		super(error.message);
		this.name = 'AdminBatchWorkflowError';
		this.code = error.code;
		this.action = error.action;
		this.retryable = error.retryable;
		this.batchId = error.batchId;
	}

	toJSON(): AdminBatchWorkflowErrorShape {
		return {
			code: this.code,
			message: this.message,
			action: this.action,
			retryable: this.retryable,
			batchId: this.batchId
		};
	}
}

export interface AdminDataSourceInput {
	code: string;
	name: string;
	description?: string | null;
}

export interface AdminDataSourceSummary {
	id: number;
	code: string;
	name: string;
	description: string | null;
	created: boolean;
}

export interface AdminBatchWorkflowState {
	manifest: ReturnType<typeof createBatchManifestSummary>;
	dataSource: Omit<AdminDataSourceSummary, 'created'> | null;
	profile: BatchProfile | null;
	definitionDrafts: GenerateDefinitionDraftsResult | null;
	acceptedMapping: AcceptedMappingManifest | null;
	staged: StagedBatchManifest | null;
	published: PublishBatchResult | null;
	errors: AdminBatchWorkflowErrorShape[];
}

type BatchDb = ReturnType<typeof getDb>;
type IntakeBatch = typeof intakeBatch;
type StageBatch = typeof stageBatch;
type PublishBatch = typeof publishBatch;

interface AdminWorkflowDependencies {
	db?: BatchDb;
	intake?: IntakeBatch;
	stage?: StageBatch;
	publish?: PublishBatch;
}

function required(value: string, label: string, action: AdminBatchWorkflowAction): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new AdminBatchWorkflowError({
			code: 'invalid-input',
			message: `${label} is required.`,
			action,
			retryable: false,
			batchId: null
		});
	}
	return normalized;
}

function normalizedSourceInput(input: AdminDataSourceInput): Omit<
	AdminDataSourceInput,
	'description'
> & {
	description: string | null;
} {
	const code = normalizeDataSourceCode(required(input.code, 'Data source code', 'analyze'));
	if (!code) {
		throw new AdminBatchWorkflowError({
			code: 'invalid-input',
			message: 'Data source code must contain letters or numbers.',
			action: 'analyze',
			retryable: false,
			batchId: null
		});
	}
	return {
		code,
		name: required(input.name, 'Data source name', 'analyze'),
		description: input.description?.trim() || null
	};
}

export async function createOrReuseAdminDataSource(
	input: AdminDataSourceInput,
	db: BatchDb = getDb()
): Promise<AdminDataSourceSummary> {
	const normalized = normalizedSourceInput(input);
	let [stored] = await db
		.select({
			id: dataSources.id,
			code: dataSources.code,
			name: dataSources.name,
			description: dataSources.description
		})
		.from(dataSources)
		.where(eq(dataSources.code, normalized.code))
		.limit(1);

	if (stored) {
		if (stored.name !== normalized.name || stored.description !== normalized.description) {
			throw new AdminBatchWorkflowError({
				code: 'data-source-conflict',
				message: `Data source ${normalized.code} already exists with different metadata. Use its stored name and description.`,
				action: 'analyze',
				retryable: false,
				batchId: null
			});
		}
		return { ...stored, created: false };
	}

	await db.insert(dataSources).values(normalized).onConflictDoNothing({ target: dataSources.code });
	[stored] = await db
		.select({
			id: dataSources.id,
			code: dataSources.code,
			name: dataSources.name,
			description: dataSources.description
		})
		.from(dataSources)
		.where(eq(dataSources.code, normalized.code))
		.limit(1);
	if (!stored || stored.name !== normalized.name || stored.description !== normalized.description) {
		throw new AdminBatchWorkflowError({
			code: 'data-source-conflict',
			message: `Data source ${normalized.code} was created concurrently with different metadata. Reload and use its stored metadata.`,
			action: 'analyze',
			retryable: false,
			batchId: null
		});
	}
	return { ...stored, created: true };
}

export async function analyzeAdminBatch(
	input: {
		source: Uint8Array;
		originalName: string;
		dataSource: AdminDataSourceInput;
		storageRoot?: string;
	},
	dependencies: AdminWorkflowDependencies = {}
): Promise<IntakeBatchResult> {
	if (input.source.byteLength === 0) {
		throw new AdminBatchWorkflowError({
			code: 'invalid-input',
			message: 'A non-empty Parquet file is required.',
			action: 'analyze',
			retryable: false,
			batchId: null
		});
	}
	const db = dependencies.db || getDb();
	const dataSource = await createOrReuseAdminDataSource(input.dataSource, db);
	try {
		return await (dependencies.intake || intakeBatch)(
			{
				source: input.source,
				originalName: input.originalName,
				dataSourceCode: dataSource.code,
				storageRoot: input.storageRoot
			},
			{ db }
		);
	} catch (error) {
		if (error instanceof AdminBatchWorkflowError) throw error;
		throw workflowFailure(error, 'analyze', null, true);
	}
}

function isMissingFile(error: unknown): boolean {
	return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

async function readProfile(path: string): Promise<BatchProfile> {
	const profile = JSON.parse(await readFile(path, 'utf8')) as BatchProfile;
	if (profile.schemaVersion !== BATCH_PROFILE_SCHEMA_VERSION) {
		throw new Error(`Unsupported batch profile schema version: ${String(profile.schemaVersion)}`);
	}
	return profile;
}

async function optionalArtifact<T>(
	reader: () => Promise<T>,
	params: { batchId: number; label: string; expected: boolean }
): Promise<{ value: T | null; error: AdminBatchWorkflowErrorShape | null }> {
	try {
		return { value: await reader(), error: null };
	} catch (error) {
		if (isMissingFile(error) && !params.expected) return { value: null, error: null };
		const shaped = new AdminBatchWorkflowError({
			code: isMissingFile(error) ? 'artifact-missing' : 'operation-failed',
			message: isMissingFile(error)
				? `${params.label} is missing. Start a new batch if the durable artifact cannot be restored.`
				: `Could not read ${params.label}: ${errorMessage(error)}`,
			action: 'load',
			retryable: false,
			batchId: params.batchId
		});
		return { value: null, error: shaped.toJSON() };
	}
}

export async function loadAdminBatchWorkflow(
	batchId: number,
	dependencies: AdminWorkflowDependencies = {}
): Promise<AdminBatchWorkflowState> {
	if (!Number.isSafeInteger(batchId) || batchId < 1) {
		throw new AdminBatchWorkflowError({
			code: 'invalid-input',
			message: 'batchId must be a positive integer.',
			action: 'load',
			retryable: false,
			batchId: null
		});
	}
	const db = dependencies.db || getDb();
	const [batch] = await db
		.select({
			id: ingestBatches.id,
			status: ingestBatches.status,
			originalName: ingestBatches.originalName,
			checksum: ingestBatches.checksum,
			sourceFormat: ingestBatches.sourceFormat,
			rowCount: ingestBatches.rowCount,
			createdAt: ingestBatches.createdAt,
			publishedAt: ingestBatches.publishedAt,
			dataSourceId: dataSources.id,
			dataSourceCode: dataSources.code,
			dataSourceName: dataSources.name,
			dataSourceDescription: dataSources.description
		})
		.from(ingestBatches)
		.leftJoin(dataSources, eq(ingestBatches.dataSourceId, dataSources.id))
		.where(eq(ingestBatches.id, batchId))
		.limit(1);
	if (!batch) {
		throw new AdminBatchWorkflowError({
			code: 'batch-not-found',
			message: `Ingest batch ${batchId} does not exist.`,
			action: 'load',
			retryable: false,
			batchId
		});
	}
	const slices = await db
		.select({
			id: ingestBatchSlices.id,
			indicatorCode: ingestBatchSlices.indicatorCode,
			freq: ingestBatchSlices.freq,
			status: ingestBatchSlices.status,
			indicatorId: ingestBatchSlices.indicatorId,
			rowCount: ingestBatchSlices.rowCount,
			periodStart: ingestBatchSlices.periodStart,
			periodEnd: ingestBatchSlices.periodEnd,
			releaseId: ingestBatchSlices.releaseId
		})
		.from(ingestBatchSlices)
		.where(eq(ingestBatchSlices.batchId, batchId));
	const status = requireBatchStatus(batch.status);
	const paths = batchStoragePaths(batchId);
	const expectsAnalysis = status !== 'uploaded';
	const profileArtifact = await optionalArtifact(() => readProfile(paths.profile), {
		batchId,
		label: 'batch profile',
		expected: expectsAnalysis
	});
	const acceptedArtifact = await optionalArtifact(() => readAcceptedMappingManifest(paths), {
		batchId,
		label: 'accepted mapping',
		expected: ['staged', 'publishing', 'published'].includes(status)
	});
	const stagedArtifact = await optionalArtifact(() => readStagedBatchManifest(paths), {
		batchId,
		label: 'staged manifest',
		expected: ['staged', 'publishing', 'published'].includes(status)
	});
	const profile = profileArtifact.value;
	const published =
		status === 'published' && batch.publishedAt
			? {
					batchId,
					status: 'published' as const,
					publishedAt: batch.publishedAt,
					slices: slices.map((slice) => ({
						sliceId: slice.id,
						indicatorCode: slice.indicatorCode,
						freq: slice.freq,
						releaseId: slice.releaseId!,
						rowCount: slice.rowCount || 0
					}))
				}
			: null;

	return {
		manifest: createBatchManifestSummary({
			batch: { ...batch, status },
			slices: slices.map((slice) => ({ ...slice, status: requireSliceStatus(slice.status) }))
		}),
		dataSource:
			batch.dataSourceId && batch.dataSourceCode && batch.dataSourceName
				? {
						id: batch.dataSourceId,
						code: batch.dataSourceCode,
						name: batch.dataSourceName,
						description: batch.dataSourceDescription
					}
				: null,
		profile,
		definitionDrafts: profile ? generateDefinitionDrafts({ profile }) : null,
		acceptedMapping: acceptedArtifact.value,
		staged: stagedArtifact.value,
		published,
		errors: [profileArtifact.error, acceptedArtifact.error, stagedArtifact.error].filter(
			(error): error is AdminBatchWorkflowErrorShape => error !== null
		)
	};
}

export interface AdminDefinitionDraftEdit {
	id: string;
	values: Partial<Record<DefinitionDraftHeader, string>>;
}

function applyDraftEdits(
	generated: GenerateDefinitionDraftsResult,
	edits: AdminDefinitionDraftEdit[]
): DefinitionDraftRow[] {
	const editsById = new Map(edits.map((edit) => [edit.id, edit.values]));
	return generated.drafts.map((draft) => {
		const edit = editsById.get(draft.id);
		if (!edit) return draft;
		const values = { ...draft.values };
		for (const header of DEFINITION_DRAFT_HEADERS) {
			if (typeof edit[header] === 'string') values[header] = edit[header]!;
		}
		return { ...draft, values };
	});
}

export async function saveAdminBatchDefinitions(
	input: { batchId: number; edits: AdminDefinitionDraftEdit[] },
	dependencies: AdminWorkflowDependencies = {}
): Promise<SaveAcceptedDefinitionDraftRowsResult> {
	const db = dependencies.db || getDb();
	const state = await loadAdminBatchWorkflow(input.batchId, { ...dependencies, db });
	if (!state.profile || !state.definitionDrafts || !state.dataSource) {
		throw new AdminBatchWorkflowError({
			code: 'action-not-allowed',
			message:
				'The analyzed profile and linked Data source are required before saving definitions.',
			action: 'save-definitions',
			retryable: false,
			batchId: input.batchId
		});
	}
	return saveAcceptedDefinitionDraftRows(
		{
			dataSource: state.dataSource,
			drafts: applyDraftEdits(state.definitionDrafts, input.edits)
		},
		db
	);
}

function collapsedDimensions(drafts: GenerateDefinitionDraftsResult): CollapsedFixedDimension[] {
	return drafts.drafts.flatMap((draft) =>
		draft.provenance.collapsedDimensions.map((dimension) => ({
			sliceKey: draft.provenance.sliceKey,
			sourceColumn: dimension.sourceColumn,
			canonicalField: dimension.field,
			dimensionCode: dimension.dimensionCode,
			value: dimension.value
		}))
	);
}

function sameAcceptedMappings(
	stored: AcceptedMappingManifest,
	mappings: AcceptedBatchColumnMapping[],
	collapsed: CollapsedFixedDimension[]
): boolean {
	const proposed = createAcceptedMappingManifest({
		batchId: stored.batchId,
		acceptedAt: stored.acceptedAt,
		sourceIntegrity: stored.sourceIntegrity,
		mappings,
		collapsedDimensions: collapsed
	});
	return JSON.stringify(stored) === JSON.stringify(proposed);
}

export async function acceptAdminMappingAndStage(
	input: { batchId: number; mappings: AcceptedBatchColumnMapping[]; storageRoot?: string },
	dependencies: AdminWorkflowDependencies = {}
): Promise<StageBatchResult> {
	const db = dependencies.db || getDb();
	const state = await loadAdminBatchWorkflow(input.batchId, { ...dependencies, db });
	if (!state.profile || !state.definitionDrafts) {
		throw new AdminBatchWorkflowError({
			code: 'action-not-allowed',
			message: 'The analyzed profile is required before accepting mappings.',
			action: 'accept-and-stage',
			retryable: false,
			batchId: input.batchId
		});
	}
	const paths = batchStoragePaths(input.batchId, input.storageRoot);
	const collapsed = collapsedDimensions(state.definitionDrafts);
	let accepted = state.acceptedMapping;
	if (accepted) {
		if (!sameAcceptedMappings(accepted, input.mappings, collapsed)) {
			throw new AdminBatchWorkflowError({
				code: 'mapping-immutable',
				message: 'This batch already has an accepted mapping. Upload a new batch to correct it.',
				action: 'accept-and-stage',
				retryable: false,
				batchId: input.batchId
			});
		}
	} else {
		const intake = await readBatchIntakeManifest(paths).catch((error) => {
			throw workflowFailure(error, 'accept-and-stage', input.batchId, false);
		});
		accepted = createAcceptedMappingManifest({
			batchId: input.batchId,
			sourceIntegrity: intake.source.integrity,
			mappings: input.mappings,
			collapsedDimensions: collapsed
		});
		await persistAcceptedMappingArtifacts({
			paths,
			manifest: accepted,
			stagingInput: createBatchStagingInput(accepted)
		});
	}
	try {
		return await (dependencies.stage || stageBatch)(
			{ batchId: input.batchId, storageRoot: input.storageRoot },
			{ db }
		);
	} catch (error) {
		throw workflowFailure(error, 'accept-and-stage', input.batchId, true);
	}
}

export async function publishAdminBatch(
	input: { batchId: number; confirmed: boolean; storageRoot?: string },
	dependencies: AdminWorkflowDependencies = {}
): Promise<PublishBatchResult> {
	if (!input.confirmed) {
		throw new AdminBatchWorkflowError({
			code: 'invalid-input',
			message: 'Confirm that publishing replaces every slice present in this batch.',
			action: 'publish',
			retryable: false,
			batchId: input.batchId
		});
	}
	try {
		return await (dependencies.publish || publishBatch)(
			{ batchId: input.batchId, storageRoot: input.storageRoot },
			dependencies.db ? { db: dependencies.db } : {}
		);
	} catch (error) {
		throw workflowFailure(error, 'publish', input.batchId, true);
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function workflowFailure(
	error: unknown,
	action: AdminBatchWorkflowAction,
	batchId: number | null,
	retryable: boolean
): AdminBatchWorkflowError {
	if (error instanceof AdminBatchWorkflowError) return error;
	return new AdminBatchWorkflowError({
		code: 'operation-failed',
		message: errorMessage(error),
		action,
		retryable,
		batchId
	});
}

export function adminBatchWorkflowError(error: unknown): AdminBatchWorkflowErrorShape {
	return workflowFailure(error, 'load', null, false).toJSON();
}
