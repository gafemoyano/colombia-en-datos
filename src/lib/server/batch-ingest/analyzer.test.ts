import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeBatchParquet } from './analyzer';

interface DuckDbStatement {
	all(callback: (error: Error | null, rows: unknown[]) => void): void;
}

interface DuckDbDatabase {
	prepare(query: string): DuckDbStatement;
	close(callback?: (error: Error | null) => void): void;
}

interface DuckDbModule {
	Database: new (path: string, callback?: (error: Error | null) => void) => DuckDbDatabase;
}

async function loadDuckDB(): Promise<DuckDbModule> {
	const imported = await import('duckdb');
	return ((imported as { default?: DuckDbModule }).default || imported) as DuckDbModule;
}

async function createInMemoryDuckDb(): Promise<DuckDbDatabase> {
	const duckdb = await loadDuckDB();
	return new Promise((resolve, reject) => {
		let instance: DuckDbDatabase;
		instance = new duckdb.Database(':memory:', (error: Error | null) => {
			if (error) reject(error);
			else resolve(instance);
		});
	});
}

function runQuery(database: DuckDbDatabase, query: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const stmt = database.prepare(query);
		stmt.all((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function closeDuckDb(database: DuckDbDatabase): Promise<void> {
	return new Promise((resolve, reject) => {
		database.close((error) => {
			if (error) reject(error);
			else resolve();
		});
	});
}

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

async function writeParquetFixture(filePath: string, selectSql: string): Promise<void> {
	const database = await createInMemoryDuckDb();
	try {
		await runQuery(database, `COPY (${selectSql}) TO ${sqlString(filePath)} (FORMAT PARQUET)`);
	} finally {
		await closeDuckDb(database);
	}
}

describe('batch analyzer workflow smoke coverage', () => {
	it('profiles canonical multi-indicator batch output without requiring an indicatorCode input', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ced-analyzer-'));
		try {
			const filePath = join(dir, 'canonical.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('EMP', 'M', 'CO', '2024-01', 10.5, 'NAT', 'T'),
						('EMP', 'M', 'CO', '2024-02', 11.0, 'NAT', 'T'),
						('UNEMP', 'M', 'CO', '2024-01', 5.0, 'NAT', 'T')
					) AS t(indicator_code, freq, ref_area, time_period, obs_value, geo_level, sex)
				`
			);

			const profile = await analyzeBatchParquet({ filePath, originalName: 'canonical.parquet' });

			expect(profile.source.rowCount).toBe(3);
			expect(profile.totals.sliceCount).toBe(2);
			expect(profile.slices.map((slice) => slice.key)).toEqual(['EMP/M', 'UNEMP/M']);
			expect(profile.mappings.missingRequiredFields).toEqual([]);
			expect(profile.uniformDimensionality).toMatchObject({
				compatible: true,
				flatDimensionFields: ['geo_level', 'sex'],
				fixedTotalCandidateFields: ['geo_level', 'sex']
			});
			expect(profile.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual(
				[]
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('profiles GEIH-like source-shaped output with aliases, period conversion, and fixed-total dimensions', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ced-analyzer-'));
		try {
			const filePath = join(dir, 'geih-like.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('TD', 'M', 'CO', '1-2010', 7.1, 'NAT', 'T', 'N', '%', 0, 1),
						('TD', 'M', 'CO', '2-2010', 7.4, 'NAT', 'T', 'N', '%', 0, 1),
						('OCU', 'M', 'CO', '1-2010', 21000.0, 'NAT', 'T', 'N', 'persons', 3, 0)
					) AS t(INDICADOR, FREQ, REF_AREA, TIME_PERIOD, OBS_VALUE, GEO_LEVEL, SEX, ADJUSTEMENT, UNIT, UNIT_MULT, DECIMALS)
				`
			);

			const profile = await analyzeBatchParquet({ filePath, originalName: 'geih-like.parquet' });

			expect(profile.slices.map((slice) => slice.key)).toEqual(['OCU/M', 'TD/M']);
			expect(profile.mappings.mappings).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						sourceColumn: 'INDICADOR',
						canonicalField: 'indicator_code',
						confidence: 'source-alias'
					}),
					expect.objectContaining({
						sourceColumn: 'ADJUSTEMENT',
						canonicalField: 'adjustment',
						confidence: 'source-alias'
					})
				])
			);
			expect(profile.slices.find((slice) => slice.key === 'TD/M')).toMatchObject({
				periodStart: '2010-01',
				periodEnd: '2010-02',
				sourcePeriodStart: '1-2010',
				sourcePeriodEnd: '2-2010'
			});
			expect(profile.uniformDimensionality.fixedTotalCandidateFields).toEqual(['geo_level', 'sex']);
			expect(profile.adminReviewQuestions.map((question) => question.id)).toContain(
				'review-fixed-total-dimensions'
			);
			expect(profile.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: 'source_period_converted', severity: 'info' }),
					expect.objectContaining({ code: 'source_alias_mapping', severity: 'info' })
				])
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it('reports explicit errors when provided slice dimension contracts conflict with the flat file', async () => {
		const dir = await mkdtemp(join(tmpdir(), 'ced-analyzer-'));
		try {
			const filePath = join(dir, 'dimension-conflict.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('EMP', 'M', 'CO', '2024-01', 10.5, 'NAT', 'T')
					) AS t(indicator_code, freq, ref_area, time_period, obs_value, geo_level, sex)
				`
			);

			const profile = await analyzeBatchParquet({
				filePath,
				originalName: 'dimension-conflict.parquet',
				sliceDimensionContracts: [
					{ indicatorCode: 'EMP', freq: 'M', dimensionFields: ['geo_level'] }
				]
			});

			expect(profile.uniformDimensionality.compatible).toBe(false);
			expect(profile.uniformDimensionality.sliceResults[0]).toMatchObject({
				sliceKey: 'EMP/M',
				contractSource: 'provided',
				extraInFile: ['sex'],
				compatible: false
			});
			expect(profile.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						severity: 'error',
						code: 'dimension_contract_mismatch',
						sliceKey: 'EMP/M'
					})
				])
			);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
