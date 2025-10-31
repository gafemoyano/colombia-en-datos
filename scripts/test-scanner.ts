import { scanDataDirectory } from '../src/lib/server/scanner';
import { join } from 'path';

(async () => {
	console.log('Testing scanner...');
	const dataPath = join(process.cwd(), 'data');
	console.log('Scanning:', dataPath);

	const results = await scanDataDirectory(dataPath);
	const calidadVida = results.filter((r) => r.area === 'calidad_vida');

	console.log('\n=== Results ===');
	console.log('Total calidad_vida records:', calidadVida.length);
	console.log('Unique indicators:', new Set(calidadVida.map((r) => r.indicator)).size);
	console.log('Unique categories:', new Set(calidadVida.map((r) => r.category)).size);
	console.log('\nSample records:');
	console.log(JSON.stringify(calidadVida.slice(0, 3), null, 2));

	// Group by category
	const byCategory = calidadVida.reduce(
		(acc, r) => {
			if (!acc[r.category]) acc[r.category] = [];
			acc[r.category].push(r.indicator);
			return acc;
		},
		{} as Record<string, string[]>
	);

	console.log('\n=== Indicators by Category ===');
	for (const [cat, inds] of Object.entries(byCategory)) {
		console.log(`${cat}: ${new Set(inds).size} unique indicators`);
	}
})();
