/**
 * Registers the exportaciones product in the relational registry.
 *
 * Observations live in the canonical DuckDB store and are loaded by
 * `canonical:build`. This script writes everything else: the data source, the
 * indicator group, the 14 indicators, the 7 semantic dimensions and their
 * codelists, plus the release and lineage rows.
 *
 * Idempotent — safe to re-run. Every write is keyed on a natural unique key and
 * updates in place rather than duplicating.
 *
 *   npx tsx scripts/seed-exportaciones.ts [--dry-run]
 */

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import duckdb from 'duckdb';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../src/lib/db/script-client';
import {
	dataReleases,
	dataSources,
	dimensionDefinitions,
	dimensionValues,
	indicatorDataSources,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '../src/lib/db/schema';
import {
	EXPORTACIONES_DIMENSIONS,
	EXPORTACIONES_EXPECTED,
	EXPORTACIONES_INDICATORS,
	EXPORTACIONES_SOURCE_CODE,
	EXPORTACIONES_THEME
} from '../src/lib/server/contracts/exportaciones';
import { EXPORTACIONES_INDICATOR_CODES } from '../src/lib/server/contracts/exportaciones-load';
import {
	defaultSourcePaths,
	openSourceDb,
	readCodelists,
	validateExportacionesSource
} from '../src/lib/server/contracts/exportaciones-source';

const DRY_RUN = process.argv.includes('--dry-run');

const GROUP_CODE = 'EXPORTACIONES';
const SOURCE_CITATION = 'DANE - Estadísticas de exportaciones';
const UNIT_MULT = 0;
const DECIMALS = 2;
const FREQ = 'M';

/**
 * Geography is constant (national) across the whole product, so these are
 * registered as filterable context but never as a split — a selector with one
 * option is noise. The semantic breakdown is the only real axis.
 */
const CONTEXT_DIMENSIONS = ['GEO_LEVEL', 'DEPT_CODE'] as const;

function canonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) return resolve(process.env.CANONICAL_DUCKDB_PATH);
	if (process.env.DATA_PATH) return join(resolve(process.env.DATA_PATH), 'observations.duckdb');
	return join(process.cwd(), 'data', 'observations.duckdb');
}

function queryDuckDb<T>(database: duckdb.Database, query: string): Promise<T[]> {
	return new Promise((res, rej) => {
		database.all(query, (error: Error | null, rows: T[]) => {
			if (error) rej(error);
			else res(rows);
		});
	});
}

function toNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	return Number(value ?? 0);
}

interface CanonicalSlice {
	indicator_code: string;
	row_count: number | bigint;
	period_start: string;
	period_end: string;
}

/**
 * Reads the loaded observations back out of the canonical store. Releases and
 * lineage describe what was actually published, so they are derived from the
 * store rather than from the contract's declared numbers.
 */
async function readCanonicalSlices(): Promise<Map<string, CanonicalSlice>> {
	const path = canonicalDbPath();
	if (!existsSync(path)) throw new Error(`Canonical DuckDB not found at ${path}`);

	const database = new duckdb.Database(path);
	try {
		const codes = EXPORTACIONES_INDICATOR_CODES.map((code) => `'${code}'`).join(', ');
		const rows = await queryDuckDb<CanonicalSlice>(
			database,
			`
				SELECT indicator_code, COUNT(*) AS row_count,
					MIN(time_period) AS period_start, MAX(time_period) AS period_end
				FROM observations
				WHERE indicator_code IN (${codes}) AND freq = '${FREQ}'
				GROUP BY indicator_code
			`
		);
		return new Map(rows.map((row) => [row.indicator_code, row]));
	} finally {
		database.close();
	}
}

async function upsertDataSource(): Promise<number> {
	const existing = await db
		.select({ id: dataSources.id })
		.from(dataSources)
		.where(eq(dataSources.code, EXPORTACIONES_SOURCE_CODE))
		.limit(1);

	const values = {
		code: EXPORTACIONES_SOURCE_CODE,
		name: 'Exportaciones',
		description:
			`${EXPORTACIONES_THEME}. Registros administrativos aduaneros de exportación (DANE), ` +
			'con la correlativa TOTPART aplicada. Clasificación CIIU Rev. 4 A.C. 2022.'
	};

	if (existing.length > 0) {
		await db.update(dataSources).set(values).where(eq(dataSources.id, existing[0].id));
		return existing[0].id;
	}

	const [created] = await db.insert(dataSources).values(values).returning({ id: dataSources.id });
	return created.id;
}

