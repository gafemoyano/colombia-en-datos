import { db } from '$lib/db/script-client';
import { areas, categories, indicators, indicatorFiles } from '$lib/db/schema';
import { scanDataDirectory } from './scanner';
import { eq } from 'drizzle-orm';
import { join } from 'path';

export async function seedIndicators(dataPath: string) {
	console.log('Scanning data directory:', dataPath);
	const files = await scanDataDirectory(dataPath);
	console.log(`Found ${files.length} parquet files`);

	const areaMap = new Map<string, number>();
	const categoryMap = new Map<string, number>();
	const indicatorMap = new Map<string, number>();

	const uniqueAreas = [...new Set(files.map((f) => f.area))];
	for (const areaCode of uniqueAreas) {
		const existing = await db.select().from(areas).where(eq(areas.code, areaCode)).limit(1);

		let areaId: number;
		if (existing.length > 0) {
			areaId = existing[0].id;
		} else {
			const [inserted] = await db
				.insert(areas)
				.values({
					code: areaCode,
					name: areaCode.charAt(0).toUpperCase() + areaCode.slice(1)
				})
				.returning();
			areaId = inserted.id;
		}
		areaMap.set(areaCode, areaId);
		console.log(`Area: ${areaCode} -> ${areaId}`);
	}

	const uniqueCategories = [...new Set(files.map((f) => `${f.area}|${f.category}`))].map((key) => {
		const [area, category] = key.split('|');
		return { area, category };
	});

	for (const { area, category: categoryCode } of uniqueCategories) {
		const areaId = areaMap.get(area);
		if (!areaId) continue;

		const existing = await db
			.select()
			.from(categories)
			.where(eq(categories.code, categoryCode))
			.limit(1);

		let categoryId: number;
		if (existing.length > 0) {
			categoryId = existing[0].id;
		} else {
			const [inserted] = await db
				.insert(categories)
				.values({
					areaId,
					code: categoryCode,
					name: categoryCode
				})
				.returning();
			categoryId = inserted.id;
		}
		categoryMap.set(`${area}|${categoryCode}`, categoryId);
		console.log(`Category: ${area}/${categoryCode} -> ${categoryId}`);
	}

	const uniqueIndicators = [
		...new Set(files.map((f) => `${f.area}|${f.category}|${f.frequency}|${f.indicator}`))
	].map((key) => {
		const [area, category, frequency, indicator] = key.split('|');
		return { area, category, frequency, indicator };
	});

	for (const {
		area,
		category: categoryCode,
		frequency,
		indicator: indicatorCode
	} of uniqueIndicators) {
		const categoryId = categoryMap.get(`${area}|${categoryCode}`);
		if (!categoryId) continue;

		const existing = await db
			.select()
			.from(indicators)
			.where(eq(indicators.code, indicatorCode))
			.limit(1);

		let indicatorId: number;
		if (existing.length > 0) {
			indicatorId = existing[0].id;
		} else {
			const [inserted] = await db
				.insert(indicators)
				.values({
					categoryId,
					code: indicatorCode,
					name: indicatorCode,
					frequency
				})
				.returning();
			indicatorId = inserted.id;
		}
		indicatorMap.set(indicatorCode, indicatorId);
		console.log(`Indicator: ${indicatorCode} (${frequency}) -> ${indicatorId}`);
	}

	console.log('Seeding indicator files...');
	let fileCount = 0;

	// Deduplicate by indicator+refArea+year+filePath combination
	const uniqueFileRecords = new Map<string, (typeof files)[0]>();
	for (const file of files) {
		const key = `${file.indicator}|${file.refArea}|${file.year}|${file.filePath}`;
		uniqueFileRecords.set(key, file);
	}

	console.log(`Inserting ${uniqueFileRecords.size} unique indicator-file combinations...`);

	for (const file of uniqueFileRecords.values()) {
		const indicatorId = indicatorMap.get(file.indicator);
		if (!indicatorId) continue;

		await db.insert(indicatorFiles).values({
			indicatorId,
			refArea: file.refArea,
			year: file.year,
			filePath: file.filePath
		});
		fileCount++;
	}

	console.log(`Seeded ${fileCount} indicator files`);
	console.log('Seeding complete!');
}
