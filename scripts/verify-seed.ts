import 'dotenv/config';
import { db } from '../src/lib/db/script-client';
import { indicators, indicatorGroups, dataSources, indicatorFiles } from '../src/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

(async () => {
	console.log('=== Verifying Seeded Data ===\n');

	const allDataSources = await db.select().from(dataSources);
	console.log('Data sources:', allDataSources.map((a) => a.code).join(', '));

	const calidadVidaDataSource = allDataSources.find((a) => a.code === 'calidad_vida');
	if (!calidadVidaDataSource) {
		console.log('calidad_vida data source not found!');
		process.exit(1);
	}

	const cvGroups = await db
		.select()
		.from(indicatorGroups)
		.where(eq(indicatorGroups.dataSourceId, calidadVidaDataSource.id));
	console.log('\nCalidad Vida Indicator groups:', cvGroups.length);
	console.log('Sample indicator groups:');
	cvGroups.slice(0, 5).forEach((c) => console.log(`  - ${c.name}`));

	const groupIds = cvGroups.map((c) => c.id);
	const cvIndicators = await db
		.select()
		.from(indicators)
		.where(inArray(indicators.indicatorGroupId, groupIds));
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