async function upsertIndicatorGroup(dataSourceId: number): Promise<number> {
	const existing = await db
		.select({ id: indicatorGroups.id })
		.from(indicatorGroups)
		.where(
			and(eq(indicatorGroups.dataSourceId, dataSourceId), eq(indicatorGroups.code, GROUP_CODE))
		)
		.limit(1);

	const values = {
		dataSourceId,
		code: GROUP_CODE,
		name: 'Exportaciones',
		description: 'Valor FOB y toneladas métricas exportadas, por siete desagregaciones.',
		sourceType: 'administrative_records'
	};

	if (existing.length > 0) {
		await db.update(indicatorGroups).set(values).where(eq(indicatorGroups.id, existing[0].id));
		return existing[0].id;
	}

	const [created] = await db
		.insert(indicatorGroups)
		.values(values)
		.returning({ id: indicatorGroups.id });
	return created.id;
}

async function upsertDimensions() {
	for (const [index, dimension] of EXPORTACIONES_DIMENSIONS.entries()) {
		const existing = await db
			.select({ id: dimensionDefinitions.id })
			.from(dimensionDefinitions)
			.where(eq(dimensionDefinitions.code, dimension.code))
			.limit(1);

		const values = {
			code: dimension.code,
			name: dimension.name,
			// After the seven standard dimensions, in contract order.
			sortOrder: 100 + index,
			isStandard: false
		};

		if (existing.length > 0) {
			await db
				.update(dimensionDefinitions)
				.set(values)
				.where(eq(dimensionDefinitions.id, existing[0].id));
		} else {
			await db.insert(dimensionDefinitions).values(values);
		}
	}
}

/**
 * Loads the authoritative labels from the correlativas workbook.
 *
 * `dimension_values.code` must hold MATCH_KEY, not the official CODE: MATCH_KEY
 * is what the parquet — and therefore `observations.ext_2` — actually contains.
 * The two differ where the official code keeps a leading zero (modality 002 is
 * stored as 2), and looking up by CODE would silently fail to label those.
 */
async function replaceDimensionValues() {
	const paths = defaultSourcePaths();
	const source = await openSourceDb(paths);
	let entries;
	try {
		entries = await readCodelists(source);
	} finally {
		source.close();
	}

	const registered = new Set(EXPORTACIONES_DIMENSIONS.map((dimension) => dimension.code));
	const relevant = entries.filter((entry) => registered.has(entry.dimension));

	await db.delete(dimensionValues).where(inArray(dimensionValues.dimensionCode, [...registered]));

	const byDimension = new Map<string, typeof relevant>();
	for (const entry of relevant) {
		byDimension.set(entry.dimension, [...(byDimension.get(entry.dimension) ?? []), entry]);
	}

	let inserted = 0;
	for (const [dimension, dimensionEntries] of byDimension) {
		const rows = dimensionEntries
			.slice()
			.sort((a, b) => a.label.localeCompare(b.label, 'es'))
			.map((entry, index) => ({
				dimensionCode: dimension,
				code: entry.matchKey,
				labelEs: entry.label,
				sortOrder: index
			}));

		// libsql caps variables per statement; 200 rows x 4 columns stays well under.
		for (let i = 0; i < rows.length; i += 200) {
			await db.insert(dimensionValues).values(rows.slice(i, i + 200));
		}
		inserted += rows.length;
	}

	return inserted;
}

async function upsertIndicators(indicatorGroupId: number): Promise<Map<string, number>> {
	const ids = new Map<string, number>();

	for (const indicator of EXPORTACIONES_INDICATORS) {
		const measureNote =
			indicator.measure === 'FOBDOL'
				? 'Suma del valor FOB en dólares (SUM(FOBDOL)).'
				: 'Suma del peso neto en kilogramos dividida por 1000 (SUM(PNK)/1000).';

		const values = {
			indicatorGroupId,
			code: indicator.code,
			name: indicator.name,
			shortName: indicator.name,
			description: `${indicator.name}. Desagregación: ${
				EXPORTACIONES_DIMENSIONS.find((d) => d.code === indicator.dimension)?.name
			}.`,
			methodology:
				`${measureNote} Agregación SUM sin factores de expansión. ` +
				'Registros administrativos aduaneros, no estimaciones de encuesta; ' +
				'OBS_STATUS=A indica valor calculado a partir de registros administrativos. ' +
				'Los valores faltantes se publican como categoría _U para preservar la conciliación. ' +
				'Sin ajuste estacional.',
			frequency: FREQ,
			sourceCitation: SOURCE_CITATION,
			unit: indicator.unit,
			unitMult: UNIT_MULT,
			decimals: DECIMALS,
			defaultViz: 'line'
		};

		const existing = await db
			.select({ id: indicators.id })
			.from(indicators)
			.where(eq(indicators.code, indicator.code))
			.limit(1);

		if (existing.length > 0) {
			await db.update(indicators).set(values).where(eq(indicators.id, existing[0].id));
			ids.set(indicator.code, existing[0].id);
		} else {
			const [created] = await db.insert(indicators).values(values).returning({ id: indicators.id });
			ids.set(indicator.code, created.id);
		}
	}

	return ids;
}

