import { db } from '../src/lib/db/script-client';
import { indicators, indicatorFiles } from '../src/lib/db/schema';
import { eq } from 'drizzle-orm';

async function run() {
	const rows = await db
		.select({
			code: indicators.code,
			freq: indicators.frequency,
			filePath: indicatorFiles.filePath
		})
		.from(indicators)
		.innerJoin(indicatorFiles, eq(indicators.id, indicatorFiles.indicatorId));

	const pathFreqs = new Map<string, Set<string>>();
	for (const r of rows) {
		if (!pathFreqs.has(r.code)) pathFreqs.set(r.code, new Set());
		const m = r.filePath.match(/FREQ=([MAQD])/);
		if (m) pathFreqs.get(r.code)!.add(m[1]);
	}

	const multiPath = [...pathFreqs.entries()].filter(([_, v]) => v.size > 1);
	console.log('Multi-frequency from paths:', multiPath.length);
	for (const [code, freqs] of multiPath.slice(0, 20)) {
		console.log('  ', code, [...freqs]);
	}

	if (multiPath.length === 0) {
		console.log('All indicators have single frequency in file paths.');
	}
}

run().catch(console.error);
