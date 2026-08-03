import {
	BATCH_PROFILE_SCHEMA_VERSION,
	CANONICAL_DIMENSION_FIELDS,
	CANONICAL_MEASUREMENT_METADATA_FIELDS,
	CANONICAL_REQUIRED_FIELDS,
	type BatchColumnMapping,
	type BatchDiagnostic,
	type BatchDimensionSummary,
	type BatchDuplicateKeySummary,
	type BatchMappingSummary,
	type BatchMeasurementSummary,
	type BatchProfile,
	type BatchProfileColumn,
	type BatchProfileQuestion,
	type BatchSliceDimensionContractResult,
	type BatchSliceProfile,
	type BatchUniformDimensionalitySummary,
	type BatchValueSample,
	type CanonicalBatchField,
	type CanonicalDimensionField,
	type CanonicalRequiredField
} from './types';

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

interface DuckDbColumnRow {
	column_name: string;
	column_type?: string | null;
	null?: string | null;
}

interface AnalyzerColumnInput {
	name: string;
	type?: string | null;
	nullable?: boolean | null;
}

export interface BatchSliceDimensionContractInput {
	indicatorCode: string;
	freq: string;
	dimensionFields: CanonicalDimensionField[];
}

export interface AnalyzeBatchParquetInput {
	filePath: string;
	originalName?: string | null;
	sliceDimensionContracts?: BatchSliceDimensionContractInput[];
}

const canonicalFields = new Set<CanonicalBatchField>([
	...CANONICAL_REQUIRED_FIELDS,
	...CANONICAL_DIMENSION_FIELDS,
	...CANONICAL_MEASUREMENT_METADATA_FIELDS
]);

const aliasMappings = new Map<
	string,
	{ field: CanonicalBatchField; transforms?: BatchColumnMapping['transforms'] }
>([
	['INDICADOR', { field: 'indicator_code', transforms: ['trim'] }],
	['INDICATOR', { field: 'indicator_code', transforms: ['trim'] }],
	['INDICATOR_CODE', { field: 'indicator_code', transforms: ['trim'] }],
	['FREQ', { field: 'freq', transforms: ['trim', 'uppercase'] }],
	['REF_AREA', { field: 'ref_area', transforms: ['trim', 'uppercase'] }],
	['TIME_PERIOD', { field: 'time_period', transforms: ['trim', 'geih-month-year-to-iso-month'] }],
	['OBS_VALUE', { field: 'obs_value', transforms: ['numeric'] }],
	['GEO_LEVEL', { field: 'geo_level', transforms: ['trim', 'uppercase'] }],
	['DEPT_CODE', { field: 'dept_code', transforms: ['trim', 'uppercase'] }],
	['MUNI_CODE', { field: 'muni_code', transforms: ['trim', 'uppercase'] }],
	['URBAN_RURAL', { field: 'urban_rural', transforms: ['trim', 'uppercase'] }],
	['SEX', { field: 'sex', transforms: ['trim', 'uppercase'] }],
	['AGE', { field: 'age', transforms: ['trim'] }],
	['ADJUSTMENT', { field: 'adjustment', transforms: ['trim', 'uppercase'] }],
	['ADJUSTEMENT', { field: 'adjustment', transforms: ['trim', 'uppercase'] }],
	['EXT_1', { field: 'ext_1', transforms: ['trim'] }],
	['EXT_2', { field: 'ext_2', transforms: ['trim'] }],
	['EXT_3', { field: 'ext_3', transforms: ['trim'] }],
	['OBS_STATUS', { field: 'obs_status', transforms: ['trim', 'uppercase'] }],
	['UNIT', { field: 'unit', transforms: ['trim'] }],
	['UNIT_MULT', { field: 'unit_mult', transforms: ['numeric'] }],
	['DECIMALS', { field: 'decimals', transforms: ['numeric'] }],
	['SOURCE_PERIOD', { field: 'source_period', transforms: ['trim'] }]
]);

