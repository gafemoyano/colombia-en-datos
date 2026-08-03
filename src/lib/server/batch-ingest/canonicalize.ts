import { and, eq, or } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	dimensionValues,
	indicatorDimensions,
	indicatorFrequencies,
	indicators
} from '$lib/db/schema';
import type { AcceptedMappingManifest, CollapsedFixedDimension } from './storage';
import {
	CANONICAL_DIMENSION_FIELDS,
	CANONICAL_MEASUREMENT_METADATA_FIELDS,
	CANONICAL_REQUIRED_FIELDS,
	type BatchDiagnostic,
	type BatchMappingTransform,
	type CanonicalBatchField,
	type CanonicalDimensionField
} from './types';

const OBSERVATION_OPTIONAL_FIELDS = ['obs_status'] as const;
const ACCEPTED_CANONICAL_FIELDS = new Set<CanonicalBatchField>([
	...CANONICAL_REQUIRED_FIELDS,
	...CANONICAL_DIMENSION_FIELDS,
	...CANONICAL_MEASUREMENT_METADATA_FIELDS
]);
const SUPPORTED_FREQUENCIES = new Set(['A', 'M', 'Q', 'D']);
const KNOWN_TRANSFORMS = new Set<BatchMappingTransform>([
	'identity',
	'trim',
	'uppercase',
	'numeric',
	'geih-month-year-to-iso-month'
]);

const DIMENSION_CODE_BY_FIELD: Record<CanonicalDimensionField, string> = {
	geo_level: 'GEO_LEVEL',
	dept_code: 'DEPT_CODE',
	muni_code: 'MUNI_CODE',
	urban_rural: 'URBAN_RURAL',
	sex: 'SEX',
	age: 'AGE',
	adjustment: 'ADJUSTMENT',
	ext_1: 'EXT_1',
	ext_2: 'EXT_2',
	ext_3: 'EXT_3'
};
const DIMENSION_FIELD_BY_CODE = new Map(
	Object.entries(DIMENSION_CODE_BY_FIELD).map(([field, code]) => [
		code,
		field as CanonicalDimensionField
	])
);

interface DuckDbStatement {
	all(...args: unknown[]): void;
}

interface DuckDbDatabase {
	prepare(query: string): DuckDbStatement;
	close(callback?: (error: Error | null) => void): void;
}

interface DuckDbModule {
	Database: new (path: string, callback?: (error: Error | null) => void) => DuckDbDatabase;
}

type AppDb = ReturnType<typeof getDb>;
type CanonicalObservationScalar = string | number | null;

export type CanonicalObservationRow = Record<string, CanonicalObservationScalar> & {
	indicator_code: string;
	freq: string;
	ref_area: string | null;
	time_period: string | null;
	obs_value: number | null;
};

export interface SavedSliceContract {
	indicatorCode: string;
	freq: string;
	indicatorId: number | null;
	indicatorExists: boolean;
	frequencyDefined: boolean;
	dimensionCodes: string[];
	dimensionFields: CanonicalDimensionField[];
	unsupportedDimensionCodes: string[];
	allowedValuesByDimension: Record<string, string[]>;
}

export type SavedContractLoader = (
	slices: Array<{ indicatorCode: string; freq: string }>
) => Promise<SavedSliceContract[]>;

export interface CanonicalizedBatchSlice {
	key: string;
	indicatorCode: string;
	freq: string;
	indicatorId: number | null;
	columns: string[];
	rows: CanonicalObservationRow[];
	rowCount: number;
	periodStart: string | null;
	periodEnd: string | null;
	valid: boolean;
	diagnostics: BatchDiagnostic[];
}

export interface CanonicalizeBatchResult {
	valid: boolean;
	columns: string[];
	rowCount: number;
	slices: CanonicalizedBatchSlice[];
	diagnostics: BatchDiagnostic[];
}

