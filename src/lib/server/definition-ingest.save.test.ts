import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/db/schema';
import {
	areas,
	dimensionDefinitions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { saveDefinitionGrid } from './definition-ingest';

async function createTestDb() {
	const directory = await mkdtemp(join(tmpdir(), 'ced-definition-ingest-'));
	const client = createClient({ url: `file:${join(directory, 'db.sqlite')}` });
	await client.batch([
		`CREATE TABLE areas (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			code text(50) NOT NULL UNIQUE,
			name text(255) NOT NULL,
			description text,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE TABLE indicator_groups (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			area_id integer NOT NULL,
			code text(255) NOT NULL,
			name text(255) NOT NULL,
			description text,
			source_type text(50),
			filter_whitelist text,
			created_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
			updated_at text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
		)`,
		`CREATE UNIQUE INDEX indicator_groups_area_code_unique ON indicator_groups (area_id, code)`,
		`CREATE TABLE indicators (
			id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
			indicator_group_id integer NOT NULL,
			code text(100) NOT NULL UNIQUE,
			name text(255) NOT NULL,
			short_name text(255),
			description text,
			methodology text,
			frequency text(1),
			source text(255),
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
		`CREATE UNIQUE INDEX indicator_frequencies_unique ON indicator_frequencies (indicator_id, freq)`
	]);
	return drizzle(client, { schema });
}

describe('saveDefinitionGrid', () => {
	let db: Awaited<ReturnType<typeof createTestDb>>;

	beforeEach(async () => {
		db = await createTestDb();
		await db.insert(dimensionDefinitions).values({ code: 'SEX', name: 'Sexo' });
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

		const [dataSource] = await db.select().from(areas);
		expect(dataSource).toMatchObject({ code: 'gran_encuesta_integrada_de_hogares', name: 'GEIH' });

		const [group] = await db.select().from(indicatorGroups);
		expect(group).toMatchObject({
			areaId: dataSource.id,
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
	});

	it('does not save any rows when one pasted row is invalid', async () => {
		const result = await saveDefinitionGrid(
			{
				dataSource: { code: 'Test Source', name: 'Test Source' },
				definitionText:
					'indicator_code\tfreq\tname\tdimensions\nGOOD\tA\tGood indicator\t\nBAD\tA\tBad indicator\tSEX'
			},
			db
		);

		expect(result.ok).toBe(false);
		expect(result.validation.errors).toEqual([
			{
				rowNumber: 3,
				field: 'dimensions',
				message: 'This save step only supports dimensionless definitions; leave dimensions empty.'
			}
		]);
		expect(await db.select().from(areas).where(eq(areas.code, 'test_source'))).toEqual([]);
		expect(await db.select().from(indicators)).toEqual([]);
		expect(await db.select().from(indicatorFrequencies)).toEqual([]);
	});
});
