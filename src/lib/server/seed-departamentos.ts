import { db } from '$lib/db/script-client';
import { departamentos } from '$lib/db/schema';
import { readFileSync } from 'fs';
import { join } from 'path';

export async function seedDepartamentos() {
	console.log('Seeding departamentos...');

	const csvPath = join(process.cwd(), 'static', 'departamentos.csv');
	const csvContent = readFileSync(csvPath, 'utf-8');

	const lines = csvContent.split('\n').filter((line) => line.trim());
	// Skip header
	const dataLines = lines.slice(1);

	let count = 0;
	for (const line of dataLines) {
		const [code, name] = line.split(';').map((s) => s.trim());
		if (!code || !name) continue;

		await db.insert(departamentos).values({ code, name }).onConflictDoNothing({ target: departamentos.code });

		count++;
		console.log(`Seeded: ${code} - ${name}`);
	}

	console.log(`Seeded ${count} departamentos`);
}
