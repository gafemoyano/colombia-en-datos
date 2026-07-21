import {
	saveDefinitionRows,
	type SaveDefinitionGridResult,
	type SaveDefinitionRowsInput
} from '../definition-ingest';
import type {
	BatchDiagnosticSeverity,
	BatchDimensionSummary,
	BatchProfile,
	BatchSliceProfile,
	BatchValueSample,
	CanonicalDimensionField
} from './types';

export const DEFINITION_DRAFT_SCHEMA_VERSION = 1 as const;

export const DEFINITION_DRAFT_HEADERS = [
	'indicator_code',
	'freq',
	'name',
	'dimensions',
	'group_code',
	'group_name',
	'short_name',
	'description',
	'methodology',
	'source_citation',
	'unit',
	'unit_mult',
	'decimals',
	'default_viz',
	'updated'
] as const;

export type DefinitionDraftHeader = (typeof DEFINITION_DRAFT_HEADERS)[number];

const MEASUREMENT_METADATA_FIELDS = ['unit', 'unit_mult', 'decimals'] as const;
export type MeasurementMetadataField = (typeof MEASUREMENT_METADATA_FIELDS)[number];

export interface DefinitionDraftValueCount {
	value: string | null;
	rowCount: number;
}

export interface DefinitionDraftCollapsedDimension {
	field: CanonicalDimensionField;
	dimensionCode: string;
	sourceColumn: string;
	value: string;
	rowCount: number;
	nullCount: number;
	sampledValues: DefinitionDraftValueCount[];
	reason: 'fixed-total-candidate';
}

export interface DefinitionDraftRetainedDimension {
	field: CanonicalDimensionField;
	dimensionCode: string;
	sourceColumn: string;
	distinctValueCount: number;
	sampledValues: DefinitionDraftValueCount[];
}

export interface DefinitionDraftProvenance {
	sourceFilePath: string;
	originalName: string | null;
	analyzedAt: string;
	sliceKey: string;
	sourceIndicatorCode: string;
	sourceFreq: string;
	rowCount: number;
	periodStart: string | null;
	periodEnd: string | null;
	sourcePeriodStart: string | null;
	sourcePeriodEnd: string | null;
	collapsedDimensions: DefinitionDraftCollapsedDimension[];
	retainedDimensions: DefinitionDraftRetainedDimension[];
}

export interface DefinitionDraftError {
	field: DefinitionDraftHeader | 'profile' | 'slice' | 'measurement' | 'dimensions';
	message: string;
	sliceKey?: string;
	severity: 'error';
	details?: Record<string, unknown>;
}

export interface DefinitionDraftAdminReviewNote {
	id: string;
	severity: BatchDiagnosticSeverity;
	message: string;
	sliceKey?: string;
	relatedFields?: string[];
	details?: Record<string, unknown>;
}

export interface DefinitionDraftRow {
	id: string;
	rowNumber: number;
	values: Record<DefinitionDraftHeader, string>;
	adminRequiredFields: DefinitionDraftHeader[];
	provenance: DefinitionDraftProvenance;
	adminReviewNotes: DefinitionDraftAdminReviewNote[];
	errors: DefinitionDraftError[];
}

export interface GenerateDefinitionDraftsInput {
	profile: BatchProfile;
	defaults?: Partial<Record<DefinitionDraftHeader, string>>;
}

export interface GenerateDefinitionDraftsResult {
	schemaVersion: typeof DEFINITION_DRAFT_SCHEMA_VERSION;
	generatedAt: string;
	profile: {
		schemaVersion: BatchProfile['schemaVersion'];
		analyzedAt: string;
		sourceFilePath: string;
		originalName: string | null;
		sliceCount: number;
		rowCount: number;
	};
	drafts: DefinitionDraftRow[];
	errors: DefinitionDraftError[];
	adminReviewNotes: DefinitionDraftAdminReviewNote[];
}

