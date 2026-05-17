import { db } from '../src/lib/db/script-client';
import {
	indicators,
	indicatorFiles,
	dimensionDefinitions,
	dimensionValues,
	indicatorDimensions
} from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';
import duckdb from 'duckdb';
import { resolve } from 'path';

const BASE_COLS = new Set([
	'REF_AREA',
	'TIME_PERIOD',
	'FREQ',
	'OBS_VALUE',
	'UNIT',
	'UNIT_MULT',
	'INDICATOR',
	'OBS_STATUS',
	'DECIMALS',
	'SOURCE_SHEET',
	'CUADRO_TITLE'
]);

const STANDARD_DIMENSION_DEFAULTS: Record<string, string> = {
	GEO_LEVEL: 'NAT',
	DEPT_CODE: '00',
	MUNI_CODE: '0000',
	URBAN_RURAL: 'T',
	SEX: 'T',
	AGE: 'TOTAL',
	ADJUSTMENT: 'NSA'
};

const STANDARD_DIMENSION_LABELS: Record<string, string> = {
	GEO_LEVEL: 'Nivel geográfico',
	DEPT_CODE: 'Departamento',
	MUNI_CODE: 'Municipio',
	URBAN_RURAL: 'Zona',
	SEX: 'Sexo',
	AGE: 'Edad',
	ADJUSTMENT: 'Ajuste'
};

async function run() {
	console.log('[seed-dimensions] Starting...');

	const duckDb = new duckdb.Database(':memory:');

	// 1. Load all indicators and pick one sample file per indicator+freq
	const allIndicators = await db.select().from(indicators);
	const allFiles = await db.select().from(indicatorFiles);

	console.log(`[seed-dimensions] ${allIndicators.length} indicators, ${allFiles.length} files`);

	// Pick one representative file per indicator
	const sampleFiles = new Map<number, typeof allFiles[0]>();
	for (const file of allFiles) {
		if (!sampleFiles.has(file.indicatorId)) {
			sampleFiles.set(file.indicatorId, file);
		}
	}

	console.log(`[seed-dimensions] Sampling ${sampleFiles.size} files`);

	const dimensionCodes = new Set<string>();
	const dimensionCodeValues = new Map<string, Set<string>>();
	const indicatorIdFreqDims = new Map<number, Map<string, Set<string>>>();

	let processed = 0;
	for (const [indicatorId, file] of sampleFiles) {
		const indicator = allIndicators.find((i) => i.id === indicatorId);
		if (!indicator) continue;

		const fullPath = resolve(process.cwd(), 'data', file.filePath);

		try {
			const cols = await new Promise<{ column_name: string }[]>((res, rej) => {
				duckDb.all(
					`SELECT column_name FROM (DESCRIBE SELECT * FROM read_parquet('${fullPath}'))`,
					(err: Error | null, rows: any) => {
						if (err) rej(err);
						else res(rows as { column_name: string }[]);
					}
				);
			});

			const freqMatch = file.filePath.match(/FREQ=([MAQD])/);
			const freq = freqMatch ? freqMatch[1] : indicator.frequency || '*';

			const dims = cols
				.map((c) => c.column_name.toUpperCase())
				.filter((c) => !BASE_COLS.has(c));

			if (!indicatorIdFreqDims.has(indicator.id)) {
				indicatorIdFreqDims.set(indicator.id, new Map());
			}
			const freqMap = indicatorIdFreqDims.get(indicator.id)!;
			if (!freqMap.has(freq)) {
				freqMap.set(freq, new Set());
			}

			for (const dim of dims) {
				dimensionCodes.add(dim);
				freqMap.get(freq)!.add(dim);

				if (!dimensionCodeValues.has(dim)) {
					dimensionCodeValues.set(dim, new Set());
				}

				// Sample distinct values
				try {
					const vals = await new Promise<{ v: string }[]>((res, rej) => {
						duckDb.all(
							`SELECT DISTINCT "${dim}" as v FROM read_parquet('${fullPath}') LIMIT 50`,
							(err: Error | null, rows: any) => {
								if (err) rej(err);
								else res(rows as { v: string }[]);
							}
						);
					});
					for (const v of vals) {
						if (v.v != null) dimensionCodeValues.get(dim)!.add(String(v.v));
					}
				} catch {
					// Ignore
				}
			}
		} catch (e) {
			console.warn(`[seed-dimensions] Could not read ${file.filePath}`);
		}

		processed++;
		if (processed % 50 === 0) {
			console.log(`[seed-dimensions] Processed ${processed}/${sampleFiles.size}`);
		}
	}

	console.log(`[seed-dimensions] Found ${dimensionCodes.size} unique dimensions`);

	// 2. Upsert dimension_definitions
	for (const dimCode of dimensionCodes) {
		const existing = await db
			.select()
			.from(dimensionDefinitions)
			.where(eq(dimensionDefinitions.code, dimCode))
			.limit(1);

		if (existing.length === 0) {
			await db.insert(dimensionDefinitions).values({
				code: dimCode,
				name: STANDARD_DIMENSION_LABELS[dimCode] || dimCode.replace(/_/g, ' '),
				sortOrder: null,
				isStandard: true
			});
		}
	}
	console.log('[seed-dimensions] Dimension definitions created');

	// 3. Upsert dimension_values
	for (const [dimCode, values] of dimensionCodeValues) {
		for (const val of values) {
			if (val == null || val === '') continue;

			const existing = await db
				.select()
				.from(dimensionValues)
				.where(eq(dimensionValues.dimensionCode, dimCode))
				.limit(50);

			const alreadyExists = existing.some((e) => e.code === val);
			if (!alreadyExists) {
				await db.insert(dimensionValues).values({
					dimensionCode: dimCode,
					code: val,
					labelEs: null,
					sortOrder: null
				});
			}
		}
		console.log(`[seed-dimensions] ${dimCode}: ${values.size} values`);
	}

	// 4. Upsert indicator_dimensions
	let dimCount = 0;
	for (const [indicatorId, freqMap] of indicatorIdFreqDims) {
		for (const [freq, dims] of freqMap) {
			for (const dimCode of dims) {
				const existing = await db
					.select()
					.from(indicatorDimensions)
					.where(eq(indicatorDimensions.indicatorId, indicatorId))
					.limit(20);

				const alreadyExists = existing.some(
					(e) =>
						e.dimensionCode === dimCode &&
						(e.freq === freq || e.freq === '*')
				);

				if (!alreadyExists) {
					await db.insert(indicatorDimensions).values({
						indicatorId,
						freq,
						dimensionCode: dimCode,
						defaultValue: STANDARD_DIMENSION_DEFAULTS[dimCode] || null,
						isFilterable: true,
						isSplitable: true
					});
					dimCount++;
				}
			}
		}
	}

	console.log(`[seed-dimensions] Registered ${dimCount} indicator-dimension combinations`);
	console.log('[seed-dimensions] Complete!');
}

run().catch((err) => {
	console.error('[seed-dimensions] Failed:', err);
	process.exit(1);
});
