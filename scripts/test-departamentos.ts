import 'dotenv/config';
import { db } from '../src/lib/db/script-client';
import { departamentos } from '../src/lib/db/schema';

(async () => {
	console.log('Testing departamentos table...\n');

	const deps = await db.select().from(departamentos).orderBy(departamentos.name).limit(10);

	console.log(`Found ${deps.length} departamentos (showing first 10):`);
	console.table(deps.map((d) => ({ code: d.code, name: d.name })));

	console.log('\n✅ Departamentos table is working correctly!');
	process.exit(0);
})();
