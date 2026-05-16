import { db } from '../db/script-client';
import { areas, indicatorGroups, indicators, indicatorFiles } from '../db/schema';
import { scanDataDirectory, type ParquetFile } from './scanner';
import { and, eq } from 'drizzle-orm';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

interface MetadataIndicator {
	title?: string;
	category?: string;
	subcategory?: string;
	dims?: string[];
	freq?: string[];
	unit?: string;
	unit_mult?: number;
	decimals?: number;
	default_viz?: string;
	methodology?: string;
	source?: string;
	updated?: string;
	dimensions_applicables?: string[];
	collection?: string;
}

interface MetadataCollection {
	title?: string;
	members?: string[];
	filter_whitelist?: string[];
}

interface MetadataCatalog {
	indicators?: Record<string, MetadataIndicator>;
	collections?: Record<string, MetadataCollection>;
}

interface ParquetAnnotationSample {
	unit?: string | null;
	unitMult?: number | null;
	decimals?: number | null;
	sourceSheet?: string | null;
	cuadroTitle?: string | null;
}

const AREA_DISPLAY_NAMES: Record<string, string> = {
	empleo: 'Empleo',
	emicron: 'Empresas (EMICRON)',
	calidad_vida: 'Calidad de vida'
};

const AREA_SOURCE_NAMES: Record<string, string> = {
	empleo: 'DANE-GEIH',
	emicron: 'DANE-EMICRON',
	calidad_vida: 'DANE-ECV'
};

function normalizeCode(value: string | undefined | null): string {
	return (value || '').replace(/^"|"$/g, '').trim();
}

function cleanTitle(value: string | undefined | null): string | null {
	const normalized = normalizeCode(value);
	return normalized.length > 0 ? normalized : null;
}

