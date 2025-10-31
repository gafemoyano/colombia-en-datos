import 'dotenv/config';
import { seedDepartamentos } from '../src/lib/server/seed-departamentos';

console.log('Starting departamentos seeding...');
seedDepartamentos()
	.then(() => {
		console.log('Departamentos seeding completed successfully');
		process.exit(0);
	})
	.catch((error) => {
		console.error('Departamentos seeding failed:', error);
		process.exit(1);
	});
