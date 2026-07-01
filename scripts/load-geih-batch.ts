#!/usr/bin/env tsx
// -----------------------------------------------------------------------------
// scripts/load-geih-batch.ts
//
// One-off bootstrap loader for the GEIH multi-indicator Parquet delivery.
//
// Usage:
//   DATABASE_URL=... \
//   CANONICAL_DUCKDB_PATH=data/observations.duckdb \
//   tsx scripts/load-geih-batch.ts data/geih_2021_2026_arq_ok_v2.parquet --dry-run
//
//   DATABASE_URL=... \
//   CANONICAL_DUCKDB_PATH=data/observations.duckdb \
//   tsx scripts/load-geih-batch.ts data/geih_2021_2026_arq_ok_v2.parquet --publish
//
// ⚠️  DISCLAIMER: This is an interim / disposable script. It exists only so we
// can get GEIH live and validate the Explorer end-to-end before the planned
// batch ingest architecture (ingest_batches / ingest_batch_slices / analyzer /
// staging UI) lands in later phases. Do NOT treat this as the final admin
// ingest product flow.
//
// Current schema caveat: data_releases rows created here have no ingest_batch
// parent because that table does not exist yet. Once Phase 1 batch lineage
// schema lands, these rows can be backfilled / relinked to an ingest_batches
// row as needed.
// -----------------------------------------------------------------------------

import 'dotenv/config';
import duckdb from 'duckdb';
import { and, eq, inArray } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { basename, resolve } from 'node:path';
import { db } from '../src/lib/db/script-client';
import {
	dataReleases,
	dataSources,
	indicatorDataSources,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '../src/lib/db/schema';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DATA_SOURCE_CODE = 'geih';
const DATA_SOURCE_NAME = 'Gran Encuesta Integrada de Hogares (GEIH)';
const INDICATOR_GROUP_CODE = 'geih_totales';
const INDICATOR_GROUP_NAME = 'GEIH - Totales';
const UPLOADED_BY = 'load-geih-batch-script';

const DEFAULT_INDICATOR_NAMES: Record<string, string> = {
	pob_total: 'Población total',
	viviendas: 'Viviendas',
	hogares: 'Hogares',
	mean_personas_hogar: 'Promedio de personas por hogar',
	pet: 'Población en edad de trabajar',
	pea: 'Población económicamente activa',
	ocupados: 'Ocupados',
	desocupados: 'Desocupados',
	to: 'Tasa de ocupación',
	tgp: 'Tasa global de participación',
	tdsi: 'Tasa de desempleo'
};

const CANONICAL_COLUMNS = [
	'indicator_code',
	'freq',
	'ref_area',
	'time_period',
	'obs_value',
	'geo_level',
	'dept_code',
	'muni_code',
	'urban_rural',
	'sex',
	'age',
	'adjustment',
	'ext_1',
	'ext_2',
	'ext_3',
	'obs_status'
];

interface SourceSlice {
	indicatorCode: string;
	freq: string;
	refArea: string;
	periodStart: string;
	periodEnd: string;
	yearMin: number;
	yearMax: number;
	rowCount: number;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const filePath = args.find((arg) => !arg.startsWith('--'));
const dryRun = args.includes('--dry-run');
const publish = args.includes('--publish');

function printUsage() {
	console.log(`
Usage:
  tsx scripts/load-geih-batch.ts <parquet-file> --dry-run
  tsx scripts/load-geih-batch.ts <parquet-file> --publish

Environment:
  DATABASE_URL           Metadata database URL (required)
  TURSO_AUTH_TOKEN       Turso auth token (required for remote libsql URLs)
  CANONICAL_DUCKDB_PATH  Path to observations.duckdb (default: ./data/observations.duckdb)
`);
}

if (!filePath) {
	console.error('Error: Parquet file path is required.');
	printUsage();
	process.exit(1);
}

if (!dryRun && !publish) {
	console.error('Error: Specify exactly one of --dry-run or --publish.');
	printUsage();
	process.exit(1);
}

if (dryRun && publish) {
	console.error('Error: --dry-run and --publish are mutually exclusive.');
	printUsage();
	process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) {
		return resolve(process.env.CANONICAL_DUCKDB_PATH);
	}
	if (process.env.DATA_PATH) {
		return resolve(process.env.DATA_PATH, 'observations.duckdb');
	}
	return resolve(process.cwd(), 'data', 'observations.duckdb');
}

function escapeSqlString(value: string): string {
	return value.replace(/'/g, "''");
}

function sha256File(path: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash('sha256');
		const stream = createReadStream(path);
		stream.on('error', reject);
		stream.on('data', (chunk) => hash.update(chunk));
		stream.on('end', () => resolve(hash.digest('hex')));
	});
}