function titleCaseSpanish(value: string): string {
	const lowerWords = new Set([
		'a',
		'al',
		'con',
		'de',
		'del',
		'el',
		'en',
		'la',
		'las',
		'los',
		'o',
		'por',
		'y'
	]);
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((word, index) => {
			const lower = word.toLowerCase();
			if (index > 0 && lowerWords.has(lower)) return lower;
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join(' ');
}

function humanizeFolderName(value: string): string {
	return titleCaseSpanish(
		value
			.replace(/^Cuadro_([0-9]+)_/, 'Cuadro $1 ')
			.replace(/^[A-Z]\.?[0-9A-Z.]*_/, '')
			.replace(/_/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

const SME_SUFFIX_LABELS: Record<string, string> = {
	TOTAL: 'Total de micronegocios',
	PATRON: 'Micronegocios de empleadores',
	CTA_PROP: 'Micronegocios de trabajadores por cuenta propia',
	MALE: 'Micronegocios liderados por hombres',
	FEMALE: 'Micronegocios liderados por mujeres',
	STARTED_ALONE: 'Micronegocios iniciados en solitario',
	STARTED_WITH_FAMILY: 'Micronegocios iniciados con familiares',
	STARTED_WITH_OTHERS: 'Micronegocios iniciados con otras personas',
	STARTED_BY_OTHER_PEOPLE: 'Micronegocios iniciados por otras personas',
	STARTED_BY_FAMILY: 'Micronegocios iniciados por familiares',
	STARTED_BY_OTHERS: 'Micronegocios iniciados por terceros',
	PRIMARYSOURCE_SAVINGS: 'Micronegocios cuya fuente principal de recursos fueron ahorros',
	PRIMARYSOURCE_FAMILYLOAN:
		'Micronegocios cuya fuente principal de recursos fue un préstamo familiar',
	PRIMARYSOURCE_BANKLOAN:
		'Micronegocios cuya fuente principal de recursos fue un préstamo bancario',
	PRIMARYSOURCE_SHARKLOAN:
		'Micronegocios cuya fuente principal de recursos fue un préstamo gota a gota',
	PRIMARYSOURCE_SEED: 'Micronegocios cuya fuente principal de recursos fue capital semilla',
	PRIMARYSOURCE_NONEED: 'Micronegocios que no necesitaron recursos para iniciar',
	PRIMARYSOURCE_DONTKNOW: 'Micronegocios sin información sobre la fuente principal de recursos',
	PRIMARYSOURCE_OTHER: 'Micronegocios con otra fuente principal de recursos',
	REASON_NO_OTHER_INCOME: 'Micronegocios creados por no tener otra fuente de ingresos',
	REASON_OPPORTUNITY: 'Micronegocios creados por oportunidad de negocio',
	REASON_TRADITION: 'Micronegocios creados por tradición familiar',
	REASON_COMPLEMENT_INCOME: 'Micronegocios creados para complementar ingresos',
	REASON_CAREER: 'Micronegocios creados por ejercer oficio o carrera',
	REASON_LOW_EMPLOYABILITY: 'Micronegocios creados por baja empleabilidad',
	REASON_OTHER: 'Micronegocios creados por otra razón'
};

function humanizeIndicatorCode(code: string, area: string): string {
	if (/^[A-Z0-9]+$/.test(code)) return code;

	if (area === 'emicron' && code.startsWith('NUM_SME_')) {
		const suffix = code.replace('NUM_SME_', '');
		if (SME_SUFFIX_LABELS[suffix]) return SME_SUFFIX_LABELS[suffix];
		return titleCaseSpanish(`Micronegocios ${suffix.replace(/_/g, ' ')}`);
	}

	return titleCaseSpanish(code.replace(/_/g, ' '));
}

function loadMetadataCatalog(dataPath: string): MetadataCatalog {
	const candidatePaths = [
		join(dataPath, 'metadata', 'metadata_with_collections.json'),
		join(process.cwd(), 'data', 'metadata', 'metadata_with_collections.json')
	];
	const metadataPath = candidatePaths.find((path) => existsSync(path));
	if (!metadataPath) return {};

	console.log('Loading metadata catalog:', metadataPath);
	return JSON.parse(readFileSync(metadataPath, 'utf-8')) as MetadataCatalog;
}

function isRawCodeTitle(code: string, title: string | undefined | null): boolean {
	const cleaned = cleanTitle(title);
	return !cleaned || cleaned === code;
}

function buildMetadataIndex(catalog: MetadataCatalog): {
	indicatorsByCode: Map<string, MetadataIndicator>;
	collectionsByCode: Map<string, MetadataCollection>;
} {
	const indicatorsByCode = new Map<string, MetadataIndicator>();
	const collectionsByCode = new Map<string, MetadataCollection>();

	for (const [code, indicator] of Object.entries(catalog.indicators || {})) {
		const normalizedCode = normalizeCode(code);
		const normalizedIndicator = {
			...indicator,
			collection: normalizeCode(indicator.collection)
		};
		const existing = indicatorsByCode.get(normalizedCode);
		if (
			existing &&
			!isRawCodeTitle(normalizedCode, existing.title) &&
			isRawCodeTitle(normalizedCode, indicator.title)
		) {
			continue;
		}
		indicatorsByCode.set(normalizedCode, normalizedIndicator);
	}

	for (const [code, collection] of Object.entries(catalog.collections || {})) {
		const normalizedCode = normalizeCode(code);
		if (normalizedCode.toLowerCase() === 'nan') continue;
		collectionsByCode.set(normalizedCode, {
			...collection,
			members: collection.members?.map(normalizeCode)
		});
	}

	return { indicatorsByCode, collectionsByCode };
}

function normalizeMachineText(value: string): string {
	return normalizeCode(value)
		.toLowerCase()
		.replace(/[^a-z0-9áéíóúñ]+/gi, ' ')
		.trim();
}

function shouldBootstrapValue(existing: string | null | undefined, code: string): boolean {
	if (!existing) return true;
	return normalizeMachineText(existing) === normalizeMachineText(code) || existing.includes('_');
}

async function createParquetInspector(dataPath: string) {
	try {
		const duckdbModule = await import('duckdb');
		const duckdb = duckdbModule.default || duckdbModule;
		const database = await new Promise<any>((resolve, reject) => {
			const instance = new duckdb.Database(':memory:', (error: Error | null) => {
				if (error) reject(error);
				else resolve(instance);
			});
		});

		const queryRows = (query: string) =>
			new Promise<any[]>((resolve, reject) => {
				database.all(query, (error: Error | null, rows: any[]) => {
					if (error) reject(error);
					else resolve(rows);
				});
			});

		return async (file: ParquetFile): Promise<ParquetAnnotationSample> => {
			const filePath = join(dataPath, file.filePath).replace(/'/g, "''");
			const query = `
				SELECT *
				FROM read_parquet('${filePath}')
				LIMIT 1
			`;
			const rows = await queryRows(query);
			const row = rows[0] || {};
			return {
				unit: row.UNIT ?? null,
				unitMult:
					row.UNIT_MULT === undefined || row.UNIT_MULT === null ? null : Number(row.UNIT_MULT),
				decimals: row.DECIMALS === undefined || row.DECIMALS === null ? null : Number(row.DECIMALS),
				sourceSheet: row.SOURCE_SHEET ?? null,
				cuadroTitle: row.CUADRO_TITLE ?? null
			};
		};
	} catch {
		console.warn(
			'[seed] DuckDB unavailable; parquet annotations will be limited to JSON/folder data'
		);
		return async () => ({}) as ParquetAnnotationSample;
	}
}

export async function seedIndicators(dataPath: string) {
	console.log('Scanning data directory:', dataPath);
	const files = await scanDataDirectory(dataPath);
	console.log(`Found ${files.length} parquet files`);

	const catalog = loadMetadataCatalog(dataPath);
	const { indicatorsByCode, collectionsByCode } = buildMetadataIndex(catalog);
	const inspectParquet = await createParquetInspector(dataPath);

	const areaMap = new Map<string, number>();
	const groupMap = new Map<string, number>();
	const indicatorMap = new Map<string, number>();
	const firstFileByIndicator = new Map<string, ParquetFile>();

	for (const file of files) {
		if (!firstFileByIndicator.has(file.indicator)) firstFileByIndicator.set(file.indicator, file);
	}

	const uniqueAreas = [...new Set(files.map((f) => f.area))];
	for (const areaCode of uniqueAreas) {
		const name = AREA_DISPLAY_NAMES[areaCode] || humanizeFolderName(areaCode);
		const existing = await db.select().from(areas).where(eq(areas.code, areaCode)).limit(1);

		let areaId: number;
		if (existing.length > 0) {
			areaId = existing[0].id;
			if (shouldBootstrapValue(existing[0].name, areaCode)) {
				await db.update(areas).set({ name }).where(eq(areas.id, areaId));
			}
		} else {
			const [inserted] = await db
				.insert(areas)
				.values({
					code: areaCode,
					name
				})
				.returning();
			areaId = inserted.id;
		}
		areaMap.set(areaCode, areaId);
		console.log(`Area: ${areaCode} -> ${areaId}`);
	}

	const uniqueGroups = [...new Set(files.map((f) => `${f.area}|${f.category}`))].map((key) => {
		const [area, group] = key.split('|');
		return { area, group };
	});

	for (const { area, group: groupCode } of uniqueGroups) {
		const areaId = areaMap.get(area);
		if (!areaId) continue;

		const collection = collectionsByCode.get(groupCode);
		const groupName = cleanTitle(collection?.title) || humanizeFolderName(groupCode);
		const sourceType =
			area === 'calidad_vida' ? 'source_table' : collection ? 'metadata_collection' : 'folder';

		const existing = await db
			.select()
			.from(indicatorGroups)
			.where(and(eq(indicatorGroups.areaId, areaId), eq(indicatorGroups.code, groupCode)))
			.limit(1);

		let groupId: number;
		if (existing.length > 0) {
			groupId = existing[0].id;
			await db
				.update(indicatorGroups)
				.set({
					name: shouldBootstrapValue(existing[0].name, groupCode) ? groupName : existing[0].name,
					sourceType: existing[0].sourceType || sourceType,
					filterWhitelist: existing[0].filterWhitelist || collection?.filter_whitelist || null
				})
				.where(eq(indicatorGroups.id, groupId));
		} else {
			const [inserted] = await db
				.insert(indicatorGroups)
				.values({
					areaId,
					code: groupCode,
					name: groupName,
					sourceType,
					filterWhitelist: collection?.filter_whitelist || null
				})
				.returning();
			groupId = inserted.id;
		}
		groupMap.set(`${area}|${groupCode}`, groupId);
		console.log(`Indicator group: ${area}/${groupCode} -> ${groupId}`);
	}

	const uniqueIndicators = [
		...new Set(files.map((f) => `${f.area}|${f.category}|${f.frequency}|${f.indicator}`))
	].map((key) => {
		const [area, group, frequency, indicator] = key.split('|');
		return { area, group, frequency, indicator };
	});

	for (const { area, group: groupCode, frequency, indicator: indicatorCode } of uniqueIndicators) {
		const indicatorGroupId = groupMap.get(`${area}|${groupCode}`);
		if (!indicatorGroupId) continue;

		const metadata = indicatorsByCode.get(indicatorCode);
		const sampleFile = firstFileByIndicator.get(indicatorCode);
		const parquetSample = sampleFile ? await inspectParquet(sampleFile) : {};
		const sourceName = metadata?.source || AREA_SOURCE_NAMES[area] || null;
		const metadataTitle = cleanTitle(metadata?.title);
		const name =
			metadataTitle && metadataTitle !== indicatorCode
				? metadataTitle
				: humanizeIndicatorCode(indicatorCode, area);

		const values = {
			indicatorGroupId,
			code: indicatorCode,
			name,
			description: null,
			methodology: metadata?.methodology || null,
			frequency,
			source: sourceName,
			unit: metadata?.unit || parquetSample.unit || null,
			unitMult: metadata?.unit_mult ?? parquetSample.unitMult ?? null,
			decimals: metadata?.decimals ?? parquetSample.decimals ?? null,
			defaultViz: metadata?.default_viz || 'time_series',
			updated: metadata?.updated || null
		};

		const existing = await db
			.select()
			.from(indicators)
			.where(eq(indicators.code, indicatorCode))
			.limit(1);

		let indicatorId: number;
		if (existing.length > 0) {
			indicatorId = existing[0].id;
			await db
				.update(indicators)
				.set({
					indicatorGroupId,
					name: shouldBootstrapValue(existing[0].name, indicatorCode)
						? values.name
						: existing[0].name,
					methodology: existing[0].methodology || values.methodology,
					source: existing[0].source || values.source,
					unit: existing[0].unit || values.unit,
					unitMult: existing[0].unitMult ?? values.unitMult,
					decimals: existing[0].decimals ?? values.decimals,
					defaultViz: existing[0].defaultViz || values.defaultViz,
					updated: existing[0].updated || values.updated
				})
				.where(eq(indicators.id, indicatorId));
		} else {
			const [inserted] = await db.insert(indicators).values(values).returning();
			indicatorId = inserted.id;
		}
		indicatorMap.set(indicatorCode, indicatorId);
		console.log(`Indicator: ${indicatorCode} (${frequency}) -> ${indicatorId}`);
	}

	console.log('Seeding indicator files...');

	const uniqueFileRecords = new Map<string, (typeof files)[0]>();
	for (const file of files) {
		const key = `${file.indicator}|${file.refArea}|${file.year}|${file.filePath}`;
		uniqueFileRecords.set(key, file);
	}

	const fileRows = Array.from(uniqueFileRecords.values())
		.map((file) => {
			const indicatorId = indicatorMap.get(file.indicator);
			if (!indicatorId) return null;

			return {
				indicatorId,
				refArea: file.refArea,
				year: file.year,
				filePath: file.filePath
			};
		})
		.filter((row): row is NonNullable<typeof row> => row !== null);

	console.log(`Inserting ${fileRows.length} unique indicator-file combinations...`);

	const batchSize = 500;
	for (let i = 0; i < fileRows.length; i += batchSize) {
		const batch = fileRows.slice(i, i + batchSize);

		await db
			.insert(indicatorFiles)
			.values(batch)
			.onConflictDoNothing({
				target: [
					indicatorFiles.indicatorId,
					indicatorFiles.refArea,
					indicatorFiles.year,
					indicatorFiles.filePath
				]
			});

		console.log(
			`Indicator files batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(fileRows.length / batchSize)}`
		);
	}

	console.log(`Processed ${fileRows.length} indicator files`);
	console.log('Seeding complete!');
}