export interface SaveAcceptedDefinitionDraftRowsInput {
	dataSource: SaveDefinitionRowsInput['dataSource'];
	drafts: DefinitionDraftRow[];
	acceptedDraftIds?: string[];
}

export interface SaveAcceptedDefinitionDraftRowsResult extends SaveDefinitionGridResult {
	acceptedDraftIds: string[];
}

const FIXED_TOTAL_DEFAULT_VALUES = new Set(['NAT', '00', '0000', 'T', 'TOTAL', 'NSA']);

const CANONICAL_DIMENSION_TO_DEFINITION_CODE: Record<CanonicalDimensionField, string> = {
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

function blankDraftValues(defaults: GenerateDefinitionDraftsInput['defaults'] = {}) {
	return Object.fromEntries(
		DEFINITION_DRAFT_HEADERS.map((header) => [header, defaults[header]?.trim() || ''])
	) as Record<DefinitionDraftHeader, string>;
}

function normalizeSampleValue(value: string | null): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function normalizeIntegerMetadataValue(value: string): string | null {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
	return String(parsed);
}

function normalizeMeasurementValue(
	field: MeasurementMetadataField,
	value: string
): { value: string | null; invalid: boolean } {
	const trimmed = value.trim();
	if (!trimmed) return { value: null, invalid: false };
	if (field === 'unit') return { value: trimmed, invalid: false };

	const normalized = normalizeIntegerMetadataValue(trimmed);
	return { value: normalized, invalid: normalized === null };
}

function samplesForField(
	slice: BatchSliceProfile,
	field: MeasurementMetadataField
): BatchValueSample[] {
	if (field === 'unit') return slice.measurement.unitValues;
	if (field === 'unit_mult') return slice.measurement.unitMultValues;
	return slice.measurement.decimalValues;
}

function valueCounts(samples: BatchValueSample[]): DefinitionDraftValueCount[] {
	return samples.map((sample) => ({ value: sample.value, rowCount: sample.rowCount }));
}

interface SliceMeasurementResolution {
	values: Record<MeasurementMetadataField, string | null>;
	errors: Record<MeasurementMetadataField, DefinitionDraftError[]>;
	warnings: Record<MeasurementMetadataField, DefinitionDraftAdminReviewNote[]>;
}

function createEmptyMeasurementResolution(): SliceMeasurementResolution {
	return {
		values: { unit: null, unit_mult: null, decimals: null },
		errors: { unit: [], unit_mult: [], decimals: [] },
		warnings: { unit: [], unit_mult: [], decimals: [] }
	};
}

function resolveSliceMeasurementField(
	slice: BatchSliceProfile,
	field: MeasurementMetadataField
): {
	value: string | null;
	errors: DefinitionDraftError[];
	warnings: DefinitionDraftAdminReviewNote[];
} {
	const samples = samplesForField(slice, field);
	const normalizedValues = new Set<string>();
	const invalidValues = new Set<string>();
	let nullRowCount = 0;

	for (const sample of samples) {
		const normalizedSample = normalizeSampleValue(sample.value);
		if (normalizedSample === null) {
			nullRowCount += sample.rowCount;
			continue;
		}

		const normalized = normalizeMeasurementValue(field, normalizedSample);
		if (normalized.invalid || normalized.value === null) {
			invalidValues.add(normalizedSample);
			continue;
		}
		normalizedValues.add(normalized.value);
	}

	const errors: DefinitionDraftError[] = [];
	const warnings: DefinitionDraftAdminReviewNote[] = [];
	if (invalidValues.size > 0) {
		errors.push({
			field,
			message: `Invalid ${field} value(s) for ${slice.key}; expected integer metadata.`,
			sliceKey: slice.key,
			severity: 'error',
			details: { invalidValues: Array.from(invalidValues), sampledValues: valueCounts(samples) }
		});
	}
	if (normalizedValues.size > 1) {
		errors.push({
			field,
			message: `Mixed ${field} values found for ${slice.key}; edit the draft before saving.`,
			sliceKey: slice.key,
			severity: 'error',
			details: { values: Array.from(normalizedValues), sampledValues: valueCounts(samples) }
		});
	}
	if (normalizedValues.size === 1 && nullRowCount > 0) {
		warnings.push({
			id: `partial-${field}-${slice.key}`,
			severity: 'warning',
			message: `${field} has one stable non-null value for ${slice.key}, but ${nullRowCount} row(s) are blank.`,
			sliceKey: slice.key,
			relatedFields: [field],
			details: { sampledValues: valueCounts(samples) }
		});
	}
	if (samples.length === 0 || (normalizedValues.size === 0 && invalidValues.size === 0)) {
		warnings.push({
			id: `missing-${field}-${slice.key}`,
			severity: 'info',
			message: `${field} was not available from analyzer measurement metadata for ${slice.key}.`,
			sliceKey: slice.key,
			relatedFields: [field]
		});
	}

	return {
		value:
			errors.length === 0 && normalizedValues.size === 1 ? Array.from(normalizedValues)[0] : null,
		errors,
		warnings
	};
}

function resolveSliceMeasurements(profile: BatchProfile): Map<string, SliceMeasurementResolution> {
	const resolutions = new Map<string, SliceMeasurementResolution>();
	for (const slice of profile.slices) {
		const resolution = createEmptyMeasurementResolution();
		for (const field of MEASUREMENT_METADATA_FIELDS) {
			const fieldResolution = resolveSliceMeasurementField(slice, field);
			resolution.values[field] = fieldResolution.value;
			resolution.errors[field] = fieldResolution.errors;
			resolution.warnings[field] = fieldResolution.warnings;
		}
		resolutions.set(slice.key, resolution);
	}
	return resolutions;
}

function enforceIndicatorMeasurementConsistency(
	profile: BatchProfile,
	resolutions: Map<string, SliceMeasurementResolution>
): void {
	for (const field of MEASUREMENT_METADATA_FIELDS) {
		const valuesByIndicator = new Map<string, Set<string>>();
		for (const slice of profile.slices) {
			const value = resolutions.get(slice.key)?.values[field];
			if (!value) continue;
			const values = valuesByIndicator.get(slice.indicatorCode) || new Set<string>();
			values.add(value);
			valuesByIndicator.set(slice.indicatorCode, values);
		}

		for (const [indicatorCode, values] of valuesByIndicator) {
			if (values.size <= 1) continue;
			for (const slice of profile.slices.filter(
				(candidate) => candidate.indicatorCode === indicatorCode
			)) {
				const resolution = resolutions.get(slice.key);
				if (!resolution) continue;
				resolution.values[field] = null;
				resolution.errors[field].push({
					field,
					message: `Mixed ${field} values found across frequencies for indicator ${indicatorCode}; edit drafts before saving.`,
					sliceKey: slice.key,
					severity: 'error',
					details: { values: Array.from(values) }
				});
			}
		}
	}
}

export function canonicalDimensionFieldToDefinitionCode(field: CanonicalDimensionField): string {
	return CANONICAL_DIMENSION_TO_DEFINITION_CODE[field];
}

function singleNonNullDimensionValue(dimension: BatchDimensionSummary): string | null {
	const values = dimension.values
		.map((sample) => normalizeSampleValue(sample.value))
		.filter((value): value is string => value !== null);
	const uniqueValues = Array.from(new Set(values));
	return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

function dimensionToCollapsedAudit(
	dimension: BatchDimensionSummary
): DefinitionDraftCollapsedDimension | null {
	const value = singleNonNullDimensionValue(dimension);
	if (
		!dimension.fixedTotalCandidate ||
		value === null ||
		!FIXED_TOTAL_DEFAULT_VALUES.has(value.toUpperCase())
	) {
		return null;
	}
	return {
		field: dimension.field,
		dimensionCode: canonicalDimensionFieldToDefinitionCode(dimension.field),
		sourceColumn: dimension.sourceColumn,
		value,
		rowCount: dimension.nonNullCount,
		nullCount: dimension.nullCount,
		sampledValues: valueCounts(dimension.values),
		reason: 'fixed-total-candidate'
	};
}

function dimensionToRetainedAudit(
	dimension: BatchDimensionSummary
): DefinitionDraftRetainedDimension {
	return {
		field: dimension.field,
		dimensionCode: canonicalDimensionFieldToDefinitionCode(dimension.field),
		sourceColumn: dimension.sourceColumn,
		distinctValueCount: dimension.distinctValueCount,
		sampledValues: valueCounts(dimension.values)
	};
}

function notesFromProfile(profile: BatchProfile): DefinitionDraftAdminReviewNote[] {
	return [
		...profile.adminReviewQuestions.map((question) => ({
			id: question.id,
			severity: question.severity,
			message: question.message,
			relatedFields: question.relatedFields,
			details: question.relatedSliceKeys
				? { relatedSliceKeys: question.relatedSliceKeys }
				: undefined
		})),
		...profile.diagnostics.map((diagnostic) => ({
			id: diagnostic.code,
			severity: diagnostic.severity,
			message: diagnostic.message,
			sliceKey: diagnostic.sliceKey,
			details: diagnostic.details
		}))
	];
}

function notesForSlice(
	slice: BatchSliceProfile,
	collapsedDimensions: DefinitionDraftCollapsedDimension[]
): DefinitionDraftAdminReviewNote[] {
	return [
		...slice.diagnostics.map((diagnostic) => ({
			id: diagnostic.code,
			severity: diagnostic.severity,
			message: diagnostic.message,
			sliceKey: diagnostic.sliceKey || slice.key,
			details: diagnostic.details
		})),
		...collapsedDimensions.map((dimension) => ({
			id: `collapsed-fixed-total-${slice.key}-${dimension.dimensionCode}`,
			severity: 'info' as const,
			message: `${dimension.dimensionCode}=${dimension.value} is fixed at a total/default value for ${slice.key}; the draft proposes no dimension for this field and keeps the value for audit.`,
			sliceKey: slice.key,
			relatedFields: ['dimensions', dimension.dimensionCode],
			details: { dimension }
		}))
	];
}

function errorsFromDiagnostics(profile: BatchProfile): DefinitionDraftError[] {
	return profile.diagnostics
		.filter((diagnostic) => diagnostic.severity === 'error')
		.map((diagnostic) => ({
			field: 'profile',
			message: diagnostic.message,
			sliceKey: diagnostic.sliceKey,
			severity: 'error',
			details: diagnostic.details
		}));
}

function buildDraftRow(params: {
	profile: BatchProfile;
	slice: BatchSliceProfile;
	rowNumber: number;
	defaults?: GenerateDefinitionDraftsInput['defaults'];
	measurementResolution: SliceMeasurementResolution;
}): DefinitionDraftRow {
	const values = blankDraftValues(params.defaults);
	const collapsedDimensions = params.slice.dimensions
		.map(dimensionToCollapsedAudit)
		.filter((dimension): dimension is DefinitionDraftCollapsedDimension => dimension !== null);
	const collapsedFields = new Set(collapsedDimensions.map((dimension) => dimension.field));
	const retainedDimensions = params.slice.dimensions
		.filter((dimension) => !collapsedFields.has(dimension.field))
		.map(dimensionToRetainedAudit);

	values.indicator_code = params.slice.indicatorCode;
	values.freq = params.slice.freq.toUpperCase();
	values.dimensions = retainedDimensions.map((dimension) => dimension.dimensionCode).join(',');
	values.unit = params.measurementResolution.values.unit || values.unit;
	values.unit_mult = params.measurementResolution.values.unit_mult || values.unit_mult;
	values.decimals = params.measurementResolution.values.decimals || values.decimals;

	return {
		id: params.slice.key,
		rowNumber: params.rowNumber,
		values,
		adminRequiredFields: values.name ? [] : ['name'],
		provenance: {
			sourceFilePath: params.profile.source.filePath,
			originalName: params.profile.source.originalName,
			analyzedAt: params.profile.analyzedAt,
			sliceKey: params.slice.key,
			sourceIndicatorCode: params.slice.indicatorCode,
			sourceFreq: params.slice.freq,
			rowCount: params.slice.rowCount,
			periodStart: params.slice.periodStart,
			periodEnd: params.slice.periodEnd,
			sourcePeriodStart: params.slice.sourcePeriodStart,
			sourcePeriodEnd: params.slice.sourcePeriodEnd,
			collapsedDimensions,
			retainedDimensions
		},
		adminReviewNotes: [
			...notesForSlice(params.slice, collapsedDimensions),
			...params.measurementResolution.warnings.unit,
			...params.measurementResolution.warnings.unit_mult,
			...params.measurementResolution.warnings.decimals
		],
		errors: [
			...params.measurementResolution.errors.unit,
			...params.measurementResolution.errors.unit_mult,
			...params.measurementResolution.errors.decimals
		]
	};
}

function escapeDefinitionCell(value: string): string {
	return value.replace(/\r?\n/g, ' ').trim();
}

export function definitionDraftRowsToDefinitionText(rows: DefinitionDraftRow[]): string {
	return [
		DEFINITION_DRAFT_HEADERS.join('\t'),
		...rows.map((row) =>
			DEFINITION_DRAFT_HEADERS.map((header) => escapeDefinitionCell(row.values[header])).join('\t')
		)
	].join('\n');
}

export function generateDefinitionDrafts(
	input: GenerateDefinitionDraftsInput
): GenerateDefinitionDraftsResult {
	const measurementResolutions = resolveSliceMeasurements(input.profile);
	enforceIndicatorMeasurementConsistency(input.profile, measurementResolutions);

	const drafts = input.profile.slices.map((slice, index) =>
		buildDraftRow({
			profile: input.profile,
			slice,
			rowNumber: index + 2,
			defaults: input.defaults,
			measurementResolution:
				measurementResolutions.get(slice.key) || createEmptyMeasurementResolution()
		})
	);
	const profileNotes = notesFromProfile(input.profile);
	const errors = [
		...errorsFromDiagnostics(input.profile),
		...drafts.flatMap((draft) => draft.errors)
	];

	return {
		schemaVersion: DEFINITION_DRAFT_SCHEMA_VERSION,
		generatedAt: new Date().toISOString(),
		profile: {
			schemaVersion: input.profile.schemaVersion,
			analyzedAt: input.profile.analyzedAt,
			sourceFilePath: input.profile.source.filePath,
			originalName: input.profile.source.originalName,
			sliceCount: input.profile.totals.sliceCount,
			rowCount: input.profile.totals.rowCount
		},
		drafts,
		errors,
		adminReviewNotes: profileNotes
	};
}

function draftValuesForSave(row: DefinitionDraftRow): Record<string, string> {
	return Object.fromEntries(DEFINITION_DRAFT_HEADERS.map((header) => [header, row.values[header]]));
}

export async function saveAcceptedDefinitionDraftRows(
	input: SaveAcceptedDefinitionDraftRowsInput,
	db?: Parameters<typeof saveDefinitionRows>[1]
): Promise<SaveAcceptedDefinitionDraftRowsResult> {
	const acceptedDraftIds = input.acceptedDraftIds || input.drafts.map((draft) => draft.id);
	const acceptedIdSet = new Set(acceptedDraftIds);
	const acceptedDrafts = input.drafts.filter((draft) => acceptedIdSet.has(draft.id));
	const result = await saveDefinitionRows(
		{
			dataSource: input.dataSource,
			rows: acceptedDrafts.map((draft) => ({
				rowNumber: draft.rowNumber,
				values: draftValuesForSave(draft)
			})),
			headers: [...DEFINITION_DRAFT_HEADERS]
		},
		db
	);

	return {
		...result,
		acceptedDraftIds
	};
}
