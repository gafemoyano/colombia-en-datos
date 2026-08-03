import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	canonicalizeBatchParquet,
	type SavedContractLoader,
	type SavedSliceContract
} from './canonicalize';
import {
	createAcceptedMappingManifest,
	type AcceptedBatchColumnMapping,
	type CollapsedFixedDimension
} from './storage';

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
		database.prepare(query).all((error) => {
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

function acceptedManifest(params: {
	mappings: AcceptedBatchColumnMapping[];
	collapsedDimensions?: CollapsedFixedDimension[];
}) {
	return createAcceptedMappingManifest({
		batchId: 1,
		acceptedAt: '2026-07-13T00:00:00.000Z',
		sourceIntegrity: { algorithm: 'sha256', digest: 'a'.repeat(64), byteLength: 100 },
		mappings: params.mappings,
		collapsedDimensions: params.collapsedDimensions || []
	});
}

function mapping(
	sourceColumn: string,
	canonicalField: AcceptedBatchColumnMapping['canonicalField'],
	transforms: AcceptedBatchColumnMapping['transforms'] = ['identity']
): AcceptedBatchColumnMapping {
	return { sourceColumn, canonicalField, transforms };
}

function contractLoader(
	contracts: Array<
		Pick<
			SavedSliceContract,
			'indicatorCode' | 'freq' | 'dimensionCodes' | 'dimensionFields' | 'allowedValuesByDimension'
		> &
			Partial<SavedSliceContract>
	>
): SavedContractLoader {
	return async () =>
		contracts.map((contract, index) => ({
			indicatorId: index + 1,
			indicatorExists: true,
			frequencyDefined: true,
			unsupportedDimensionCodes: [],
			...contract
		}));
}

const requiredSourceMappings: AcceptedBatchColumnMapping[] = [
	mapping('INDICADOR', 'indicator_code', ['trim']),
	mapping('FREQ', 'freq', ['trim', 'uppercase']),
	mapping('REF_AREA', 'ref_area', ['trim', 'uppercase']),
	mapping('TIME_PERIOD', 'time_period', ['trim', 'geih-month-year-to-iso-month']),
	mapping('OBS_VALUE', 'obs_value', ['numeric'])
];

describe('canonicalizeBatchParquet', () => {
	it('projects only accepted lowercase Observation columns and normalizes monthly values', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-canonicalize-'));
		try {
			const filePath = join(directory, 'geih.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('EMP', 'm', 'co', '1-2024', '10.5', 'NAT', '%', 1, 2024),
						('EMP', 'm', 'co', '02-2024', NULL, 'NAT', '%', 1, 2024)
					) AS t(INDICADOR, FREQ, REF_AREA, TIME_PERIOD, OBS_VALUE, GEO_LEVEL, UNIT, DECIMALS, YEAR)
				`
			);
			const manifest = acceptedManifest({
				mappings: [
					...requiredSourceMappings,
					mapping('GEO_LEVEL', 'geo_level', ['trim', 'uppercase']),
					mapping('UNIT', 'unit', ['trim']),
					mapping('DECIMALS', 'decimals', ['numeric']),
					mapping('YEAR', null)
				],
				collapsedDimensions: [
					{
						sliceKey: 'EMP/M',
						sourceColumn: 'GEO_LEVEL',
						canonicalField: 'geo_level',
						dimensionCode: 'GEO_LEVEL',
						value: 'NAT'
					}
				]
			});

			const result = await canonicalizeBatchParquet({
				filePath,
				acceptedMapping: manifest,
				contractLoader: contractLoader([
					{
						indicatorCode: 'EMP',
						freq: 'M',
						dimensionCodes: [],
						dimensionFields: [],
						allowedValuesByDimension: {}
					}
				])
			});

			expect(result.valid).toBe(true);
			expect(result.slices.map((slice) => slice.key)).toEqual(['EMP/M']);
			expect(result.slices[0].columns).toEqual([
				'indicator_code',
				'freq',
				'ref_area',
				'time_period',
				'obs_value'
			]);
			expect(result.slices[0].rows).toEqual([
				{
					indicator_code: 'EMP',
					freq: 'M',
					ref_area: 'CO',
					time_period: '2024-01',
					obs_value: 10.5
				},
				{
					indicator_code: 'EMP',
					freq: 'M',
					ref_area: 'CO',
					time_period: '2024-02',
					obs_value: null
				}
			]);
			expect(Object.keys(result.slices[0].rows[0])).not.toContain('unit');
			expect(Object.keys(result.slices[0].rows[0])).not.toContain('year');
			expect(Object.keys(result.slices[0].rows[0])).not.toContain('geo_level');
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('hard-fails invalid periods and non-null values that cannot cast to DOUBLE', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-canonicalize-'));
		try {
			const filePath = join(directory, 'invalid.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('EMP', 'M', 'CO', '13-2024', 'not-a-number'),
						('EMP', 'M', 'CO', '2024/02', NULL)
					) AS t(INDICADOR, FREQ, REF_AREA, TIME_PERIOD, OBS_VALUE)
				`
			);

			const result = await canonicalizeBatchParquet({
				filePath,
				acceptedMapping: acceptedManifest({ mappings: requiredSourceMappings }),
				contractLoader: contractLoader([
					{
						indicatorCode: 'EMP',
						freq: 'M',
						dimensionCodes: [],
						dimensionFields: [],
						allowedValuesByDimension: {}
					}
				])
			});

			expect(result.valid).toBe(false);
			expect(result.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ code: 'invalid_time_period', severity: 'error' }),
					expect.objectContaining({ code: 'invalid_obs_value', severity: 'error' })
				])
			);
			expect(result.slices[0].rows[0].obs_value).toBeNull();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('validates required and extra dimensions, populated codelists, fixed values, and duplicates after collapse', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-canonicalize-'));
		try {
			const filePath = join(directory, 'contracts.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('EMP', 'M', 'CO', '2024-01', 1.0, 'NAT', 'X'),
						('EMP', 'M', 'CO', '2024-01', 2.0, 'DEP', 'X')
					) AS t(INDICADOR, FREQ, REF_AREA, TIME_PERIOD, OBS_VALUE, GEO_LEVEL, SEX)
				`
			);
			const result = await canonicalizeBatchParquet({
				filePath,
				acceptedMapping: acceptedManifest({
					mappings: [
						...requiredSourceMappings,
						mapping('GEO_LEVEL', 'geo_level', ['trim', 'uppercase']),
						mapping('SEX', 'sex', ['trim', 'uppercase'])
					],
					collapsedDimensions: [
						{
							sliceKey: 'EMP/M',
							sourceColumn: 'GEO_LEVEL',
							canonicalField: 'geo_level',
							dimensionCode: 'GEO_LEVEL',
							value: 'NAT'
						}
					]
				}),
				contractLoader: contractLoader([
					{
						indicatorCode: 'EMP',
						freq: 'M',
						dimensionCodes: ['SEX', 'AGE'],
						dimensionFields: ['sex', 'age'],
						allowedValuesByDimension: { SEX: ['T', 'M', 'F'], AGE: [] }
					}
				])
			});

			expect(result.valid).toBe(false);
			expect(result.slices[0].columns).toEqual([
				'indicator_code',
				'freq',
				'ref_area',
				'time_period',
				'obs_value',
				'sex',
				'age'
			]);
			expect(result.diagnostics.map((item) => item.code)).toEqual(
				expect.arrayContaining([
					'missing_required_dimensions',
					'dimension_value_not_allowed',
					'collapsed_fixed_value_mismatch',
					'duplicate_canonical_keys'
				])
			);
			expect(result.slices[0].rows.every((row) => !('geo_level' in row))).toBe(true);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	it('distinguishes missing indicators from existing indicators without a saved frequency', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'ced-canonicalize-'));
		try {
			const filePath = join(directory, 'definitions.parquet');
			await writeParquetFixture(
				filePath,
				`
					SELECT * FROM (VALUES
						('EXISTING', 'A', 'CO', '2024', 1.0),
						('MISSING', 'A', 'CO', '2024', 2.0)
					) AS t(indicator_code, freq, ref_area, time_period, obs_value)
				`
			);
			const result = await canonicalizeBatchParquet({
				filePath,
				acceptedMapping: acceptedManifest({
					mappings: [
						mapping('indicator_code', 'indicator_code'),
						mapping('freq', 'freq'),
						mapping('ref_area', 'ref_area'),
						mapping('time_period', 'time_period'),
						mapping('obs_value', 'obs_value')
					]
				}),
				contractLoader: contractLoader([
					{
						indicatorCode: 'EXISTING',
						freq: 'A',
						frequencyDefined: false,
						dimensionCodes: [],
						dimensionFields: [],
						allowedValuesByDimension: {}
					},
					{
						indicatorCode: 'MISSING',
						freq: 'A',
						indicatorId: null,
						indicatorExists: false,
						frequencyDefined: false,
						dimensionCodes: [],
						dimensionFields: [],
						allowedValuesByDimension: {}
					}
				])
			});

			expect(result.slices.map((slice) => slice.key)).toEqual(['EXISTING/A', 'MISSING/A']);
			expect(result.diagnostics).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						code: 'indicator_frequency_not_defined',
						sliceKey: 'EXISTING/A'
					}),
					expect.objectContaining({ code: 'indicator_not_found', sliceKey: 'MISSING/A' })
				])
			);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