async function upsertFrequenciesAndDimensions(ids: Map<string, number>) {
	for (const indicator of EXPORTACIONES_INDICATORS) {
		const indicatorId = ids.get(indicator.code)!;

		const existingFreq = await db
			.select({ id: indicatorFrequencies.id })
			.from(indicatorFrequencies)
			.where(
				and(
					eq(indicatorFrequencies.indicatorId, indicatorId),
					eq(indicatorFrequencies.freq, FREQ)
				)
			)
			.limit(1);
		if (existingFreq.length === 0) {
			await db.insert(indicatorFrequencies).values({ indicatorId, freq: FREQ });
		}

		// Replace rather than merge: the registered dimension set is the declared
		// observation contract, and a stale extra row would break upload validation.
		await db.delete(indicatorDimensions).where(eq(indicatorDimensions.indicatorId, indicatorId));

		await db.insert(indicatorDimensions).values([
			{
				indicatorId,
				freq: FREQ,
				dimensionCode: indicator.dimension,
				isFilterable: true,
				isSplitable: true
			},
			...CONTEXT_DIMENSIONS.map((dimensionCode) => ({
				indicatorId,
				freq: FREQ,
				dimensionCode,
				isFilterable: true,
				isSplitable: false
			}))
		]);
	}
}

async function recordReleasesAndLineage(ids: Map<string, number>) {
	const slices = await readCanonicalSlices();
	const paths = defaultSourcePaths();
	const checksum = createHash('sha256').update(readFileSync(paths.parquetPath)).digest('hex');
	const sourceName = paths.parquetPath.split('/').pop()!;

	let totalRows = 0;

	for (const indicator of EXPORTACIONES_INDICATORS) {
		const indicatorId = ids.get(indicator.code)!;
		const slice = slices.get(indicator.code);
		if (!slice) {
			throw new Error(
				`${indicator.code} has no observations in the canonical store; run canonical:build first`
			);
		}

		const rowCount = toNumber(slice.row_count);
		if (rowCount !== indicator.rowCount) {
			throw new Error(
				`${indicator.code}: canonical store has ${rowCount} rows, contract declares ${indicator.rowCount}`
			);
		}
		totalRows += rowCount;

		const [release] = await db
			.insert(dataReleases)
			.values({
				indicatorId,
				periodStart: slice.period_start,
				periodEnd: slice.period_end,
				rowCount,
				sourceFormat: 'parquet',
				sourceName,
				status: 'published',
				checksum
			})
			.returning({ id: dataReleases.id });

		await db
			.delete(indicatorDataSources)
			.where(
				and(
					eq(indicatorDataSources.indicatorId, indicatorId),
					eq(indicatorDataSources.freq, FREQ)
				)
			);

		await db.insert(indicatorDataSources).values({
			indicatorId,
			refArea: EXPORTACIONES_EXPECTED.refArea,
			freq: FREQ,
			yearMin: Number(slice.period_start.slice(0, 4)),
			yearMax: Number(slice.period_end.slice(0, 4)),
			rowCount,
			releaseId: release.id
		});
	}

	return { totalRows, checksum };
}

async function main() {
	console.log('[exportaciones] Validating source files against the contract...');
	const validation = await validateExportacionesSource();
	if (!validation.ok) {
		console.error('[exportaciones] Source does not satisfy the contract:');
		for (const error of validation.errors) console.error('  -', error);
		process.exit(1);
	}
	console.log(
		`[exportaciones] Source OK: ${validation.stats.rowCount.toLocaleString()} observations, ` +
			`${validation.stats.codelistRows} codelist entries, ` +
			`${validation.stats.periodStart}..${validation.stats.periodEnd}`
	);

	if (DRY_RUN) {
		console.log('[exportaciones] --dry-run: no registry writes performed.');
		return;
	}

	const dataSourceId = await upsertDataSource();
	console.log('[exportaciones] Data source id', dataSourceId);

	const groupId = await upsertIndicatorGroup(dataSourceId);
	console.log('[exportaciones] Indicator group id', groupId);

	await upsertDimensions();
	console.log(`[exportaciones] Registered ${EXPORTACIONES_DIMENSIONS.length} dimensions`);

	const valueCount = await replaceDimensionValues();
	console.log(`[exportaciones] Loaded ${valueCount} dimension values from the correlativas workbook`);

	const ids = await upsertIndicators(groupId);
	console.log(`[exportaciones] Upserted ${ids.size} indicators`);

	await upsertFrequenciesAndDimensions(ids);
	console.log('[exportaciones] Registered frequencies and indicator dimensions');

	const { totalRows, checksum } = await recordReleasesAndLineage(ids);
	console.log(
		`[exportaciones] Recorded releases and lineage for ${totalRows.toLocaleString()} rows ` +
			`(parquet sha256 ${checksum.slice(0, 12)}...)`
	);

	console.log('[exportaciones] Done.');
}

main().catch((error) => {
	console.error('[exportaciones] Failed:', error);
	process.exit(1);
});