function runDuckDb(database: duckdb.Database, sql: string, ...params: unknown[]): Promise<void> {
	return new Promise((resolve, reject) => {
		database.run(sql, ...params, (error: Error | null) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function queryDuckDb<T>(
	database: duckdb.Database,
	sql: string,
	...params: unknown[]
): Promise<T[]> {
	return new Promise((resolve, reject) => {
		database.all(sql, ...params, (error: Error | null, rows: T[]) => {
			if (error) reject(error);
			else resolve(rows);
		});
	});
}

function toNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') {
		const parsed = Number.parseInt(value, 10);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function indicatorName(code: string): string {
	return DEFAULT_INDICATOR_NAMES[code] || code;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
	const parquetPath = resolve(filePath!);
	const duckDbPath = canonicalDbPath();
	const sourceName = basename(parquetPath);

	console.log('[load-geih] Parquet file:', parquetPath);
	console.log('[load-geih] Canonical DuckDB:', duckDbPath);
	console.log('[load-geih] Mode:', dryRun ? 'DRY RUN' : 'PUBLISH');

	const checksum = await sha256File(parquetPath);
	console.log('[load-geih] Source checksum:', checksum);

	// Profile the file using an in-memory DuckDB instance. This keeps --dry-run
	// truly read-only (no canonical DuckDB file is created or modified).
	const profileDb = new duckdb.Database(':memory:');
	const escapedPath = escapeSqlString(parquetPath);
	const profileSql = `
		SELECT
			INDICADOR AS indicator_code,
			FREQ AS freq,
			REF_AREA AS ref_area,
			MIN(PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER))) AS period_start,
			MAX(PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER))) AS period_end,
			MIN(YEAR) AS year_min,
			MAX(YEAR) AS year_max,
			COUNT(*)::DOUBLE AS row_count,
			ANY_VALUE(UNIT) AS unit,
			ANY_VALUE(UNIT_MULT) AS unit_mult,
			ANY_VALUE(DECIMALS) AS decimals
		FROM read_parquet('${escapedPath}')
		GROUP BY INDICADOR, FREQ, REF_AREA
		ORDER BY INDICADOR
	`;

	const rawSlices = await queryDuckDb<{
		indicator_code: string;
		freq: string;
		ref_area: string;
		period_start: string;
		period_end: string;
		year_min: number;
		year_max: number;
		row_count: number | bigint;
		unit: string | null;
		unit_mult: number | bigint | null;
		decimals: number | bigint | null;
	}>(profileDb, profileSql);

	const slices: SourceSlice[] = rawSlices.map((row) => ({
		indicatorCode: row.indicator_code,
		freq: row.freq,
		refArea: row.ref_area,
		periodStart: row.period_start,
		periodEnd: row.period_end,
		yearMin: toNumber(row.year_min) ?? 0,
		yearMax: toNumber(row.year_max) ?? 0,
		rowCount: toNumber(row.row_count) ?? 0,
		unit: row.unit,
		unitMult: toNumber(row.unit_mult),
		decimals: toNumber(row.decimals)
	}));

	console.log(`[load-geih] Derived ${slices.length} slice(s) from file`);
	for (const slice of slices) {
		console.log(
			`  - ${slice.indicatorCode}/${slice.freq} (${slice.refArea}): ${slice.rowCount} rows, ${slice.periodStart}..${slice.periodEnd}`
		);
	}

	if (dryRun) {
		console.log('[load-geih] Dry run complete. No changes were made.');
		profileDb.close();
		return;
	}

	// -----------------------------------------------------------------------
	// Publish: metadata upserts + per-slice observation replacement + lineage
	// -----------------------------------------------------------------------

	// Open canonical DuckDB and ensure schema only when we are about to write.
	const duckDatabase = new duckdb.Database(duckDbPath);

	await runDuckDb(
		duckDatabase,
		`CREATE TABLE IF NOT EXISTS observations (
			indicator_code VARCHAR NOT NULL,
			freq VARCHAR NOT NULL,
			ref_area VARCHAR NOT NULL DEFAULT 'CO',
			time_period VARCHAR NOT NULL,
			obs_value DOUBLE,
			geo_level VARCHAR,
			dept_code VARCHAR,
			muni_code VARCHAR,
			urban_rural VARCHAR,
			sex VARCHAR,
			age VARCHAR,
			adjustment VARCHAR,
			ext_1 VARCHAR,
			ext_2 VARCHAR,
			ext_3 VARCHAR,
			obs_status VARCHAR DEFAULT 'A'
		)`
	);
	await runDuckDb(
		duckDatabase,
		'CREATE TABLE IF NOT EXISTS _meta (key VARCHAR PRIMARY KEY, value VARCHAR)'
	);
	await runDuckDb(duckDatabase, "INSERT OR REPLACE INTO _meta VALUES ('schema_version', '1')");
	await runDuckDb(
		duckDatabase,
		'CREATE INDEX IF NOT EXISTS idx_obs_indicator_freq ON observations(indicator_code, freq, ref_area)'
	);

	profileDb.close();

	// Upsert data_source.
	let [dataSource] = await db
		.select({ id: dataSources.id })
		.from(dataSources)
		.where(eq(dataSources.code, DATA_SOURCE_CODE))
		.limit(1);

	if (!dataSource) {
		[dataSource] = await db
			.insert(dataSources)
			.values({ code: DATA_SOURCE_CODE, name: DATA_SOURCE_NAME })
			.returning({ id: dataSources.id });
		console.log(`[load-geih] Created data_source: ${DATA_SOURCE_CODE}`);
	} else {
		console.log(`[load-geih] Using existing data_source: ${DATA_SOURCE_CODE}`);
	}

	// Upsert indicator_group.
	let [group] = await db
		.select({ id: indicatorGroups.id })
		.from(indicatorGroups)
		.where(
			and(
				eq(indicatorGroups.dataSourceId, dataSource.id),
				eq(indicatorGroups.code, INDICATOR_GROUP_CODE)
			)
		)
		.limit(1);

	if (!group) {
		[group] = await db
			.insert(indicatorGroups)
			.values({
				dataSourceId: dataSource.id,
				code: INDICATOR_GROUP_CODE,
				name: INDICATOR_GROUP_NAME
			})
			.returning({ id: indicatorGroups.id });
		console.log(`[load-geih] Created indicator_group: ${INDICATOR_GROUP_CODE}`);
	} else {
		console.log(`[load-geih] Using existing indicator_group: ${INDICATOR_GROUP_CODE}`);
	}

	// Preload existing indicators that belong to this group.
	const existingIndicatorRows = await db
		.select({
			id: indicators.id,
			code: indicators.code,
			unit: indicators.unit,
			unitMult: indicators.unitMult,
			decimals: indicators.decimals
		})
		.from(indicators)
		.where(
			inArray(
				indicators.code,
				slices.map((s) => s.indicatorCode)
			)
		);

	const existingIndicators = new Map(existingIndicatorRows.map((row) => [row.code, row]));

	// Begin DuckDB transaction for all observation writes.
	await runDuckDb(duckDatabase, 'BEGIN TRANSACTION');

	try {
		for (const slice of slices) {
			console.log(`[load-geih] Publishing ${slice.indicatorCode}/${slice.freq}...`);

			// Upsert indicator row. Preserve existing name; only fill in missing
			// measurement metadata so we do not clobber manual edits.
			let indicator = existingIndicators.get(slice.indicatorCode);
			if (!indicator) {
				[indicator] = await db
					.insert(indicators)
					.values({
						indicatorGroupId: group.id,
						code: slice.indicatorCode,
						name: indicatorName(slice.indicatorCode),
						unit: slice.unit,
						unitMult: slice.unitMult,
						decimals: slice.decimals,
						frequency: slice.freq
					})
					.returning({
						id: indicators.id,
						code: indicators.code,
						unit: indicators.unit,
						unitMult: indicators.unitMult,
						decimals: indicators.decimals
					});
				existingIndicators.set(slice.indicatorCode, indicator);
				console.log(`[load-geih]   Created indicator: ${slice.indicatorCode}`);
			} else {
				const updates: Partial<{
					unit: string | null;
					unitMult: number | null;
					decimals: number | null;
				}> = {};
				if (!indicator.unit && slice.unit) updates.unit = slice.unit;
				if (indicator.unitMult === null && slice.unitMult !== null)
					updates.unitMult = slice.unitMult;
				if (indicator.decimals === null && slice.decimals !== null)
					updates.decimals = slice.decimals;

				if (Object.keys(updates).length > 0) {
					await db.update(indicators).set(updates).where(eq(indicators.id, indicator.id));
					console.log(
						`[load-geih]   Updated indicator measurement metadata: ${slice.indicatorCode}`
					);
				}
			}

			// Upsert indicator_frequency row.
			const existingFreq = await db
				.select({ id: indicatorFrequencies.id })
				.from(indicatorFrequencies)
				.where(
					and(
						eq(indicatorFrequencies.indicatorId, indicator.id),
						eq(indicatorFrequencies.freq, slice.freq)
					)
				)
				.limit(1);

			if (existingFreq.length === 0) {
				await db.insert(indicatorFrequencies).values({
					indicatorId: indicator.id,
					freq: slice.freq
				});
				console.log(
					`[load-geih]   Created indicator_frequency: ${slice.indicatorCode}/${slice.freq}`
				);
			}

			// Replace observations in canonical DuckDB for this slice.
			await runDuckDb(
				duckDatabase,
				'DELETE FROM observations WHERE indicator_code = ? AND freq = ?',
				slice.indicatorCode,
				slice.freq
			);

			const insertSql = `
				INSERT INTO observations (${CANONICAL_COLUMNS.join(', ')})
				SELECT
					INDICADOR,
					FREQ,
					REF_AREA,
					PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER)),
					OBS_VALUE,
					GEO_LEVEL,
					DEPT_CODE,
					MUNI_CODE,
					NULL,
					NULL,
					NULL,
					NULL,
					NULL,
					NULL,
					NULL,
					COALESCE(OBS_STATUS, 'A')
				FROM read_parquet('${escapedPath}')
				WHERE INDICADOR = ? AND FREQ = ?
			`;
			await runDuckDb(duckDatabase, insertSql, slice.indicatorCode, slice.freq);

			// Reconcile lineage: reuse an existing release for this exact source
			// file + indicator when the script is rerun, otherwise create a new one.
			let [release] = await db
				.select({ id: dataReleases.id })
				.from(dataReleases)
				.where(
					and(
						eq(dataReleases.indicatorId, indicator.id),
						eq(dataReleases.sourceName, sourceName),
						eq(dataReleases.checksum, checksum)
					)
				)
				.limit(1);

			if (release) {
				await db
					.update(dataReleases)
					.set({
						periodStart: slice.periodStart,
						periodEnd: slice.periodEnd,
						rowCount: slice.rowCount,
						status: 'published'
					})
					.where(eq(dataReleases.id, release.id));
				console.log(`[load-geih]   Updated existing data_release: ${release.id}`);
			} else {
				[release] = await db
					.insert(dataReleases)
					.values({
						indicatorId: indicator.id,
						periodStart: slice.periodStart,
						periodEnd: slice.periodEnd,
						rowCount: slice.rowCount,
						sourceFormat: 'parquet',
						sourceName,
						uploadedBy: UPLOADED_BY,
						status: 'published',
						checksum
					})
					.returning({ id: dataReleases.id });
				console.log(`[load-geih]   Created data_release: ${release.id}`);
			}

			// Refresh indicator_data_sources for this slice.
			await db
				.delete(indicatorDataSources)
				.where(
					and(
						eq(indicatorDataSources.indicatorId, indicator.id),
						eq(indicatorDataSources.refArea, slice.refArea),
						eq(indicatorDataSources.freq, slice.freq)
					)
				);

			await db.insert(indicatorDataSources).values({
				indicatorId: indicator.id,
				refArea: slice.refArea,
				freq: slice.freq,
				yearMin: slice.yearMin,
				yearMax: slice.yearMax,
				rowCount: slice.rowCount,
				releaseId: release.id
			});
			console.log(
				`[load-geih]   Refreshed indicator_data_sources for ${slice.indicatorCode}/${slice.freq}`
			);
		}

		await runDuckDb(duckDatabase, 'COMMIT');
		console.log('[load-geih] DuckDB transaction committed.');
	} catch (error) {
		console.error('[load-geih] Error during publish; rolling back DuckDB transaction.');
		try {
			await runDuckDb(duckDatabase, 'ROLLBACK');
		} catch {
			// Ignore rollback errors.
		}
		throw error;
	} finally {
		duckDatabase.close();
	}

	console.log('[load-geih] Done.');
}

main().catch((error) => {
	console.error('[load-geih] Failed:', error);
	process.exit(1);
});
