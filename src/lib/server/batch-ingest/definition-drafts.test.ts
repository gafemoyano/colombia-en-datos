import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import {
	dimensionDefinitions,
	indicatorDimensions,
	indicatorFrequencies,
	indicators
} from '$lib/db/schema';
import {
	generateDefinitionDrafts,
	saveAcceptedDefinitionDraftRows,
	type DefinitionDraftRow
} from './definition-drafts';
import type {
	BatchDimensionSummary,
	BatchProfile,
	BatchSliceProfile,
	BatchValueSample,
	CanonicalDimensionField
} from './types';

async function createTestDb() {
	const directory = await mkdtemp(join(tmpdir(), 'ced-definition-drafts-'));
	const client = createClient({ url: `file:${join(directory, 'db.sqlite')}` });
	await client.batch([
		`CREATE TABLE data_sources (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			code text(50) NOT NULL UNIQUE,
			name text(255) NOT NULL,
			description text,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE TABLE indicator_groups (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			data_source_id integer NOT NULL,
			code text(255) NOT NULL,
			name text(255) NOT NULL,
			description text,
			source_type text(50),
			filter_whitelist text,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE UNIQUE INDEX indicator_groups_data_source_code_unique ON indicator_groups (data_source_id, code)`,
		`CREATE TABLE indicators (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_group_id integer NOT NULL,
			code text(100) NOT NULL UNIQUE,
			name text(255) NOT NULL,
			short_name text(255),
			description text,
			methodology text,
			frequency text(1),
			source_citation text(255),
			unit text(100),
			unit_mult integer,
			decimals integer,
			default_viz text(50),
			updated text(50),
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE TABLE dimension_definitions (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			code text(100) NOT NULL UNIQUE,
			name text(255) NOT NULL,
			sort_order integer,
			is_standard integer DEFAULT true,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE TABLE indicator_frequencies (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_id integer NOT NULL,
			freq text(1) NOT NULL,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE UNIQUE INDEX indicator_frequencies_unique ON indicator_frequencies (indicator_id, freq)`,
		`CREATE TABLE indicator_dimensions (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_id integer NOT NULL,
			freq text(1) DEFAULT '*' NOT NULL,
			dimension_code text(100) NOT NULL,
			default_value text(100),
			is_filterable integer DEFAULT true,
			is_splitable integer DEFAULT true
		)`,
		`CREATE UNIQUE INDEX indicator_dimensions_unique ON indicator_dimensions (indicator_id, freq, dimension_code)`
	]);
	return drizzle(client, { schema });
}

function samples(values: Array<[string | null, number]>): BatchValueSample[] {
	return values.map(([value, rowCount]) => ({ value, rowCount }));
}

function dimension(params: {
	field: CanonicalDimensionField;
	sourceColumn?: string;
	values: BatchValueSample[];
	fixedTotalCandidate?: boolean;
}): BatchDimensionSummary {
	const nonNullValues = params.values.filter((sample) => sample.value !== null);
	return {
		field: params.field,
		sourceColumn: params.sourceColumn || params.field.toUpperCase(),
		nonNullCount: nonNullValues.reduce((total, sample) => total + sample.rowCount, 0),
		nullCount: params.values
			.filter((sample) => sample.value === null)
			.reduce((total, sample) => total + sample.rowCount, 0),
		distinctValueCount: new Set(nonNullValues.map((sample) => sample.value)).size,
		values: params.values,
		fixedTotalCandidate: params.fixedTotalCandidate ?? false
	};
}

function slice(params: {
	indicatorCode: string;
	freq?: string;
	unitValues?: BatchValueSample[];
	unitMultValues?: BatchValueSample[];
	decimalValues?: BatchValueSample[];
	dimensions?: BatchDimensionSummary[];
}): BatchSliceProfile {
	const freq = params.freq || 'M';
	const rowCount = params.unitValues?.reduce((total, sample) => total + sample.rowCount, 0) || 2;
	return {
		key: `${params.indicatorCode}/${freq}`,
		indicatorCode: params.indicatorCode,
		freq,
		rowCount,
		periodStart: '2024-01',
		periodEnd: '2024-02',
		sourcePeriodStart: '1-2024',
		sourcePeriodEnd: '2-2024',
		measurement: {
			rowCount,
			nonNullCount: rowCount,
			nullCount: 0,
			min: null,
			max: null,
			average: null,
			distinctValueCount: 2,
			unitValues: params.unitValues || samples([['%', rowCount]]),
			unitMultValues: params.unitMultValues || samples([['0', rowCount]]),
			decimalValues: params.decimalValues || samples([['1', rowCount]])
		},
		dimensions: params.dimensions || [],
		duplicateKeys: { duplicateKeyCount: 0, duplicateRowCount: 0, sampleKeys: [] },
		diagnostics: []
	};
}

