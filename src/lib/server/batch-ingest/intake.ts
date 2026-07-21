import { basename } from 'node:path';
import { eq } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import { dataSources, ingestBatches, ingestBatchSlices } from '$lib/db/schema';
import { analyzeBatchParquet } from './analyzer';
import {
	BATCH_INTAKE_MANIFEST_ARTIFACT,
	BATCH_PROFILE_ARTIFACT,
	BATCH_SOURCE_ARTIFACT,
	BATCH_INTAKE_MANIFEST_SCHEMA_VERSION,
	batchStoragePaths,
	persistBatchAnalysisArtifacts,
	persistBatchSource,
	resolveBatchStorageRoot,
	sourceIntegrity,
	type BatchIntakeManifest,
	type BatchSourceIntegrity
} from './storage';
import type { BatchProfile } from './types';

export class BatchIntakeInputError extends Error {}

export interface IntakeBatchInput {
	source: Uint8Array;
	originalName: string;
	dataSourceCode?: string | null;
	storageRoot?: string;
}

export interface IntakeBatchResult {
	batchId: number;
	status: 'analyzed' | 'failed';
	dataSourceCode: string | null;
	source: {
		path: string;
		artifact: typeof BATCH_SOURCE_ARTIFACT;
		originalName: string;
		format: 'parquet';
		integrity: BatchSourceIntegrity;
	};
	artifacts: {
		intakeManifest: typeof BATCH_INTAKE_MANIFEST_ARTIFACT;
		profile: typeof BATCH_PROFILE_ARTIFACT;
	};
	profile: BatchProfile;
}

type BatchDb = ReturnType<typeof getDb>;
type AnalyzeBatch = typeof analyzeBatchParquet;

async function resolveDataSourceId(
	db: BatchDb,
	dataSourceCode: string | null
): Promise<number | null> {
	if (!dataSourceCode) return null;
	const [dataSource] = await db
		.select({ id: dataSources.id })
		.from(dataSources)
		.where(eq(dataSources.code, dataSourceCode))
		.limit(1);
	if (!dataSource) {
		throw new BatchIntakeInputError(`Unknown dataSourceCode: ${dataSourceCode}`);
	}
	return dataSource.id;
}

function analysisStatus(profile: BatchProfile): 'analyzed' | 'failed' {
	return profile.diagnostics.some((diagnostic) => diagnostic.code === 'parquet_analysis_failed')
		? 'failed'
		: 'analyzed';
}

export async function intakeBatch(
	input: IntakeBatchInput,
	dependencies: { db?: BatchDb; analyze?: AnalyzeBatch } = {}
): Promise<IntakeBatchResult> {
	const db = dependencies.db || getDb();
	const analyze = dependencies.analyze || analyzeBatchParquet;
	const dataSourceCode = input.dataSourceCode?.trim() || null;
	const dataSourceId = await resolveDataSourceId(db, dataSourceCode);
	const originalName = basename(input.originalName || 'batch.parquet');
	const integrity = sourceIntegrity(input.source);
	const now = new Date().toISOString();
	const [batch] = await db
		.insert(ingestBatches)
		.values({
			dataSourceId,
			originalName,
			checksum: integrity.digest,
			sourceFormat: 'parquet',
			status: 'uploaded',
			createdAt: now,
			updatedAt: now
		})
		.returning({ id: ingestBatches.id });
	const paths = batchStoragePaths(batch.id, input.storageRoot || resolveBatchStorageRoot());

	try {
		await persistBatchSource(paths, input.source);
		const profile = await analyze({ filePath: paths.source, originalName });
		const status = analysisStatus(profile);
		const manifest: BatchIntakeManifest = {
			schemaVersion: BATCH_INTAKE_MANIFEST_SCHEMA_VERSION,
			batchId: batch.id,
			createdAt: now,
			dataSourceCode,
			source: {
				artifact: BATCH_SOURCE_ARTIFACT,
				originalName,
				format: 'parquet',
				integrity
			},
			analysis: {
				artifact: BATCH_PROFILE_ARTIFACT,
				profileSchemaVersion: profile.schemaVersion,
				analyzedAt: profile.analyzedAt
			}
		};
		await persistBatchAnalysisArtifacts({ paths, profile, manifest });

		await db.transaction(async (tx) => {
			if (profile.slices.length > 0) {
				await tx.insert(ingestBatchSlices).values(
					profile.slices.map((slice) => ({
						batchId: batch.id,
						indicatorCode: slice.indicatorCode,
						freq: slice.freq,
						rowCount: slice.rowCount,
						periodStart: slice.periodStart,
						periodEnd: slice.periodEnd,
						status: 'proposed' as const,
						createdAt: now,
						updatedAt: now
					}))
				);
			}
			await tx
				.update(ingestBatches)
				.set({ rowCount: profile.source.rowCount, status, updatedAt: now })
				.where(eq(ingestBatches.id, batch.id));
		});

		return {
			batchId: batch.id,
			status,
			dataSourceCode,
			source: {
				path: paths.source,
				artifact: BATCH_SOURCE_ARTIFACT,
				originalName,
				format: 'parquet',
				integrity
			},
			artifacts: {
				intakeManifest: BATCH_INTAKE_MANIFEST_ARTIFACT,
				profile: BATCH_PROFILE_ARTIFACT
			},
			profile
		};
	} catch (error) {
		await db
			.update(ingestBatches)
			.set({ status: 'failed', updatedAt: new Date().toISOString() })
			.where(eq(ingestBatches.id, batch.id))
			.catch(() => undefined);
		throw error;
	}
}
