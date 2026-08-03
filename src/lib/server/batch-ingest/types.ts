export const BATCH_PROFILE_SCHEMA_VERSION = 1 as const;

export const CANONICAL_REQUIRED_FIELDS = [
	'indicator_code',
	'freq',
	'ref_area',
	'time_period',
	'obs_value'
] as const;

export const CANONICAL_DIMENSION_FIELDS = [
	'geo_level',
	'dept_code',
	'muni_code',
	'urban_rural',
	'sex',
	'age',
	'adjustment',
	'ext_1',
	'ext_2',
	'ext_3'
] as const;

export const CANONICAL_MEASUREMENT_METADATA_FIELDS = [
	'unit',
	'unit_mult',
	'decimals',
	'obs_status',
	'source_period'
] as const;

export type CanonicalRequiredField = (typeof CANONICAL_REQUIRED_FIELDS)[number];
export type CanonicalDimensionField = (typeof CANONICAL_DIMENSION_FIELDS)[number];
export type CanonicalMeasurementMetadataField =
	(typeof CANONICAL_MEASUREMENT_METADATA_FIELDS)[number];
export type CanonicalBatchField =
	| CanonicalRequiredField
	| CanonicalDimensionField
	| CanonicalMeasurementMetadataField;

export type BatchDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface BatchDiagnostic {
	severity: BatchDiagnosticSeverity;
	code: string;
	message: string;
	sliceKey?: string;
	details?: Record<string, unknown>;
}

export interface BatchProfileColumn {
	name: string;
	type: string | null;
	nullable: boolean | null;
	mappedField: CanonicalBatchField | null;
}

export type BatchMappingConfidence = 'canonical' | 'source-alias' | 'unsupported';
export type BatchMappingTransform =
	| 'identity'
	| 'trim'
	| 'uppercase'
	| 'numeric'
	| 'geih-month-year-to-iso-month';

export interface BatchColumnMapping {
	sourceColumn: string;
	canonicalField: CanonicalBatchField | null;
	confidence: BatchMappingConfidence;
	transforms: BatchMappingTransform[];
	warning: string | null;
}

export interface BatchMappingSummary {
	mappings: BatchColumnMapping[];
	missingRequiredFields: CanonicalRequiredField[];
	duplicateCanonicalFields: CanonicalBatchField[];
	unmappedColumns: string[];
}

export interface BatchValueSample {
	value: string | null;
	rowCount: number;
}

export interface BatchMeasurementSummary {
	rowCount: number;
	nonNullCount: number;
	nullCount: number;
	min: number | null;
	max: number | null;
	average: number | null;
	distinctValueCount: number;
	unitValues: BatchValueSample[];
	unitMultValues: BatchValueSample[];
	decimalValues: BatchValueSample[];
}

export interface BatchDimensionSummary {
	field: CanonicalDimensionField;
	sourceColumn: string;
	nonNullCount: number;
	nullCount: number;
	distinctValueCount: number;
	values: BatchValueSample[];
	fixedTotalCandidate: boolean;
}

export interface BatchDuplicateKeySummary {
	duplicateKeyCount: number;
	duplicateRowCount: number;
	sampleKeys: Array<Record<string, string | null>>;
}

export interface BatchSliceDimensionContractResult {
	sliceKey: string;
	contractSource: 'proposed-from-file' | 'provided';
	expectedFields: CanonicalDimensionField[];
	observedFields: CanonicalDimensionField[];
	missingFromFile: CanonicalDimensionField[];
	extraInFile: CanonicalDimensionField[];
	fixedTotalCandidateFields: CanonicalDimensionField[];
	compatible: boolean;
}

export interface BatchUniformDimensionalitySummary {
	compatible: boolean;
	flatDimensionFields: CanonicalDimensionField[];
	fixedTotalCandidateFields: CanonicalDimensionField[];
	variableDimensionFields: CanonicalDimensionField[];
	sliceResults: BatchSliceDimensionContractResult[];
}

export interface BatchSliceProfile {
	key: string;
	indicatorCode: string;
	freq: string;
	rowCount: number;
	periodStart: string | null;
	periodEnd: string | null;
	sourcePeriodStart: string | null;
	sourcePeriodEnd: string | null;
	measurement: BatchMeasurementSummary;
	dimensions: BatchDimensionSummary[];
	duplicateKeys: BatchDuplicateKeySummary;
	diagnostics: BatchDiagnostic[];
}

export interface BatchProfileQuestion {
	id: string;
	severity: 'info' | 'warning';
	message: string;
	relatedFields?: string[];
	relatedSliceKeys?: string[];
}

export interface BatchProfile {
	schemaVersion: typeof BATCH_PROFILE_SCHEMA_VERSION;
	analyzedAt: string;
	source: {
		filePath: string;
		originalName: string | null;
		format: 'parquet';
		rowCount: number;
	};
	columns: BatchProfileColumn[];
	mappings: BatchMappingSummary;
	uniformDimensionality: BatchUniformDimensionalitySummary;
	slices: BatchSliceProfile[];
	totals: {
		sliceCount: number;
		rowCount: number;
		errorCount: number;
		warningCount: number;
	};
	diagnostics: BatchDiagnostic[];
	adminReviewQuestions: BatchProfileQuestion[];
}