function profile(slices: BatchSliceProfile[]): BatchProfile {
	return {
		schemaVersion: 1,
		analyzedAt: '2026-07-03T00:00:00.000Z',
		source: {
			filePath: '/tmp/geih-like.parquet',
			originalName: 'geih-like.parquet',
			format: 'parquet',
			rowCount: slices.reduce((total, profileSlice) => total + profileSlice.rowCount, 0)
		},
		columns: [],
		mappings: {
			mappings: [],
			missingRequiredFields: [],
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
		slices,
		totals: {
			sliceCount: slices.length,
			rowCount: slices.reduce((total, profileSlice) => total + profileSlice.rowCount, 0),
			errorCount: 0,
			warningCount: 0
		},
		diagnostics: [],
		adminReviewQuestions: []
	};
}

describe('definition draft generation', () => {
	it('generates one editable monthly definition draft per derived indicator', () => {
		const result = generateDefinitionDrafts({
			profile: profile([
				slice({ indicatorCode: 'TD', unitValues: samples([['%', 2]]) }),
				slice({
					indicatorCode: 'OCU',
					unitValues: samples([['persons', 2]]),
					unitMultValues: samples([['3', 2]]),
					decimalValues: samples([['0', 2]])
				})
			])
		});

		expect(result.errors).toEqual([]);
		expect(result.drafts.map((draft) => draft.id)).toEqual(['TD/M', 'OCU/M']);
		expect(result.drafts.map((draft) => draft.values)).toMatchObject([
			{ indicator_code: 'TD', freq: 'M', unit: '%', unit_mult: '0', decimals: '1' },
			{ indicator_code: 'OCU', freq: 'M', unit: 'persons', unit_mult: '3', decimals: '0' }
		]);
		expect(result.drafts.every((draft) => draft.adminRequiredFields.includes('name'))).toBe(true);
	});

	it('collapses fixed-total dimensions while retaining audit provenance', () => {
		const result = generateDefinitionDrafts({
			profile: profile([
				slice({
					indicatorCode: 'TD',
					dimensions: [
						dimension({
							field: 'geo_level',
							values: samples([['NAT', 2]]),
							fixedTotalCandidate: true
						}),
						dimension({ field: 'sex', values: samples([['T', 2]]), fixedTotalCandidate: true })
					]
				})
			])
		});

		const [draft] = result.drafts;
		expect(draft.values.dimensions).toBe('');
		expect(draft.provenance.collapsedDimensions).toMatchObject([
			{ field: 'geo_level', dimensionCode: 'GEO_LEVEL', value: 'NAT' },
			{ field: 'sex', dimensionCode: 'SEX', value: 'T' }
		]);
		expect(draft.adminReviewNotes.map((note) => note.id)).toEqual([
			'collapsed-fixed-total-TD/M-GEO_LEVEL',
			'collapsed-fixed-total-TD/M-SEX'
		]);
	});

	it('reports mixed measurement metadata as draft errors', () => {
		const result = generateDefinitionDrafts({
			profile: profile([
				slice({
					indicatorCode: 'TD',
					unitValues: samples([
						['%', 1],
						['persons', 1]
					])
				})
			])
		});

		expect(result.drafts[0].values.unit).toBe('');
		expect(result.errors).toEqual([
			expect.objectContaining({
				field: 'unit',
				message: 'Mixed unit values found for TD/M; edit the draft before saving.',
				sliceKey: 'TD/M'
			})
		]);
	});
});

describe('saveAcceptedDefinitionDraftRows', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
		await db.insert(dimensionDefinitions).values([
			{ code: 'SEX', name: 'Sexo' },
			{ code: 'GEO_LEVEL', name: 'Nivel geografico' }
		]);
	});

	it('saves accepted draft rows through the definition save primitive', async () => {
		const draftResult = generateDefinitionDrafts({
			profile: profile([
				slice({
					indicatorCode: 'TD',
					dimensions: [
						dimension({
							field: 'geo_level',
							values: samples([['NAT', 2]]),
							fixedTotalCandidate: true
						})
					]
				})
			])
		});
		draftResult.drafts[0].values.name = 'Tasa de desempleo';

		const result = await saveAcceptedDefinitionDraftRows(
			{
				dataSource: { code: 'Gran Encuesta Integrada de Hogares', name: 'GEIH' },
				drafts: draftResult.drafts
			},
			db
		);

		expect(result.ok).toBe(true);
		expect(result.acceptedDraftIds).toEqual(['TD/M']);
		expect(result.saved).toEqual({
			dataSourceCode: 'gran_encuesta_integrada_de_hogares',
			indicatorCount: 1,
			frequencyCount: 1
		});

		const [indicator] = await db.select().from(indicators);
		expect(indicator).toMatchObject({
			code: 'TD',
			name: 'Tasa de desempleo',
			frequency: 'M',
			unit: '%',
			unitMult: 0,
			decimals: 1
		});
		expect(await db.select().from(indicatorFrequencies)).toEqual([
			expect.objectContaining({ indicatorId: indicator.id, freq: 'M' })
		]);
		expect(await db.select().from(indicatorDimensions)).toEqual([]);
	});

	it('keeps definition saves all-or-nothing when accepted draft rows are invalid', async () => {
		const draftResult = generateDefinitionDrafts({
			profile: profile([slice({ indicatorCode: 'TD' }), slice({ indicatorCode: 'OCU' })])
		});
		const drafts: DefinitionDraftRow[] = draftResult.drafts.map((draft) => ({
			...draft,
			values: { ...draft.values, name: draft.id === 'TD/M' ? 'Tasa de desempleo' : 'Ocupados' }
		}));
		drafts[1].values.dimensions = 'UNKNOWN';

		const result = await saveAcceptedDefinitionDraftRows(
			{
				dataSource: { code: 'GEIH', name: 'GEIH' },
				drafts
			},
			db
		);

		expect(result.ok).toBe(false);
		expect(result.validation.errors).toEqual([
			{
				rowNumber: 3,
				field: 'dimensions',
				message: 'Unknown Observation dimension code: UNKNOWN'
			}
		]);
		expect(await db.select().from(indicators)).toEqual([]);
	});
});
