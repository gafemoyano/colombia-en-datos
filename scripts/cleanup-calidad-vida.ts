import 'dotenv/config';
import { db } from '../src/lib/db/script-client';
import { areas, categories, indicators, indicatorFiles } from '../src/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

(async () => {
	console.log('=== Cleaning up old calidad_vida data ===\n');

	// Find calidad_vida area
	const calidadVidaArea = await db
		.select()
		.from(areas)
		.where(eq(areas.code, 'calidad_vida'))
		.limit(1);

	if (calidadVidaArea.length === 0) {
		console.log('No calidad_vida area found - nothing to clean up');
		process.exit(0);
	}

	const areaId = calidadVidaArea[0].id;
	console.log(`Found calidad_vida area (ID: ${areaId})`);

	// Get all categories for this area
	const cvCategories = await db.select().from(categories).where(eq(categories.areaId, areaId));

	console.log(`Found ${cvCategories.length} categories to delete`);

	if (cvCategories.length === 0) {
		console.log('No categories to clean up');
		process.exit(0);
	}

	const categoryIds = cvCategories.map((c) => c.id);

	// Get all indicators for these categories
	const cvIndicators = await db
		.select()
		.from(indicators)
		.where(inArray(indicators.categoryId, categoryIds));

	console.log(`Found ${cvIndicators.length} indicators to delete`);

	if (cvIndicators.length > 0) {
		const indicatorIds = cvIndicators.map((i) => i.id);

		// Delete indicator files first (foreign key constraint)
		const deletedFiles = await db
			.delete(indicatorFiles)
			.where(inArray(indicatorFiles.indicatorId, indicatorIds))
			.returning();

		console.log(`✓ Deleted ${deletedFiles.length} indicator files`);

		// Delete indicators
		const deletedIndicators = await db
			.delete(indicators)
			.where(inArray(indicators.categoryId, categoryIds))
			.returning();

		console.log(`✓ Deleted ${deletedIndicators.length} indicators`);
	}

	// Delete categories
	const deletedCategories = await db
		.delete(categories)
		.where(eq(categories.areaId, areaId))
		.returning();

	console.log(`✓ Deleted ${deletedCategories.length} categories`);

	console.log('\n=== Cleanup complete! ===');
	console.log('Area "calidad_vida" kept for reuse');
	console.log('Departamentos table kept intact');
	console.log('Ready for fresh data load!');

	process.exit(0);
})();
