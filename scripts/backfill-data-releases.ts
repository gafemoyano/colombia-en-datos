import 'dotenv/config';
import duckdb from 'duckdb';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/lib/db/script-client';
import { dataReleases, indicatorDataSources, indicators } from '../src/lib/db/schema';

interface CanonicalSliceRow {
	indicator_code: string;
	freq: string;
	ref_area: string;
	row_count: number | bigint;
	period_start: string | null;
	period_end: string | null;
	year_min: number | null;
	year_max: number | null;
}

function canonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) return resolve(process.env.CANONICAL_DUCKDB_PATH);
	if (process.env.DATA_PATH) return join(resolve(process.env.DATA_PATH), 'observations.duckdb');
	return join(process.cwd(), 'data', 'observations.duckdb');
}

function queryDuckDb<T>(database: duckdb.Database, query: string): Promise<T[]> {
	return new Promise((resolve, reject) => {
		database.all(query, (error: Error | null, rows: T[]) => {
			if (error) reject(error);
			else resolve(rows);
		});
	});
}

function toNumber(value: number | bigint | null | undefined): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	return 0;
}

async function main() {
	const path = canonicalDbPath();
	if (!existsSync(path)) throw new Error(`Canonical DuckDB not found at ${path}`);

	console.log('[backfill] Canonical store:', path);
	const database = new duckdb.Database(path);
	const rows = await queryDuckDb<CanonicalSliceRow>(
		database,
		`
			SELECT
				indicator_code,
				freq,
				ref_area,
				COUNT(*) AS row_count,
				MIN(time_period) AS period_start,
				MAX(time_period) AS period_end,
				MIN(TRY_CAST(SUBSTR(time_period, 1, 4) AS INTEGER)) AS year_min,
				MAX(TRY_CAST(SUBSTR(time_period, 1, 4) AS INTEGER)) AS year_max
			FROM observations
			GROUP BY indicator_code, freq, ref_area
			ORDER BY indicator_code, freq, ref_area
		`
	);

	console.log(`[backfill] Found ${rows.length} canonical indicator/frequency/reference-area slices`);

	const rowsByIndicatorFrequency = new Map<string, CanonicalSliceRow[]>();
	for (const row of rows) {
		const key = `${row.indicator_code}\u0000${row.freq}`;
		rowsByIndicatorFrequency.set(key, [...(rowsByIndicatorFrequency.get(key) || []), row]);
	}

	let releasesCreated = 0;
	let sourceRowsCreated = 0;
	let skipped = 0;

	for (const [key, sourceRows] of rowsByIndicatorFrequency.entries()) {
		const [indicatorCode, freq] = key.split('\u0000');
		const indicatorRows = await db
			.select({ id: indicators.id })
			.from(indicators)
			.where(eq(indicators.code, indicatorCode))
			.limit(1);

		if (indicatorRows.length === 0) {
			console.warn(`[backfill] Skipping unknown indicator ${indicatorCode}/${freq}`);
			skipped++;
			continue;
		}

		const indicatorId = indicatorRows[0].id;
		const existing = await db
			.select({ id: indicatorDataSources.id })
			.from(indicatorDataSources)
			.where(
				and(eq(indicatorDataSources.indicatorId, indicatorId), eq(indicatorDataSources.freq, freq))
			)
			.limit(1);

		if (existing.length > 0) {
			skipped++;
			continue;
		}

		const totalRows = sourceRows.reduce((sum, row) => sum + toNumber(row.row_count), 0);
		const periodStart = sourceRows
			.map((row) => row.period_start)
			.filter((value): value is string => Boolean(value))
			.sort()[0];
		const periodEnd = sourceRows
			.map((row) => row.period_end)
			.filter((value): value is string => Boolean(value))
			.sort()
			.at(-1);

		const [release] = await db
			.insert(dataReleases)
			.values({
				indicatorId,
				periodStart: periodStart || null,
				periodEnd: periodEnd || null,
				rowCount: totalRows,
				sourceFormat: 'canonical_backfill',
				sourceName: 'observations.duckdb',
				status: 'published'
			})
			.returning({ id: dataReleases.id });
		releasesCreated++;

		await db.insert(indicatorDataSources).values(
			sourceRows.map((row) => ({
				indicatorId,
				refArea: row.ref_area,
				freq,
				yearMin: row.year_min,
				yearMax: row.year_max,
				rowCount: toNumber(row.row_count),
				releaseId: release.id
			}))
		);
		sourceRowsCreated += sourceRows.length;
	}

	console.log(
		`[backfill] Done: ${releasesCreated} releases, ${sourceRowsCreated} indicator-data-source rows, ${skipped} skipped`
	);
}

main().catch((error) => {
	console.error('[backfill] Failed:', error);
	process.exit(1);
});
