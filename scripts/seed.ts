import 'dotenv/config';
import { seedIndicators } from '../src/lib/server/seed-indicators';
import { join } from 'path';

const dataPath = process.env.DATA_PATH ? process.env.DATA_PATH : join(process.cwd(), 'data');

console.log('Starting indicator seeding...');
console.log('Data path:', dataPath);
seedIndicators(dataPath)
	.then(() => {
		console.log('Seeding completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Seeding failed:', error);
		process.exit(1);
	});