export interface CanonicalizeBatchParquetInput {
	filePath: string;
	acceptedMapping: AcceptedMappingManifest;
	contractLoader?: SavedContractLoader;
	maxRows?: number;
}

interface ProjectedRow {
	values: Partial<Record<CanonicalBatchField, unknown>>;
	invalidObsValue: boolean;
}

function quoteIdentifier(identifier: string): string {
	return `"${identifier.replace(/"/g, '""')}"`;
}

function toNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return Number(value);
}

function toNullableString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return String(value);
}

function diagnostic(
	code: string,
	message: string,
	details?: Record<string, unknown>,
	sliceKey?: string
): BatchDiagnostic {
	return { severity: 'error', code, message, sliceKey, details };
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

function runQuery<T>(database: DuckDbDatabase, query: string, ...params: unknown[]): Promise<T[]> {
	return new Promise((resolve, reject) => {
		const statement = database.prepare(query);
		statement.all(...params, (error: Error | null, rows: T[]) => {
			if (error) reject(error);
			else resolve(rows);
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

async function describeSourceColumns(
	database: DuckDbDatabase,
	filePath: string
): Promise<string[]> {
	const rows = await runQuery<{ column_name: string }>(
		database,
		'DESCRIBE SELECT * FROM read_parquet(?)',
		filePath
	);
	return rows.map((row) => row.column_name);
}

function validateMappings(manifest: AcceptedMappingManifest, sourceColumns: string[]): void {
	const sourceWhitelist = new Set(sourceColumns);
	const seenSources = new Set<string>();
	const acceptedTargets = new Set<CanonicalBatchField>();

	for (const mapping of manifest.mappings) {
		if (!sourceWhitelist.has(mapping.sourceColumn)) {
			throw new Error(`Accepted mapping source column does not exist: ${mapping.sourceColumn}`);
		}
		if (seenSources.has(mapping.sourceColumn)) {
			throw new Error(`Accepted mapping repeats source column: ${mapping.sourceColumn}`);
		}
		seenSources.add(mapping.sourceColumn);
		for (const transform of mapping.transforms) {
			if (!KNOWN_TRANSFORMS.has(transform)) {
				throw new Error(`Unsupported accepted mapping transform: ${String(transform)}`);
			}
		}
		if (mapping.canonicalField === null) continue;
		if (!ACCEPTED_CANONICAL_FIELDS.has(mapping.canonicalField)) {
			throw new Error(`Unsupported accepted canonical field: ${String(mapping.canonicalField)}`);
		}
		if (acceptedTargets.has(mapping.canonicalField)) {
			throw new Error(`Multiple accepted mappings target ${mapping.canonicalField}`);
		}
		acceptedTargets.add(mapping.canonicalField);
	}

	for (const field of CANONICAL_REQUIRED_FIELDS) {
		if (!acceptedTargets.has(field)) {
			throw new Error(`Accepted mapping is missing required canonical field: ${field}`);
		}
	}
}

function applyTransforms(value: unknown, transforms: BatchMappingTransform[]): unknown {
	let transformed = value;
	for (const transform of transforms) {
		if (transformed === null || transformed === undefined) return null;
		if (transform === 'identity' || transform === 'geih-month-year-to-iso-month') continue;
		if (transform === 'trim') {
			const trimmed = String(transformed).trim();
			transformed = trimmed === '' ? null : trimmed;
		} else if (transform === 'uppercase') {
			transformed = String(transformed).toUpperCase();
		} else if (transform === 'numeric') {
			const numeric = toNumber(transformed);
			transformed = Number.isFinite(numeric) ? numeric : null;
		}
	}
	return transformed;
}

function normalizePeriod(value: unknown, freq: string): string | null {
	const period = toNullableString(value);
	if (period === null) return null;
	if (freq === 'M') {
		const sourceMatch = /^(0?[1-9]|1[0-2])-(\d{4})$/.exec(period);
		if (sourceMatch) return `${sourceMatch[2]}-${sourceMatch[1].padStart(2, '0')}`;
		return /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : null;
	}
	if (freq === 'A') return /^\d{4}$/.test(period) ? period : null;
	if (freq === 'Q') return /^\d{4}-Q[1-4]$/.test(period) ? period : null;
	if (freq === 'D') {
		if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(period)) return null;
		const date = new Date(`${period}T00:00:00Z`);
		return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === period
			? period
			: null;
	}
	return null;
}

async function projectAcceptedRows(
	database: DuckDbDatabase,
	filePath: string,
	manifest: AcceptedMappingManifest
): Promise<ProjectedRow[]> {
	const projectedMappings = manifest.mappings.filter(
		(mapping) =>
			mapping.canonicalField !== null &&
			(
				[
					...CANONICAL_REQUIRED_FIELDS,
					...CANONICAL_DIMENSION_FIELDS,
					...OBSERVATION_OPTIONAL_FIELDS
				] as string[]
			).includes(mapping.canonicalField)
	);
	const selections = projectedMappings.flatMap((mapping, index) => {
		const source = quoteIdentifier(mapping.sourceColumn);
		return [
			`${source} AS ${quoteIdentifier(`__m${index}`)}`,
			...(mapping.canonicalField === 'obs_value'
				? [`TRY_CAST(${source} AS DOUBLE) AS ${quoteIdentifier('__obs_cast')}`]
				: [])
		];
	});
	const rawRows = await runQuery<Record<string, unknown>>(
		database,
		`SELECT ${selections.join(', ')} FROM read_parquet(?)`,
		filePath
	);

	return rawRows.map((rawRow) => {
		const values: Partial<Record<CanonicalBatchField, unknown>> = {};
		let invalidObsValue = false;
		for (const [index, mapping] of projectedMappings.entries()) {
			const rawValue = rawRow[`__m${index}`];
			const transformed = applyTransforms(rawValue, mapping.transforms);
			if (mapping.canonicalField === 'obs_value') {
				const castValue = rawRow.__obs_cast;
				const numericValue =
					castValue === null || castValue === undefined ? null : toNumber(castValue);
				if (
					rawValue !== null &&
					rawValue !== undefined &&
					(numericValue === null || !Number.isFinite(numericValue))
				) {
					invalidObsValue = true;
				}
				values.obs_value =
					numericValue !== null && Number.isFinite(numericValue) ? numericValue : null;
			} else if (mapping.canonicalField) {
				values[mapping.canonicalField] = transformed;
			}
		}
		return { values, invalidObsValue };
	});
}

export async function loadSavedSliceContracts(
	slices: Array<{ indicatorCode: string; freq: string }>,
	db: AppDb = getDb()
): Promise<SavedSliceContract[]> {
	const contracts: SavedSliceContract[] = [];
	for (const slice of slices) {
		const indicatorRows = await db
			.select({ id: indicators.id })
			.from(indicators)
			.where(eq(indicators.code, slice.indicatorCode))
			.limit(1);
		const indicatorId = indicatorRows[0]?.id ?? null;
		if (indicatorId === null) {
			contracts.push({
				...slice,
				indicatorId,
				indicatorExists: false,
				frequencyDefined: false,
				dimensionCodes: [],
				dimensionFields: [],
				unsupportedDimensionCodes: [],
				allowedValuesByDimension: {}
			});
			continue;
		}

		const frequencyRows = await db
			.select({ id: indicatorFrequencies.id })
			.from(indicatorFrequencies)
			.where(
				and(
					eq(indicatorFrequencies.indicatorId, indicatorId),
					eq(indicatorFrequencies.freq, slice.freq)
				)
			)
			.limit(1);
		const dimensionRows = await db
			.select({ dimensionCode: indicatorDimensions.dimensionCode })
			.from(indicatorDimensions)
			.where(
				and(
					eq(indicatorDimensions.indicatorId, indicatorId),
					or(eq(indicatorDimensions.freq, slice.freq), eq(indicatorDimensions.freq, '*'))
				)
			);
		const dimensionCodes = [
			...new Set(dimensionRows.map((row) => row.dimensionCode.toUpperCase()))
		];
		const dimensionFields = dimensionCodes
			.map((code) => DIMENSION_FIELD_BY_CODE.get(code))
			.filter((field): field is CanonicalDimensionField => field !== undefined)
			.sort(
				(a, b) => CANONICAL_DIMENSION_FIELDS.indexOf(a) - CANONICAL_DIMENSION_FIELDS.indexOf(b)
			);
		const unsupportedDimensionCodes = dimensionCodes.filter(
			(code) => !DIMENSION_FIELD_BY_CODE.has(code)
		);
		const allowedValuesByDimension: Record<string, string[]> = {};
		for (const dimensionCode of dimensionCodes) {
			const values = await db
				.select({ code: dimensionValues.code })
				.from(dimensionValues)
				.where(eq(dimensionValues.dimensionCode, dimensionCode));
			allowedValuesByDimension[dimensionCode] = values.map((value) => value.code);
		}

		contracts.push({
			...slice,
			indicatorId,
			indicatorExists: true,
			frequencyDefined: frequencyRows.length > 0,
			dimensionCodes,
			dimensionFields,
			unsupportedDimensionCodes,
			allowedValuesByDimension
		});
	}
	return contracts;
}

function collapsedByField(
	collapsed: CollapsedFixedDimension[],
	sliceKey: string
): Map<CanonicalDimensionField, CollapsedFixedDimension> {
	return new Map(
		collapsed
			.filter((dimension) => dimension.sliceKey === sliceKey)
			.map((dimension) => [dimension.canonicalField, dimension])
	);
}

function projectedString(row: ProjectedRow, field: CanonicalBatchField): string | null {
	return toNullableString(row.values[field]);
}

function errorCount(diagnostics: BatchDiagnostic[]): number {
	return diagnostics.filter((item) => item.severity === 'error').length;
}

function validateAndBuildSlice(params: {
	key: string;
	rows: ProjectedRow[];
	contract: SavedSliceContract;
	mappedDimensionFields: CanonicalDimensionField[];
	collapsedDimensions: CollapsedFixedDimension[];
	hasObsStatus: boolean;
}): CanonicalizedBatchSlice {
	const { key, rows, contract } = params;
	const diagnostics: BatchDiagnostic[] = [];
	const collapsed = collapsedByField(params.collapsedDimensions, key);
	const contractFields = new Set(contract.dimensionFields);
	const mappedFields = new Set(params.mappedDimensionFields);

	if (!contract.indicatorExists) {
		diagnostics.push(
			diagnostic(
				'indicator_not_found',
				`Indicator ${contract.indicatorCode} does not exist.`,
				undefined,
				key
			)
		);
	} else if (!contract.frequencyDefined) {
		diagnostics.push(
			diagnostic(
				'indicator_frequency_not_defined',
				`Indicator frequency ${key} is not defined.`,
				undefined,
				key
			)
		);
	}
	if (contract.unsupportedDimensionCodes.length > 0) {
		diagnostics.push(
			diagnostic(
				'unsupported_registered_dimensions',
				`${key} has registered dimensions that cannot be represented in the canonical Observation schema.`,
				{ dimensionCodes: contract.unsupportedDimensionCodes },
				key
			)
		);
	}

	const missingDimensions = contract.dimensionFields.filter((field) => !mappedFields.has(field));
	if (missingDimensions.length > 0) {
		diagnostics.push(
			diagnostic(
				'missing_required_dimensions',
				`${key} is missing mapped columns for required dimensions.`,
				{ fields: missingDimensions },
				key
			)
		);
	}
	const extraDimensions = params.mappedDimensionFields.filter(
		(field) => !contractFields.has(field) && !collapsed.has(field)
	);
	if (extraDimensions.length > 0) {
		diagnostics.push(
			diagnostic(
				'extra_mapped_dimensions',
				`${key} has mapped dimensions that are neither registered nor accepted as collapsed.`,
				{ fields: extraDimensions },
				key
			)
		);
	}

	for (const [field, accepted] of collapsed) {
		if (contractFields.has(field)) {
			diagnostics.push(
				diagnostic(
					'collapsed_registered_dimension',
					`${accepted.dimensionCode} cannot be collapsed because it is registered for ${key}.`,
					{ field },
					key
				)
			);
			continue;
		}
		if (DIMENSION_CODE_BY_FIELD[field] !== accepted.dimensionCode.toUpperCase()) {
			diagnostics.push(
				diagnostic(
					'collapsed_dimension_code_mismatch',
					`Collapsed dimension code does not match canonical field ${field}.`,
					{ accepted },
					key
				)
			);
		}
		const mismatchedRows = rows.filter(
			(row) => projectedString(row, field) !== accepted.value
		).length;
		if (mismatchedRows > 0) {
			diagnostics.push(
				diagnostic(
					'collapsed_fixed_value_mismatch',
					`${mismatchedRows} row(s) do not match accepted fixed value ${accepted.dimensionCode}=${String(accepted.value)}.`,
					{ field, expectedValue: accepted.value, mismatchedRows },
					key
				)
			);
		}
	}

	const invalidRefAreaCount = rows.filter(
		(row) => projectedString(row, 'ref_area') === null
	).length;
	if (invalidRefAreaCount > 0) {
		diagnostics.push(
			diagnostic(
				'missing_ref_area',
				`${invalidRefAreaCount} row(s) have null ref_area.`,
				{ rowCount: invalidRefAreaCount },
				key
			)
		);
	}
	const invalidPeriodCount = rows.filter(
		(row) => normalizePeriod(row.values.time_period, contract.freq) === null
	).length;
	if (!SUPPORTED_FREQUENCIES.has(contract.freq)) {
		diagnostics.push(
			diagnostic(
				'unsupported_frequency',
				`Frequency ${contract.freq} is not supported for canonical periods.`,
				{ supportedFrequencies: [...SUPPORTED_FREQUENCIES] },
				key
			)
		);
	} else if (invalidPeriodCount > 0) {
		diagnostics.push(
			diagnostic(
				'invalid_time_period',
				`${invalidPeriodCount} row(s) have invalid time_period values for frequency ${contract.freq}.`,
				{ rowCount: invalidPeriodCount },
				key
			)
		);
	}
	const invalidObsValueCount = rows.filter((row) => row.invalidObsValue).length;
	if (invalidObsValueCount > 0) {
		diagnostics.push(
			diagnostic(
				'invalid_obs_value',
				`${invalidObsValueCount} non-null obs_value value(s) cannot be cast to DOUBLE.`,
				{ rowCount: invalidObsValueCount },
				key
			)
		);
	}

	for (const field of contract.dimensionFields) {
		const dimensionCode = DIMENSION_CODE_BY_FIELD[field];
		const allowedValues = contract.allowedValuesByDimension[dimensionCode] || [];
		if (allowedValues.length === 0) continue;
		const allowed = new Set(allowedValues);
		const dimensionValuesInRows = rows.map((row) => projectedString(row, field));
		const unknownValues = [
			...new Set(
				dimensionValuesInRows.filter(
					(value): value is string => value !== null && !allowed.has(value)
				)
			)
		];
		const nullValueCount = dimensionValuesInRows.filter((value) => value === null).length;
		if (unknownValues.length > 0 || nullValueCount > 0) {
			diagnostics.push(
				diagnostic(
					'dimension_value_not_allowed',
					`${key} contains values outside the populated ${dimensionCode} codelist.`,
					{ dimensionCode, values: unknownValues, nullValueCount },
					key
				)
			);
		}
	}

	const columns = [
		...CANONICAL_REQUIRED_FIELDS,
		...contract.dimensionFields,
		...(params.hasObsStatus ? OBSERVATION_OPTIONAL_FIELDS : [])
	];
	const canonicalRows = rows.map((row) => {
		const canonical: CanonicalObservationRow = {
			indicator_code: projectedString(row, 'indicator_code') || '',
			freq: projectedString(row, 'freq') || '',
			ref_area: projectedString(row, 'ref_area'),
			time_period: normalizePeriod(row.values.time_period, contract.freq),
			obs_value:
				row.values.obs_value === null || row.values.obs_value === undefined
					? null
					: toNumber(row.values.obs_value)
		};
		for (const field of contract.dimensionFields) canonical[field] = projectedString(row, field);
		if (params.hasObsStatus) canonical.obs_status = projectedString(row, 'obs_status');
		return canonical;
	});

	const duplicateKeys = new Map<string, number>();
	for (const row of canonicalRows) {
		const keyValues = [
			row.indicator_code,
			row.freq,
			row.ref_area,
			row.time_period,
			...contract.dimensionFields.map((field) => row[field] ?? null)
		];
		const serialized = JSON.stringify(keyValues);
		duplicateKeys.set(serialized, (duplicateKeys.get(serialized) || 0) + 1);
	}
	const duplicateGroups = [...duplicateKeys.values()].filter((count) => count > 1);
	if (duplicateGroups.length > 0) {
		diagnostics.push(
			diagnostic(
				'duplicate_canonical_keys',
				`${duplicateGroups.length} duplicate canonical key group(s) remain after dimension collapse.`,
				{
					duplicateKeyCount: duplicateGroups.length,
					duplicateRowCount: duplicateGroups.reduce((total, count) => total + count - 1, 0),
					nullDimensionValuesCompareEqual: true
				},
				key
			)
		);
	}

	const periods = canonicalRows
		.map((row) => row.time_period)
		.filter((period): period is string => period !== null)
		.sort();
	return {
		key,
		indicatorCode: contract.indicatorCode,
		freq: contract.freq,
		indicatorId: contract.indicatorId,
		columns,
		rows: canonicalRows,
		rowCount: canonicalRows.length,
		periodStart: periods[0] ?? null,
		periodEnd: periods.at(-1) ?? null,
		valid: errorCount(diagnostics) === 0,
		diagnostics
	};
}

export async function canonicalizeBatchParquet(
	input: CanonicalizeBatchParquetInput
): Promise<CanonicalizeBatchResult> {
	let database: DuckDbDatabase | null = null;
	try {
		database = await createInMemoryDuckDb();
		const sourceColumns = await describeSourceColumns(database, input.filePath);
		validateMappings(input.acceptedMapping, sourceColumns);
		if (input.maxRows !== undefined) {
			if (!Number.isSafeInteger(input.maxRows) || input.maxRows < 1) {
				throw new Error(`Invalid canonicalization row limit: ${String(input.maxRows)}`);
			}
			const [count] = await runQuery<{ row_count: bigint | number }>(
				database,
				'SELECT COUNT(*) AS row_count FROM read_parquet(?)',
				input.filePath
			);
			const rowCount = Number(count?.row_count || 0);
			if (rowCount > input.maxRows) {
				throw new Error(
					`Batch has ${rowCount} rows, exceeding the in-memory canonicalization limit of ${input.maxRows}.`
				);
			}
		}
		const projectedRows = await projectAcceptedRows(
			database,
			input.filePath,
			input.acceptedMapping
		);
		const diagnostics: BatchDiagnostic[] = [];
		const invalidSliceIdentityCount = projectedRows.filter(
			(row) =>
				projectedString(row, 'indicator_code') === null || projectedString(row, 'freq') === null
		).length;
		if (invalidSliceIdentityCount > 0) {
			diagnostics.push(
				diagnostic(
					'invalid_slice_identity',
					`${invalidSliceIdentityCount} row(s) have null indicator_code or freq, so no slice can be derived.`,
					{ rowCount: invalidSliceIdentityCount }
				)
			);
		}

		const rowsBySlice = new Map<string, ProjectedRow[]>();
		for (const row of projectedRows) {
			const indicatorCode = projectedString(row, 'indicator_code');
			const freq = projectedString(row, 'freq');
			if (indicatorCode === null || freq === null) continue;
			const key = `${indicatorCode}/${freq}`;
			const rows = rowsBySlice.get(key) || [];
			rows.push(row);
			rowsBySlice.set(key, rows);
		}
		const sliceIdentities = [...rowsBySlice.keys()].sort().map((key) => {
			const separator = key.lastIndexOf('/');
			return { indicatorCode: key.slice(0, separator), freq: key.slice(separator + 1) };
		});
		const loadContracts = input.contractLoader || loadSavedSliceContracts;
		const contracts = await loadContracts(sliceIdentities);
		const contractsByKey = new Map(
			contracts.map((contract) => [`${contract.indicatorCode}/${contract.freq}`, contract])
		);
		const dimensionMappings = input.acceptedMapping.mappings.filter(
			(mapping): mapping is typeof mapping & { canonicalField: CanonicalDimensionField } =>
				mapping.canonicalField !== null &&
				CANONICAL_DIMENSION_FIELDS.includes(mapping.canonicalField as CanonicalDimensionField)
		);
		const mappedDimensionFields = dimensionMappings.map((mapping) => mapping.canonicalField);
		const mappingByDimension = new Map(
			dimensionMappings.map((mapping) => [mapping.canonicalField, mapping])
		);

		for (const collapsed of input.acceptedMapping.collapsedDimensions) {
			const mapping = mappingByDimension.get(collapsed.canonicalField);
			if (!mapping || mapping.sourceColumn !== collapsed.sourceColumn) {
				diagnostics.push(
					diagnostic(
						'invalid_collapsed_dimension_mapping',
						`Collapsed dimension ${collapsed.dimensionCode} does not match an accepted source mapping.`,
						{ collapsed }
					)
				);
			}
			if (!rowsBySlice.has(collapsed.sliceKey)) {
				diagnostics.push(
					diagnostic(
						'collapsed_dimension_slice_not_found',
						`Collapsed dimension references slice ${collapsed.sliceKey}, which is not present in the file.`,
						{ collapsed }
					)
				);
			}
		}

		const slices: CanonicalizedBatchSlice[] = [];
		for (const identity of sliceIdentities) {
			const key = `${identity.indicatorCode}/${identity.freq}`;
			const contract = contractsByKey.get(key);
			if (!contract) {
				diagnostics.push(
					diagnostic(
						'saved_contract_not_loaded',
						`No saved contract result was loaded for derived slice ${key}.`,
						undefined,
						key
					)
				);
				continue;
			}
			slices.push(
				validateAndBuildSlice({
					key,
					rows: rowsBySlice.get(key) || [],
					contract,
					mappedDimensionFields,
					collapsedDimensions: input.acceptedMapping.collapsedDimensions,
					hasObsStatus: input.acceptedMapping.mappings.some(
						(mapping) => mapping.canonicalField === 'obs_status'
					)
				})
			);
		}

		const allDiagnostics = [...diagnostics, ...slices.flatMap((slice) => slice.diagnostics)];
		return {
			valid: errorCount(allDiagnostics) === 0 && slices.every((slice) => slice.valid),
			columns: [...new Set(slices.flatMap((slice) => slice.columns))],
			rowCount: projectedRows.length,
			slices,
			diagnostics: allDiagnostics
		};
	} finally {
		if (database) await closeDuckDb(database).catch(() => undefined);
	}
}