const totalLikeValues = new Set(['0', 'T', 'TOT', 'TOTAL', 'NAT', 'NACIONAL', 'CO']);

function sqlString(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdentifier(value: string): string {
	return `"${value.replace(/"/g, '""')}"`;
}

function toNumber(value: unknown): number {
	if (typeof value === 'bigint') return Number(value);
	if (typeof value === 'number') return value;
	if (typeof value === 'string') return Number(value);
	return 0;
}

function toNullableNumber(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	const parsed = toNumber(value);
	return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	return String(value);
}

function compareCanonicalFields(a: CanonicalBatchField, b: CanonicalBatchField): number {
	return a.localeCompare(b);
}

function compareDimensionFields(a: CanonicalDimensionField, b: CanonicalDimensionField): number {
	return CANONICAL_DIMENSION_FIELDS.indexOf(a) - CANONICAL_DIMENSION_FIELDS.indexOf(b);
}

function uniqueSortedDimensionFields(fields: CanonicalDimensionField[]): CanonicalDimensionField[] {
	return [...new Set(fields)].sort(compareDimensionFields);
}

function columnKey(columnName: string): string {
	return columnName.trim().toUpperCase();
}

function canonicalKey(columnName: string): string {
	return columnName.trim().toLowerCase();
}

function mappingForColumn(column: AnalyzerColumnInput): BatchColumnMapping {
	const lower = canonicalKey(column.name);
	if (canonicalFields.has(lower as CanonicalBatchField)) {
		const field = lower as CanonicalBatchField;
		return {
			sourceColumn: column.name,
			canonicalField: field,
			confidence: 'canonical',
			transforms: field === 'obs_value' ? ['numeric'] : ['identity'],
			warning: null
		};
	}

	const alias = aliasMappings.get(columnKey(column.name));
	if (alias) {
		return {
			sourceColumn: column.name,
			canonicalField: alias.field,
			confidence: 'source-alias',
			transforms: alias.transforms ?? ['trim'],
			warning:
				column.name === 'ADJUSTEMENT'
					? 'Mapped source typo ADJUSTEMENT to canonical adjustment.'
					: null
		};
	}

	return {
		sourceColumn: column.name,
		canonicalField: null,
		confidence: 'unsupported',
		transforms: [],
		warning: `Column ${column.name} is not mapped to the canonical batch contract.`
	};
}

export function proposeBatchColumnMappings(columns: AnalyzerColumnInput[]): BatchMappingSummary {
	const mappings = columns.map(mappingForColumn);
	const fields = mappings
		.map((mapping) => mapping.canonicalField)
		.filter((field): field is CanonicalBatchField => field !== null);
	const duplicateCanonicalFields = [
		...new Set(fields.filter((field, index) => fields.indexOf(field) !== index))
	].sort(compareCanonicalFields);
	const fieldSet = new Set(fields);
	const missingRequiredFields = CANONICAL_REQUIRED_FIELDS.filter(
		(field) => !fieldSet.has(field)
	) as CanonicalRequiredField[];

	return {
		mappings,
		missingRequiredFields,
		duplicateCanonicalFields,
		unmappedColumns: mappings
			.filter((mapping) => mapping.canonicalField === null)
			.map((mapping) => mapping.sourceColumn)
	};
}

function profileColumns(
	columns: AnalyzerColumnInput[],
	mappings: BatchColumnMapping[]
): BatchProfileColumn[] {
	const mappedBySource = new Map(mappings.map((mapping) => [mapping.sourceColumn, mapping]));
	return columns.map((column) => ({
		name: column.name,
		type: column.type ?? null,
		nullable: column.nullable ?? null,
		mappedField: mappedBySource.get(column.name)?.canonicalField ?? null
	}));
}

function diagnosticCounts(diagnostics: BatchDiagnostic[]): {
	errorCount: number;
	warningCount: number;
} {
	return {
		errorCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length,
		warningCount: diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length
	};
}

function mappingDiagnostics(mappings: BatchMappingSummary): BatchDiagnostic[] {
	const diagnostics: BatchDiagnostic[] = [];

	for (const mapping of mappings.mappings) {
		if (mapping.warning) {
			diagnostics.push({
				severity: mapping.confidence === 'unsupported' ? 'warning' : 'info',
				code: mapping.confidence === 'unsupported' ? 'unsupported_column' : 'source_alias_mapping',
				message: mapping.warning,
				details: { sourceColumn: mapping.sourceColumn, canonicalField: mapping.canonicalField }
			});
		}
	}

	for (const field of mappings.missingRequiredFields) {
		diagnostics.push({
			severity: 'error',
			code: 'missing_required_field',
			message: `Missing required canonical field: ${field}`,
			details: { field }
		});
	}

	for (const field of mappings.duplicateCanonicalFields) {
		diagnostics.push({
			severity: 'error',
			code: 'duplicate_canonical_field_mapping',
			message: `Multiple source columns map to canonical field ${field}`,
			details: { field }
		});
	}

	return diagnostics;
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

function runQuery<T = Record<string, unknown>>(
	database: DuckDbDatabase,
	query: string
): Promise<T[]> {
	return new Promise((resolve, reject) => {
		const stmt = database.prepare(query);
		stmt.all((error: Error | null, rows: T[]) => {
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

async function describeParquet(
	database: DuckDbDatabase,
	filePath: string
): Promise<AnalyzerColumnInput[]> {
	const rows = await runQuery<DuckDbColumnRow>(
		database,
		`DESCRIBE SELECT * FROM read_parquet(${sqlString(filePath)})`
	);
	return rows.map((row) => ({
		name: row.column_name,
		type: row.column_type ?? null,
		nullable: row.null === undefined || row.null === null ? null : row.null.toUpperCase() !== 'NO'
	}));
}

async function countParquetRows(database: DuckDbDatabase, filePath: string): Promise<number> {
	const rows = await runQuery<{ row_count: unknown }>(
		database,
		`SELECT COUNT(*) AS row_count FROM read_parquet(${sqlString(filePath)})`
	);
	return toNumber(rows[0]?.row_count);
}

function fieldMappings(
	mappings: BatchMappingSummary
): Map<CanonicalBatchField, BatchColumnMapping> {
	const byField = new Map<CanonicalBatchField, BatchColumnMapping>();
	for (const mapping of mappings.mappings) {
		if (!mapping.canonicalField || byField.has(mapping.canonicalField)) continue;
		byField.set(mapping.canonicalField, mapping);
	}
	return byField;
}

function varcharExpression(mapping: BatchColumnMapping | undefined): string {
	if (!mapping) return 'NULL';
	return `NULLIF(TRIM(CAST(${quoteIdentifier(mapping.sourceColumn)} AS VARCHAR)), '')`;
}

function numericExpression(mapping: BatchColumnMapping | undefined): string {
	if (!mapping) return 'NULL';
	return `TRY_CAST(${quoteIdentifier(mapping.sourceColumn)} AS DOUBLE)`;
}

function canonicalExpression(
	field: CanonicalBatchField,
	mappings: Map<CanonicalBatchField, BatchColumnMapping>
): string {
	const mapping = mappings.get(field);
	if (!mapping) return 'NULL';

	if (field === 'obs_value' || field === 'unit_mult' || field === 'decimals') {
		return numericExpression(mapping);
	}

	if (field === 'freq') {
		return `UPPER(${varcharExpression(mapping)})`;
	}

	if (
		field === 'ref_area' ||
		field === 'geo_level' ||
		field === 'dept_code' ||
		field === 'muni_code' ||
		field === 'urban_rural' ||
		field === 'sex' ||
		field === 'adjustment' ||
		field === 'obs_status'
	) {
		return `UPPER(${varcharExpression(mapping)})`;
	}

	return varcharExpression(mapping);
}

function timePeriodExpression(mappings: Map<CanonicalBatchField, BatchColumnMapping>): string {
	const time = varcharExpression(mappings.get('time_period'));
	const freq = canonicalExpression('freq', mappings);
	return `
		CASE
			WHEN ${time} IS NULL THEN NULL
			WHEN ${freq} = 'M' AND regexp_full_match(${time}, '^(0?[1-9]|1[0-2])-[0-9]{4}$')
				THEN regexp_extract(${time}, '^[0-9]{1,2}-([0-9]{4})$', 1) || '-' || lpad(regexp_extract(${time}, '^([0-9]{1,2})-', 1), 2, '0')
			ELSE ${time}
		END
	`;
}

function buildMappedCte(
	filePath: string,
	mappings: Map<CanonicalBatchField, BatchColumnMapping>,
	dimensions: CanonicalDimensionField[]
): string {
	const metadataFields = CANONICAL_MEASUREMENT_METADATA_FIELDS.filter((field) =>
		mappings.has(field)
	);
	const expressions = [
		`CAST(${canonicalExpression('indicator_code', mappings)} AS VARCHAR) AS indicator_code`,
		`CAST(${canonicalExpression('freq', mappings)} AS VARCHAR) AS freq`,
		`CAST(${canonicalExpression('ref_area', mappings)} AS VARCHAR) AS ref_area`,
		`CAST(${timePeriodExpression(mappings)} AS VARCHAR) AS time_period`,
		`CAST(${varcharExpression(mappings.get('time_period'))} AS VARCHAR) AS source_time_period`,
		`CAST(${canonicalExpression('obs_value', mappings)} AS DOUBLE) AS obs_value`,
		...dimensions.map(
			(field) =>
				`CAST(${canonicalExpression(field, mappings)} AS VARCHAR) AS ${quoteIdentifier(field)}`
		),
		...metadataFields.map((field) => {
			const sqlType = field === 'unit_mult' || field === 'decimals' ? 'DOUBLE' : 'VARCHAR';
			return `CAST(${canonicalExpression(field, mappings)} AS ${sqlType}) AS ${quoteIdentifier(field)}`;
		})
	];

	return `
		WITH mapped AS (
			SELECT
				${expressions.join(',\n\t\t\t\t')}
			FROM read_parquet(${sqlString(filePath)})
		)
	`;
}

function sliceWhere(slice: { indicatorCode: string; freq: string }): string {
	return `indicator_code = ${sqlString(slice.indicatorCode)} AND freq = ${sqlString(slice.freq)}`;
}

async function readValueSamples(
	database: DuckDbDatabase,
	cte: string,
	slice: { indicatorCode: string; freq: string },
	field: string,
	limit = 10
): Promise<BatchValueSample[]> {
	const rows = await runQuery<{ value: unknown; row_count: unknown }>(
		database,
		`
			${cte}
			SELECT CAST(${quoteIdentifier(field)} AS VARCHAR) AS value, COUNT(*) AS row_count
			FROM mapped
			WHERE ${sliceWhere(slice)}
			GROUP BY CAST(${quoteIdentifier(field)} AS VARCHAR)
			ORDER BY row_count DESC, value ASC
			LIMIT ${limit}
		`
	);

	return rows.map((row) => ({
		value: toNullableString(row.value),
		rowCount: toNumber(row.row_count)
	}));
}

async function readDimensionSummary(
	database: DuckDbDatabase,
	cte: string,
	slice: { indicatorCode: string; freq: string },
	field: CanonicalDimensionField,
	sourceColumn: string
): Promise<BatchDimensionSummary> {
	const rows = await runQuery<{
		row_count: unknown;
		non_null_count: unknown;
		distinct_value_count: unknown;
	}>(
		database,
		`
			${cte}
			SELECT
				COUNT(*) AS row_count,
				SUM(CASE WHEN ${quoteIdentifier(field)} IS NOT NULL THEN 1 ELSE 0 END) AS non_null_count,
				COUNT(DISTINCT ${quoteIdentifier(field)}) AS distinct_value_count
			FROM mapped
			WHERE ${sliceWhere(slice)}
		`
	);
	const values = await readValueSamples(database, cte, slice, field);
	const firstNonNullValue = values.find((sample) => sample.value !== null)?.value;
	const distinctValueCount = toNumber(rows[0]?.distinct_value_count);
	const fixedTotalCandidate =
		distinctValueCount === 1 &&
		typeof firstNonNullValue === 'string' &&
		totalLikeValues.has(firstNonNullValue.trim().toUpperCase());

	return {
		field,
		sourceColumn,
		nonNullCount: toNumber(rows[0]?.non_null_count),
		nullCount: toNumber(rows[0]?.row_count) - toNumber(rows[0]?.non_null_count),
		distinctValueCount,
		values,
		fixedTotalCandidate
	};
}

async function readDuplicateKeys(
	database: DuckDbDatabase,
	cte: string,
	slice: { indicatorCode: string; freq: string },
	dimensions: CanonicalDimensionField[]
): Promise<BatchDuplicateKeySummary> {
	const keyFields = ['ref_area', 'time_period', ...dimensions];
	const keySelect = keyFields.map((field) => quoteIdentifier(field)).join(', ');
	const duplicateCte = `
		${cte}, duplicate_keys AS (
			SELECT ${keySelect}, COUNT(*) AS duplicate_row_count
			FROM mapped
			WHERE ${sliceWhere(slice)} AND ref_area IS NOT NULL AND time_period IS NOT NULL
			GROUP BY ${keySelect}
			HAVING COUNT(*) > 1
		)
	`;
	const rows = await runQuery<{ duplicate_key_count: unknown; duplicate_row_count: unknown }>(
		database,
		`
			${duplicateCte}
			SELECT
				COUNT(*) AS duplicate_key_count,
				COALESCE(SUM(duplicate_row_count - 1), 0) AS duplicate_row_count
			FROM duplicate_keys
		`
	);
	const sampleRows = await runQuery<Record<string, unknown>>(
		database,
		`
			${duplicateCte}
			SELECT ${keySelect}
			FROM duplicate_keys
			ORDER BY duplicate_row_count DESC
			LIMIT 5
		`
	);

	return {
		duplicateKeyCount: toNumber(rows[0]?.duplicate_key_count),
		duplicateRowCount: toNumber(rows[0]?.duplicate_row_count),
		sampleKeys: sampleRows.map((row) =>
			Object.fromEntries(keyFields.map((field) => [field, toNullableString(row[field])]))
		)
	};
}

async function readSlices(
	database: DuckDbDatabase,
	cte: string,
	mappings: Map<CanonicalBatchField, BatchColumnMapping>,
	dimensions: CanonicalDimensionField[]
): Promise<BatchSliceProfile[]> {
	const rows = await runQuery<{
		indicator_code: string;
		freq: string;
		row_count: unknown;
		period_start: string | null;
		period_end: string | null;
		source_period_start: string | null;
		source_period_end: string | null;
		non_null_count: unknown;
		null_count: unknown;
		min_value: unknown;
		max_value: unknown;
		avg_value: unknown;
		distinct_value_count: unknown;
	}>(
		database,
		`
			${cte}
			SELECT
				indicator_code,
				freq,
				COUNT(*) AS row_count,
				MIN(time_period) AS period_start,
				MAX(time_period) AS period_end,
				MIN(source_time_period) AS source_period_start,
				MAX(source_time_period) AS source_period_end,
				SUM(CASE WHEN obs_value IS NOT NULL THEN 1 ELSE 0 END) AS non_null_count,
				SUM(CASE WHEN obs_value IS NULL THEN 1 ELSE 0 END) AS null_count,
				MIN(obs_value) AS min_value,
				MAX(obs_value) AS max_value,
				AVG(obs_value) AS avg_value,
				COUNT(DISTINCT obs_value) AS distinct_value_count
			FROM mapped
			WHERE indicator_code IS NOT NULL AND freq IS NOT NULL
			GROUP BY indicator_code, freq
			ORDER BY indicator_code, freq
		`
	);

	const slices: BatchSliceProfile[] = [];
	for (const row of rows) {
		const slice = { indicatorCode: row.indicator_code, freq: row.freq };
		const sliceKey = contractKey(slice);
		const sliceDimensions: BatchDimensionSummary[] = [];
		for (const field of dimensions) {
			const mapping = mappings.get(field);
			if (!mapping) continue;
			sliceDimensions.push(
				await readDimensionSummary(database, cte, slice, field, mapping.sourceColumn)
			);
		}
		const duplicateKeys = await readDuplicateKeys(database, cte, slice, dimensions);
		const diagnostics: BatchDiagnostic[] = [];
		if (duplicateKeys.duplicateKeyCount > 0) {
			diagnostics.push({
				severity: 'error',
				code: 'duplicate_observation_keys',
				message: `${duplicateKeys.duplicateKeyCount} duplicate observation key(s) found for ${sliceKey}.`,
				sliceKey,
				details: { ...duplicateKeys }
			});
		}

		const measurement: BatchMeasurementSummary = {
			rowCount: toNumber(row.row_count),
			nonNullCount: toNumber(row.non_null_count),
			nullCount: toNumber(row.null_count),
			min: toNullableNumber(row.min_value),
			max: toNullableNumber(row.max_value),
			average: toNullableNumber(row.avg_value),
			distinctValueCount: toNumber(row.distinct_value_count),
			unitValues: mappings.has('unit') ? await readValueSamples(database, cte, slice, 'unit') : [],
			unitMultValues: mappings.has('unit_mult')
				? await readValueSamples(database, cte, slice, 'unit_mult')
				: [],
			decimalValues: mappings.has('decimals')
				? await readValueSamples(database, cte, slice, 'decimals')
				: []
		};

		slices.push({
			key: sliceKey,
			indicatorCode: row.indicator_code,
			freq: row.freq,
			rowCount: toNumber(row.row_count),
			periodStart: row.period_start,
			periodEnd: row.period_end,
			sourcePeriodStart: row.source_period_start,
			sourcePeriodEnd: row.source_period_end,
			measurement,
			dimensions: sliceDimensions,
			duplicateKeys,
			diagnostics
		});
	}

	return slices;
}

function contractKey(input: { indicatorCode: string; freq: string }): string {
	return `${input.indicatorCode}/${input.freq}`;
}

export function evaluateUniformDimensionality(params: {
	slices: BatchSliceProfile[];
	flatDimensionFields: CanonicalDimensionField[];
	sliceDimensionContracts?: BatchSliceDimensionContractInput[];
}): BatchUniformDimensionalitySummary {
	const flatDimensionFields = uniqueSortedDimensionFields(params.flatDimensionFields);
	const contractsBySlice = new Map(
		(params.sliceDimensionContracts ?? []).map((contract) => [
			contractKey(contract),
			uniqueSortedDimensionFields(contract.dimensionFields)
		])
	);
	const sliceResults: BatchSliceDimensionContractResult[] = params.slices.map((slice) => {
		const observedFields = uniqueSortedDimensionFields(
			slice.dimensions.map((dimension) => dimension.field)
		);
		const providedContract = contractsBySlice.get(slice.key);
		const expectedFields = providedContract ?? observedFields;
		const expectedSet = new Set(expectedFields);
		const observedSet = new Set(observedFields);
		const missingFromFile = expectedFields.filter((field) => !observedSet.has(field));
		const extraInFile = observedFields.filter((field) => !expectedSet.has(field));

		return {
			sliceKey: slice.key,
			contractSource: providedContract ? 'provided' : 'proposed-from-file',
			expectedFields,
			observedFields,
			missingFromFile,
			extraInFile,
			fixedTotalCandidateFields: uniqueSortedDimensionFields(
				slice.dimensions
					.filter((dimension) => dimension.fixedTotalCandidate)
					.map((dimension) => dimension.field)
			),
			compatible: missingFromFile.length === 0 && extraInFile.length === 0
		};
	});
	const fixedTotalCandidateFields = uniqueSortedDimensionFields(
		sliceResults.flatMap((result) => result.fixedTotalCandidateFields)
	);

	return {
		compatible: sliceResults.every((result) => result.compatible),
		flatDimensionFields,
		fixedTotalCandidateFields,
		variableDimensionFields: flatDimensionFields.filter(
			(field) => !fixedTotalCandidateFields.includes(field)
		),
		sliceResults
	};
}

function uniformDimensionalityDiagnostics(
	uniformDimensionality: BatchUniformDimensionalitySummary
): BatchDiagnostic[] {
	return uniformDimensionality.sliceResults
		.filter((result) => !result.compatible)
		.map((result) => ({
			severity: 'error',
			code: 'dimension_contract_mismatch',
			message: `Mapped dimension columns are not compatible with ${result.sliceKey}'s dimension contract.`,
			sliceKey: result.sliceKey,
			details: {
				expectedFields: result.expectedFields,
				observedFields: result.observedFields,
				missingFromFile: result.missingFromFile,
				extraInFile: result.extraInFile
			}
		}));
}

async function readSourcePeriodDiagnostics(
	database: DuckDbDatabase,
	cte: string
): Promise<BatchDiagnostic[]> {
	const rows = await runQuery<{
		converted_count: unknown;
		invalid_monthly_count: unknown;
	}>(
		database,
		`
			${cte}
			SELECT
				SUM(CASE WHEN source_time_period IS NOT NULL AND time_period IS NOT NULL AND source_time_period <> time_period THEN 1 ELSE 0 END) AS converted_count,
				SUM(CASE WHEN freq = 'M' AND time_period IS NOT NULL AND NOT regexp_full_match(time_period, '^[0-9]{4}-(0[1-9]|1[0-2])$') THEN 1 ELSE 0 END) AS invalid_monthly_count
			FROM mapped
		`
	);
	const convertedCount = toNumber(rows[0]?.converted_count);
	const invalidMonthlyCount = toNumber(rows[0]?.invalid_monthly_count);
	const diagnostics: BatchDiagnostic[] = [];

	if (convertedCount > 0) {
		diagnostics.push({
			severity: 'info',
			code: 'source_period_converted',
			message: `${convertedCount} monthly source period value(s) were converted to YYYY-MM.`,
			details: { convertedCount }
		});
	}
	if (invalidMonthlyCount > 0) {
		diagnostics.push({
			severity: 'warning',
			code: 'non_canonical_monthly_period',
			message: `${invalidMonthlyCount} monthly row(s) have non-canonical period values after mapping.`,
			details: { invalidMonthlyCount }
		});
	}

	return diagnostics;
}

function buildAdminReviewQuestions(
	profile: Omit<BatchProfile, 'adminReviewQuestions'>
): BatchProfileQuestion[] {
	const questions: BatchProfileQuestion[] = [];
	if (profile.mappings.unmappedColumns.length > 0) {
		questions.push({
			id: 'review-unmapped-columns',
			severity: 'warning',
			message: 'Review unmapped source columns before accepting definitions or staging rows.',
			relatedFields: profile.mappings.unmappedColumns
		});
	}
	if (profile.slices.length > 0) {
		questions.push({
			id: 'review-derived-slices',
			severity: 'info',
			message:
				'Confirm the derived indicator/frequency slices before generating definition drafts.',
			relatedSliceKeys: profile.slices.map((slice) => slice.key)
		});
	}
	const fixedTotalFields = [
		...new Set(
			profile.slices.flatMap((slice) =>
				slice.dimensions
					.filter((dimension) => dimension.fixedTotalCandidate)
					.map((dimension) => dimension.field)
			)
		)
	];
	if (fixedTotalFields.length > 0) {
		questions.push({
			id: 'review-fixed-total-dimensions',
			severity: 'info',
			message:
				'Review fixed-total dimension candidates; the definition-drafts phase decides whether to collapse or keep them.',
			relatedFields: fixedTotalFields
		});
	}
	return questions;
}

function emptyProfile(
	input: AnalyzeBatchParquetInput,
	diagnostics: BatchDiagnostic[]
): BatchProfile {
	const counts = diagnosticCounts(diagnostics);
	return {
		schemaVersion: BATCH_PROFILE_SCHEMA_VERSION,
		analyzedAt: new Date().toISOString(),
		source: {
			filePath: input.filePath,
			originalName: input.originalName ?? null,
			format: 'parquet',
			rowCount: 0
		},
		columns: [],
		mappings: {
			mappings: [],
			missingRequiredFields: [...CANONICAL_REQUIRED_FIELDS],
			duplicateCanonicalFields: [],
			unmappedColumns: []
		},
		uniformDimensionality: {
			compatible: true,
			flatDimensionFields: [],
			fixedTotalCandidateFields: [],
			variableDimensionFields: [],
			sliceResults: []
		},
		slices: [],
		totals: {
			sliceCount: 0,
			rowCount: 0,
			errorCount: counts.errorCount,
			warningCount: counts.warningCount
		},
		diagnostics,
		adminReviewQuestions: []
	};
}

export async function analyzeBatchParquet(input: AnalyzeBatchParquetInput): Promise<BatchProfile> {
	let database: DuckDbDatabase | null = null;
	try {
		database = await createInMemoryDuckDb();
		const columns = await describeParquet(database, input.filePath);
		const rowCount = await countParquetRows(database, input.filePath);
		const mappings = proposeBatchColumnMappings(columns);
		const diagnostics = mappingDiagnostics(mappings);
		if (rowCount === 0) {
			diagnostics.push({
				severity: 'warning',
				code: 'empty_batch_file',
				message: 'The batch file contains no rows.'
			});
		}

		const mappedByField = fieldMappings(mappings);
		const dimensions = CANONICAL_DIMENSION_FIELDS.filter((field) => mappedByField.has(field));
		let slices: BatchSliceProfile[] = [];
		if (
			mappings.missingRequiredFields.length === 0 &&
			mappings.duplicateCanonicalFields.length === 0
		) {
			const cte = buildMappedCte(input.filePath, mappedByField, dimensions);
			slices = await readSlices(database, cte, mappedByField, dimensions);
			diagnostics.push(...(await readSourcePeriodDiagnostics(database, cte)));
			if (slices.length === 0 && rowCount > 0) {
				diagnostics.push({
					severity: 'error',
					code: 'no_slices_derived',
					message: 'No indicator_code/freq slices could be derived from the batch contents.'
				});
			}
		}

		const uniformDimensionality = evaluateUniformDimensionality({
			slices,
			flatDimensionFields: dimensions,
			sliceDimensionContracts: input.sliceDimensionContracts
		});
		const allDiagnostics = [
			...diagnostics,
			...uniformDimensionalityDiagnostics(uniformDimensionality),
			...slices.flatMap((slice) => slice.diagnostics)
		];
		const counts = diagnosticCounts(allDiagnostics);
		const baseProfile: Omit<BatchProfile, 'adminReviewQuestions'> = {
			schemaVersion: BATCH_PROFILE_SCHEMA_VERSION,
			analyzedAt: new Date().toISOString(),
			source: {
				filePath: input.filePath,
				originalName: input.originalName ?? null,
				format: 'parquet',
				rowCount
			},
			columns: profileColumns(columns, mappings.mappings),
			mappings,
			uniformDimensionality,
			slices,
			totals: {
				sliceCount: slices.length,
				rowCount,
				errorCount: counts.errorCount,
				warningCount: counts.warningCount
			},
			diagnostics: allDiagnostics
		};

		return {
			...baseProfile,
			adminReviewQuestions: buildAdminReviewQuestions(baseProfile)
		};
	} catch (error) {
		return emptyProfile(input, [
			{
				severity: 'error',
				code: 'parquet_analysis_failed',
				message: `Could not analyze Parquet batch: ${error instanceof Error ? error.message : 'unknown error'}`
			}
		]);
	} finally {
		if (database) await closeDuckDb(database).catch(() => undefined);
	}
}
