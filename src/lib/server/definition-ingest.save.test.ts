import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import {
	dataSources,
	dimensionDefinitions,
	indicatorDataSources,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { listAdminDefinitionFrequencies } from './admin-definition-catalog';
import { saveDefinitionGrid } from './definition-ingest';

async function createTestDb() {
	const directory = await mkdtemp(join(tmpdir(), 'ced-definition-ingest-'));
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
		`CREATE UNIQUE INDEX indicator_dimensions_unique ON indicator_dimensions (indicator_id, freq, dimension_code)`,
		`CREATE TABLE indicator_data_sources (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_id integer NOT NULL,
			ref_area text(50) NOT NULL,
			freq text(1) NOT NULL,
			year_min integer,
			year_max integer,
			row_count integer,
			release_id integer
		)`,
		`CREATE UNIQUE INDEX indicator_data_sources_unique ON indicator_data_sources (indicator_id, ref_area, freq)`
	]);
	return drizzle(client, { schema });
}

describe('saveDefinitionGrid', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
		await db.insert(dimensionDefinitions).values([
			{ code: 'SEX', name: 'Sexo' },
			{ code: 'AGE', name: 'Edad' }
		]);
	});

	it('saves new dimensionless definitions transactionally with normalized Data source and default group', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Gran Encuesta Integrada de Hogares', name: 'GEIH' },
				definitionText: 'indicator_code\tfreq\tname\tdimensions\nEmp_Code\tM\tEmpleo\t'
			},
			db
		);

		expect(result.ok).toBe(true);
		expect(result.saved).toEqual({
			dataSourceCode: 'gran_encuesta_integrada_de_hogares',
			indicatorCount: 1,
			frequencyCount: 1
		});

		const [dataSource] = await db.select().from(dataSources);
		expect(dataSource).toMatchObject({ code: 'gran_encuesta_integrada_de_hogares', name: 'GEIH' });

		const [group] = await db.select().from(indicatorGroups);
		expect(group).toMatchObject({
			dataSourceId: dataSource.id,
			code: 'gran_encuesta_integrada_de_hogares',
			name: 'GEIH'
		});

		const [indicator] = await db.select().from(indicators);
		expect(indicator).toMatchObject({
			indicatorGroupId: group.id,
			code: 'Emp_Code',
			name: 'Empleo',
			frequency: 'M'
		});

		const [frequency] = await db.select().from(indicatorFrequencies);
		expect(frequency).toMatchObject({ indicatorId: indicator.id, freq: 'M' });
		expect(indicator.description).toBeNull();
		expect(indicator.methodology).toBeNull();
		expect(await db.select().from(indicatorDimensions)).toEqual([]);
	});

	it('saves optional group, annotation, measurement fields, and multiple frequencies for one Indicator', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'SME Survey', name: 'SME Survey' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\tgroup_code\tgroup_name\tshort_name\tdescription\tmethodology\tsource_citation\tunit\tunit_mult\tdecimals\tdefault_viz\tupdated\nSME_OWNSTAT\tA\tOwnership status\t\tA1.10_SME_OWNSTAT\tOwnership sheet\tOwn stat\tOwnership description\tSurvey method\tDANE SME\tBusinesses\t0\t2\tbar\t2026-01\nSME_OWNSTAT\tM\tOwnership status\t\tA1.10_SME_OWNSTAT\tOwnership sheet\tOwn stat\tOwnership description\tSurvey method\tDANE SME\tBusinesses\t0\t2\tbar\t2026-01'
			},
			db
		);

		expect(result.ok).toBe(true);
		expect(result.saved).toMatchObject({ indicatorCount: 1, frequencyCount: 2 });

		const [group] = await db.select().from(indicatorGroups);
		expect(group).toMatchObject({ code: 'A1.10_SME_OWNSTAT', name: 'Ownership sheet' });

		const [indicator] = await db.select().from(indicators);
		expect(indicator).toMatchObject({
			indicatorGroupId: group.id,
			code: 'SME_OWNSTAT',
			name: 'Ownership status',
			shortName: 'Own stat',
			description: 'Ownership description',
			methodology: 'Survey method',
			sourceCitation: 'DANE SME',
			unit: 'Businesses',
			unitMult: 0,
			decimals: 2,
			defaultViz: 'bar',
			updated: '2026-01'
		});

		const frequencies = (await db.select().from(indicatorFrequencies))
			.map((frequency) => frequency.freq)
			.sort();
		expect(frequencies).toEqual(['A', 'M']);
	});

	it('lists definition-only frequencies in the admin definition catalog as unpublished', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Admin Draft Source', name: 'Admin Draft Source' },
				definitionText: 'indicator_code\tfreq\tname\tdimensions\nADMIN_DRAFT\tA\tAdmin draft\tSEX'
			},
			db
		);

		expect(result.ok).toBe(true);
		expect(await listAdminDefinitionFrequencies('admin_draft_source', db)).toEqual([
			{
				indicatorId: expect.any(Number),
				indicatorCode: 'ADMIN_DRAFT',
				indicatorName: 'Admin draft',
				groupCode: 'admin_draft_source',
				groupName: 'Admin Draft Source',
				freq: 'A',
				dimensions: ['SEX'],
				published: false
			}
		]);
	});

	it('marks admin definitions with published lineage as published', async () => {
		await saveDefinitionGrid(
			{
				dataSource: { code: 'Admin Published Source', name: 'Admin Published Source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\nADMIN_PUBLISHED\tM\tAdmin published\t'
			},
			db
		);
		const [indicator] = await db
			.select()
			.from(indicators)
			.where(eq(indicators.code, 'ADMIN_PUBLISHED'));
		await db.insert(indicatorDataSources).values({
			indicatorId: indicator.id,
			refArea: 'CO',
			freq: 'M',
			rowCount: 10
		});

		expect(await listAdminDefinitionFrequencies('admin_published_source', db)).toEqual([
			{
				indicatorId: indicator.id,
				indicatorCode: 'ADMIN_PUBLISHED',
				indicatorName: 'Admin published',
				groupCode: 'admin_published_source',
				groupName: 'Admin Published Source',
				freq: 'M',
				dimensions: [],
				published: true
			}
		]);
	});

	it('persists normalized Observation dimension contracts for new definitions', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Dimension Source', name: 'Dimension Source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\nDIMMED\tM\tDimmed indicator\t sex, Age '
			},
			db
		);

		expect(result.ok).toBe(true);
		const [indicator] = await db.select().from(indicators).where(eq(indicators.code, 'DIMMED'));
		const dimensions = (
			await db
				.select({
					indicatorId: indicatorDimensions.indicatorId,
					freq: indicatorDimensions.freq,
					dimensionCode: indicatorDimensions.dimensionCode
				})
				.from(indicatorDimensions)
		).sort((a, b) => a.dimensionCode.localeCompare(b.dimensionCode));

		expect(dimensions).toEqual([
			{ indicatorId: indicator.id, freq: 'M', dimensionCode: 'AGE' },
			{ indicatorId: indicator.id, freq: 'M', dimensionCode: 'SEX' }
		]);
	});

	it('rejects inconsistent annotation fields across frequencies for the same new Indicator', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Consistency Source', name: 'Consistency Source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\tshort_name\nCONSISTENT\tA\tConsistent indicator\t\tAnnual label\nCONSISTENT\tM\tConsistent indicator\t\tMonthly label'
			},
			db
		);

		expect(result.ok).toBe(false);
		expect(result.validation.errors).toEqual([
			{
				rowNumber: 3,
				field: 'short_name',
				message: 'Rows for Indicator CONSISTENT must use the same short_name.'
			}
		]);
		expect(await db.select().from(indicators)).toEqual([]);
	});

	it('rejects inconsistent measurement fields across frequencies for the same new Indicator', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Measurement Source', name: 'Measurement Source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\tunit\tdecimals\nMEASURE\tA\tMeasurement indicator\t\tPesos\t0\nMEASURE\tM\tMeasurement indicator\t\tDollars\t0'
			},
			db
		);

		expect(result.ok).toBe(false);
		expect(result.validation.errors).toEqual([
			{
				rowNumber: 3,
				field: 'unit',
				message: 'Rows for Indicator MEASURE must use the same unit.'
			}
		]);
		expect(await db.select().from(indicators)).toEqual([]);
	});

	it('adds a new frequency to an existing same-source Indicator without renaming curated records', async () => {
		const [dataSource] = await db
			.insert(dataSources)
			.values({ code: 'existing_source', name: 'Curated source' })
			.returning({ id: dataSources.id });
		const [group] = await db
			.insert(indicatorGroups)
			.values({ dataSourceId: dataSource.id, code: 'curated_group', name: 'Curated group' })
			.returning({ id: indicatorGroups.id });
		const [existingIndicator] = await db
			.insert(indicators)
			.values({
				indicatorGroupId: group.id,
				code: 'CURATED',
				name: 'Curated indicator',
				shortName: 'Curated short',
				description: 'Curated description',
				methodology: 'Curated method',
				frequency: 'A',
				sourceCitation: 'Curated source citation',
				unit: 'People',
				decimals: 0
			})
			.returning({ id: indicators.id });
		await db.insert(indicatorFrequencies).values({ indicatorId: existingIndicator.id, freq: 'A' });

		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'existing_source', name: 'Pasted source rename' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\tgroup_code\tgroup_name\tshort_name\tdescription\tmethodology\tsource_citation\tunit\tdecimals\nCURATED\tM\tPasted indicator rename\tSEX\tpasted_group\tPasted group\tPasted short\tPasted description\tPasted method\tPasted citation\tPesos\t2\nNEW_IN_GROUP\tA\tNew in group\t\tcurated_group\tPasted group rename\t\t\t\t\t\t'
			},
			db
		);

		expect(result.ok).toBe(true);
		const [sourceAfter] = await db.select().from(dataSources).where(eq(dataSources.code, 'existing_source'));
		expect(sourceAfter.name).toBe('Curated source');

		const [groupAfter] = await db
			.select()
			.from(indicatorGroups)
			.where(eq(indicatorGroups.code, 'curated_group'));
		expect(groupAfter.name).toBe('Curated group');
		expect(
			await db.select().from(indicatorGroups).where(eq(indicatorGroups.code, 'pasted_group'))
		).toEqual([]);

		const [indicatorAfter] = await db
			.select()
			.from(indicators)
			.where(eq(indicators.code, 'CURATED'));
		expect(indicatorAfter).toMatchObject({
			indicatorGroupId: group.id,
			name: 'Curated indicator',
			shortName: 'Curated short',
			description: 'Curated description',
			methodology: 'Curated method',
			sourceCitation: 'Curated source citation',
			unit: 'People',
			decimals: 0
		});

		const frequencies = (await db.select().from(indicatorFrequencies))
			.filter((frequency) => frequency.indicatorId === existingIndicator.id)
			.map((frequency) => frequency.freq)
			.sort();
		expect(frequencies).toEqual(['A', 'M']);
		const curatedDimensions = await db
			.select({
				indicatorId: indicatorDimensions.indicatorId,
				freq: indicatorDimensions.freq,
				dimensionCode: indicatorDimensions.dimensionCode
			})
			.from(indicatorDimensions)
			.where(eq(indicatorDimensions.indicatorId, existingIndicator.id));
		expect(curatedDimensions).toEqual([
			{ indicatorId: existingIndicator.id, freq: 'M', dimensionCode: 'SEX' }
		]);
	});

	it('rejects existing Indicator codes owned by another Data source without partial writes', async () => {
		const [otherSource] = await db
			.insert(dataSources)
			.values({ code: 'other_source', name: 'Other source' })
			.returning({ id: dataSources.id });
		const [otherGroup] = await db
			.insert(indicatorGroups)
			.values({ dataSourceId: otherSource.id, code: 'other_group', name: 'Other group' })
			.returning({ id: indicatorGroups.id });
		await db
			.insert(indicators)
			.values({ indicatorGroupId: otherGroup.id, code: 'TAKEN', name: 'Taken indicator' });

		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'selected_source', name: 'Selected source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\nTAKEN\tA\tTaken pasted\t\nNEW_OK\tA\tShould not save\t'
			},
			db
		);

		expect(result.ok).toBe(false);
		expect(result.validation.errors).toEqual([
			{
				rowNumber: 2,
				field: 'indicator_code',
				message: 'Indicator code TAKEN already belongs to Data source other_source.'
			}
		]);
		expect(await db.select().from(dataSources).where(eq(dataSources.code, 'selected_source'))).toEqual([]);
		expect(await db.select().from(indicators).where(eq(indicators.code, 'NEW_OK'))).toEqual([]);
	});

	it('rejects redefining an existing Indicator frequency even without observations', async () => {
		const [dataSource] = await db
			.insert(dataSources)
			.values({ code: 'freq_source', name: 'Frequency source' })
			.returning({ id: dataSources.id });
		const [group] = await db
			.insert(indicatorGroups)
			.values({ dataSourceId: dataSource.id, code: 'freq_source', name: 'Frequency source' })
			.returning({ id: indicatorGroups.id });
		const [indicator] = await db
			.insert(indicators)
			.values({ indicatorGroupId: group.id, code: 'FREQ_EXISTS', name: 'Frequency exists' })
			.returning({ id: indicators.id });
		await db.insert(indicatorFrequencies).values({ indicatorId: indicator.id, freq: 'A' });

		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'freq_source', name: 'Frequency source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\nFREQ_EXISTS\tA\tFrequency pasted\t\nNEW_BLOCKED\tA\tShould not save\t'
			},
			db
		);

		expect(result.ok).toBe(false);
		expect(result.validation.errors).toEqual([
			{
				rowNumber: 2,
				field: 'freq',
				message: 'Indicator frequency already exists: FREQ_EXISTS/A'
			}
		]);
		expect(await db.select().from(indicators).where(eq(indicators.code, 'NEW_BLOCKED'))).toEqual(
			[]
		);
		expect(
			await db
				.select()
				.from(indicatorFrequencies)
				.where(eq(indicatorFrequencies.indicatorId, indicator.id))
		).toHaveLength(1);
	});

	it('does not save any rows when one pasted row is invalid', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Test Source', name: 'Test Source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\nGOOD\tA\tGood indicator\t\nBAD\tA\tBad indicator\tUNKNOWN'
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
		expect(await db.select().from(dataSources).where(eq(dataSources.code, 'test_source'))).toEqual([]);
		expect(await db.select().from(indicators)).toEqual([]);
		expect(await db.select().from(indicatorFrequencies)).toEqual([]);
		expect(await db.select().from(indicatorDimensions)).toEqual([]);
	});
});
