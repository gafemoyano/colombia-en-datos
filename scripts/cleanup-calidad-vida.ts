import 'dotenv/config';
import { db } from '../src/lib/db/script-client';
import { dataSources, indicatorGroups, indicators, indicatorFiles } from '../src/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

(async () => {
	console.log('=== Cleaning up old calidad_vida data ===\n');

	// Find calidad_vida data source
	const calidadVidaDataSource = await db
		.select()
		.from(dataSources)
		.where(eq(dataSources.code, 'calidad_vida'))
		.limit(1);

	if (calidadVidaDataSource.length === 0) {
		console.log('No calidad_vida data source found - nothing to clean up');
		process.exit(0);
	}

	const dataSourceId = calidadVidaDataSource[0].id;
	console.log(`Found calidad_vida data source (ID: ${dataSourceId})`);

	// Get all indicator groups for this data source
	const cvGroups = await db
		.select()
		.from(indicatorGroups)
		.where(eq(indicatorGroups.dataSourceId, dataSourceId));

	console.log(`Found ${cvGroups.length} indicator groups to delete`);

	if (cvGroups.length === 0) {
		console.log('No indicator groups to clean up');
		process.exit(0);
	}

	const groupIds = cvGroups.map((c) => c.id);

	// Get all indicators for these groups
	const cvIndicators = await db
		.select()
		.from(indicators)
		.where(inArray(indicators.indicatorGroupId, groupIds));

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
			.where(inArray(indicators.indicatorGroupId, groupIds))
			.returning();

		console.log(`✓ Deleted ${deletedIndicators.length} indicators`);
	}

	// Delete indicator groups
	const deletedGroups = await db
		.delete(indicatorGroups)
		.where(eq(indicatorGroups.dataSourceId, dataSourceId))
		.returning();

	console.log(`✓ Deleted ${deletedGroups.length} indicator groups`);

	console.log('\n=== Cleanup complete! ===');
	console.log('Data source "calidad_vida" kept for reuse');
	console.log('Departamentos table kept intact');
	console.log('Ready for fresh data load!');

	process.exit(0);
})();
