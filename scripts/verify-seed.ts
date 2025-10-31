import 'dotenv/config';
import { db } from '../src/lib/db/script-client';
import { indicators, categories, areas, indicatorFiles } from '../src/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

(async () => {
	console.log('=== Verifying Seeded Data ===\n');

	const allAreas = await db.select().from(areas);
	console.log('Areas:', allAreas.map((a) => a.code).join(', '));

	const calidadVidaArea = allAreas.find((a) => a.code === 'calidad_vida');
	if (!calidadVidaArea) {
		console.log('calidad_vida area not found!');
		process.exit(1);
	}

	const cvCategories = await db
		.select()
		.from(categories)
		.where(eq(categories.areaId, calidadVidaArea.id));
	console.log('\nCalidad Vida Categories:', cvCategories.length);
	console.log('Sample categories:');
	cvCategories.slice(0, 5).forEach((c) => console.log(`  - ${c.name}`));

	const categoryIds = cvCategories.map((c) => c.id);
	const cvIndicators = await db
		.select()
		.from(indicators)
		.where(inArray(indicators.categoryId, categoryIds));
	console.log('\nCalidad Vida Indicators:', cvIndicators.length);
	console.log('Sample indicators:');
	cvIndicators.slice(0, 5).forEach((i) => console.log(`  - ${i.code} (${i.frequency})`));

	const indicatorIds = cvIndicators.map((i) => i.id);
	const cvFiles = await db
		.select()
		.from(indicatorFiles)
		.where(inArray(indicatorFiles.indicatorId, indicatorIds));
	console.log('\nCalidad Vida Indicator Files:', cvFiles.length);

	// Count unique REF_AREA values
	const refAreas = new Set(cvFiles.map((f) => f.refArea));
	console.log('Unique REF_AREA values:', refAreas.size);
	console.log('REF_AREA codes:', Array.from(refAreas).sort().join(', '));

	process.exit(0);
})();
