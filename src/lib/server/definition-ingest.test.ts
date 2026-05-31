import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import {
	dataSources,
	dimensionDefinitions,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import {
	listAdminDefinitionFrequencies,
	normalizeDataSourceCode,
	saveIndicatorDefinitionRows
} from '$lib/server/definition-ingest';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;

let tempDir: string;
let client: Client;
let db: TestDb;

const ddl = [
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
		updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
		FOREIGN KEY (data_source_id) REFERENCES data_sources(id)
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
		updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
		FOREIGN KEY (indicator_group_id) REFERENCES indicator_groups(id)
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
		updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
		FOREIGN KEY (indicator_id) REFERENCES indicators(id)
	)`,
	`CREATE UNIQUE INDEX indicator_frequencies_unique ON indicator_frequencies (indicator_id, freq)`,
	`CREATE TABLE indicator_dimensions (
		id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
		indicator_id integer NOT NULL,
		freq text(1) DEFAULT '*' NOT NULL,
		dimension_code text(100) NOT NULL,
		default_value text(100),
		is_filterable integer DEFAULT true,
		is_splitable integer DEFAULT true,
		FOREIGN KEY (indicator_id) REFERENCES indicators(id),
		FOREIGN KEY (dimension_code) REFERENCES dimension_definitions(code)
	)`,
	`CREATE UNIQUE INDEX indicator_dimensions_unique ON indicator_dimensions (indicator_id, freq, dimension_code)`
];

async function createTestDb() {
	tempDir = await mkdtemp(join(tmpdir(), 'definition-ingest-'));
	client = createClient({ url: `file:${join(tempDir, 'db.sqlite')}` });
	db = drizzle(client, { schema });

	for (const statement of ddl) {
		await client.execute(statement);
	}

	await db.insert(dimensionDefinitions).values([
		{ code: 'GEO_LEVEL', name: 'Nivel geográfico' },
		{ code: 'DEPT_CODE', name: 'Departamento' },
		{ code: 'SEX', name: 'Sexo' }
	]);
}

async function countRows(tableName: string): Promise<number> {
	const result = await client.execute(`SELECT COUNT(*) AS count FROM ${tableName}`);
	return Number(result.rows[0].count);
}

async function seedIndicator(params: {
	dataSourceCode: string;
	dataSourceName?: string;
	groupCode?: string;
	groupName?: string;
	indicatorCode: string;
	indicatorName?: string;
	freqs?: string[];
}) {
	const [dataSource] = await db
		.insert(dataSources)
		.values({ code: params.dataSourceCode, name: params.dataSourceName || params.dataSourceCode })
		.returning({ id: dataSources.id });
	const [group] = await db
		.insert(indicatorGroups)
		.values({
			dataSourceId: dataSource.id,
			code: params.groupCode || params.dataSourceCode,
			name: params.groupName || params.dataSourceName || params.dataSourceCode
		})
		.returning({ id: indicatorGroups.id });
	const [indicator] = await db
		.insert(indicators)
		.values({
			indicatorGroupId: group.id,
			code: params.indicatorCode,
			name: params.indicatorName || params.indicatorCode,
			description: 'Curated description',
			unit: 'Curated unit'
		})
		.returning({ id: indicators.id });

	if (params.freqs?.length) {
		await db
			.insert(indicatorFrequencies)
			.values(params.freqs.map((freq) => ({ indicatorId: indicator.id, freq })));
	}

	return { dataSource, group, indicator };
}

beforeEach(async () => {
	await createTestDb();
});

afterEach(async () => {
	client?.close();
	await rm(tempDir, { recursive: true, force: true });
});

describe('definition ingest', () => {
	it('normalizes data source codes to lowercase snake case', () => {
		expect(normalizeDataSourceCode(' DANE Mercado Laboral 2024 ')).toBe(
			'dane_mercado_laboral_2024'
		);
		expect(normalizeDataSourceCode('Encuesta Calidad de Vida')).toBe(
			'encuesta_calidad_de_vida'
		);
	});

	it('saves required and optional headers, dimensions, and dimensionless frequencies', async () => {
		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'DANE Empleo', name: 'DANE Empleo' },
				definitionText: [
					'indicator_code\tfreq\tname\tdimensions\tunit\tunit_mult\tdecimals',
					'EMP_Rate\tM\tTasa de ocupación\tgeo_level, DEPT_CODE\tPorcentaje\t0\t1',
					'POP_TOTAL\tA\tPoblación total\t\tPersonas\t0\t0'
				].join('\n')
			},
			{ db }
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.summary).toMatchObject({
			dataSourceCode: 'dane_empleo',
			createdDataSource: true,
			createdGroups: 1,
			createdIndicators: 2,
			createdFrequencies: 2,
			createdDimensions: 2
		});

		const indicatorRows = await db.select().from(indicators).where(eq(indicators.code, 'EMP_Rate'));
		expect(indicatorRows[0]).toMatchObject({ code: 'EMP_Rate', unit: 'Porcentaje', unitMult: 0, decimals: 1 });
		expect(await listAdminDefinitionFrequencies('dane_empleo', { db })).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					indicatorCode: 'EMP_Rate',
					freq: 'M',
					dimensions: ['GEO_LEVEL', 'DEPT_CODE']
				}),
				expect.objectContaining({ indicatorCode: 'POP_TOTAL', freq: 'A', dimensions: [] })
			])
		);
	});

	it('rejects missing required headers without saving anything', async () => {
		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'test', name: 'Test' },
				definitionText: 'indicator_code\tfreq\tname\nA\tA\tName'
			},
			{ db }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContainEqual(
			expect.objectContaining({ row: 1, field: 'dimensions' })
		);
		expect(await countRows('data_sources')).toBe(0);
	});

	it('rejects unknown dimensions and semicolon delimiters all-or-nothing', async () => {
		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'test', name: 'Test' },
				definitionText: [
					'indicator_code\tfreq\tname\tdimensions',
					'OK\tA\tValid row\tGEO_LEVEL',
					'BAD\tA\tInvalid row\tGEO_LEVEL;SEX'
				].join('\n')
			},
			{ db }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ row: 3, field: 'dimensions' }),
				expect.objectContaining({ row: 3, message: expect.stringContaining('no existe') })
			])
		);
		expect(await countRows('indicators')).toBe(0);
	});

	it('rejects duplicate indicator frequency rows in the same paste', async () => {
		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'test', name: 'Test' },
				definitionText: [
					'indicator_code\tfreq\tname\tdimensions',
					'DUP\tA\tDuplicate\t',
					'DUP\tA\tDuplicate\t'
				].join('\n')
			},
			{ db }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContainEqual(
			expect.objectContaining({ row: 3, field: 'freq', message: expect.stringContaining('repetida') })
		);
		expect(await countRows('indicators')).toBe(0);
	});

	it('allows multiple frequencies for one new indicator when shared fields match', async () => {
		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'test', name: 'Test' },
				definitionText: [
					'indicator_code\tfreq\tname\tdimensions\tunit\tdecimals',
					'MULTI\tA\tMulti frequency\tGEO_LEVEL\tPersonas\t0',
					'MULTI\tM\tMulti frequency\tGEO_LEVEL\tPersonas\t0'
				].join('\n')
			},
			{ db }
		);

		expect(result.ok).toBe(true);
		expect(await countRows('indicators')).toBe(1);
		expect(await countRows('indicator_frequencies')).toBe(2);
	});

	it('rejects inconsistent indicator-level fields for one new indicator', async () => {
		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'test', name: 'Test' },
				definitionText: [
					'indicator_code\tfreq\tname\tdimensions\tunit',
					'MULTI\tA\tMulti frequency\tGEO_LEVEL\tPersonas',
					'MULTI\tM\tMulti frequency\tGEO_LEVEL\tPorcentaje'
				].join('\n')
			},
			{ db }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContainEqual(
			expect.objectContaining({ row: 3, field: 'unit', message: expect.stringContaining('debe coincidir') })
		);
		expect(await countRows('indicators')).toBe(0);
	});

	it('adds a new frequency to an existing same-source indicator without renaming curated records', async () => {
		const seeded = await seedIndicator({
			dataSourceCode: 'existing_source',
			dataSourceName: 'Curated source name',
			groupCode: 'curated_group',
			groupName: 'Curated group name',
			indicatorCode: 'EXISTING',
			indicatorName: 'Curated indicator name',
			freqs: ['A']
		});

		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'existing_source', name: 'Renamed source' },
				definitionText: [
					'indicator_code\tfreq\tname\tdimensions\tgroup_code\tgroup_name\tdescription\tunit',
					'EXISTING\tM\tPasted name\tSEX\tnew_group\tNew group\tPasted description\tPasted unit'
				].join('\n')
			},
			{ db }
		);

		expect(result.ok).toBe(true);

		const [source] = await db
			.select()
			.from(dataSources)
			.where(eq(dataSources.id, seeded.dataSource.id));
		const [group] = await db
			.select()
			.from(indicatorGroups)
			.where(eq(indicatorGroups.id, seeded.group.id));
		const [indicator] = await db
			.select()
			.from(indicators)
			.where(eq(indicators.id, seeded.indicator.id));
		const dimensions = await db
			.select()
			.from(indicatorDimensions)
			.where(eq(indicatorDimensions.indicatorId, seeded.indicator.id));

		expect(source.name).toBe('Curated source name');
		expect(group.name).toBe('Curated group name');
		expect(indicator).toMatchObject({
			name: 'Curated indicator name',
			description: 'Curated description',
			unit: 'Curated unit'
		});
		expect(await countRows('indicator_groups')).toBe(1);
		expect(await countRows('indicator_frequencies')).toBe(2);
		expect(dimensions).toEqual([expect.objectContaining({ freq: 'M', dimensionCode: 'SEX' })]);
	});

	it('rejects indicator codes owned by another data source', async () => {
		await seedIndicator({
			dataSourceCode: 'source_one',
			indicatorCode: 'OWNED',
			freqs: []
		});

		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'source_two', name: 'Source two' },
				definitionText: 'indicator_code\tfreq\tname\tdimensions\nOWNED\tA\tOwned elsewhere\t'
			},
			{ db }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContainEqual(
			expect.objectContaining({ field: 'indicator_code', message: expect.stringContaining('source_one') })
		);
		expect(await countRows('data_sources')).toBe(1);
	});

	it('rejects redefining an existing indicator frequency', async () => {
		await seedIndicator({
			dataSourceCode: 'source_one',
			indicatorCode: 'EXISTING',
			freqs: ['A']
		});

		const result = await saveIndicatorDefinitionRows(
			{
				dataSource: { code: 'source_one', name: 'Source one' },
				definitionText: 'indicator_code\tfreq\tname\tdimensions\nEXISTING\tA\tExisting\tGEO_LEVEL'
			},
			{ db }
		);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors).toContainEqual(
			expect.objectContaining({ field: 'freq', message: expect.stringContaining('ya existe') })
		);
		expect(await countRows('indicator_dimensions')).toBe(0);
	});
});
