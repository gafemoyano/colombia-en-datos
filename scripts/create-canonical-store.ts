import duckdb from 'duckdb';
import { resolve, join } from 'path';
import { existsSync, readdirSync, statSync, symlinkSync, unlinkSync, mkdirSync } from 'fs';

const DATA_PATH = resolve(process.cwd(), 'data');
const CANONICAL_PATH = resolve(process.cwd(), 'data', 'observations.duckdb');
const TEMP_DIR = resolve('/tmp', 'ced-canonical-' + Date.now());

async function run() {
	console.log('[canonical] Creating store at', CANONICAL_PATH);

	if (existsSync(CANONICAL_PATH)) {
		unlinkSync(CANONICAL_PATH);
	}

	mkdirSync(TEMP_DIR, { recursive: true });
	console.log('[canonical] Temp dir:', TEMP_DIR);

	const db = new duckdb.Database(CANONICAL_PATH);

	const createTable = `
		CREATE TABLE observations (
			indicator_code VARCHAR NOT NULL,
			freq VARCHAR NOT NULL,
			ref_area VARCHAR NOT NULL DEFAULT 'CO',
			time_period VARCHAR NOT NULL,
			obs_value DOUBLE,
			geo_level VARCHAR,
			dept_code VARCHAR,
			muni_code VARCHAR,
			urban_rural VARCHAR,
			sex VARCHAR,
			age VARCHAR,
			adjustment VARCHAR,
			ext_1 VARCHAR,
			ext_2 VARCHAR,
			ext_3 VARCHAR,
			obs_status VARCHAR DEFAULT 'A'
		)
	`;

	await new Promise<void>((res, rej) => {
		db.run(createTable, (err: Error | null) => {
			if (err) rej(err);
			else res();
		});
	});

	console.log('[canonical] Table created');

	function findParquetFiles(dir: string): string[] {
		const entries = readdirSync(dir, { withFileTypes: true });
		const files: string[] = [];
		for (const entry of entries) {
			if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
			const full = resolve(dir, entry.name);
			if (entry.isDirectory()) {
				files.push(...findParquetFiles(full));
			} else if (entry.name.endsWith('.parquet')) {
				files.push(full);
			}
		}
		return files;
	}

	const allFiles = findParquetFiles(DATA_PATH);
	console.log(`[canonical] Found ${allFiles.length} parquet files`);

	let totalRows = 0;
	let processed = 0;
	const BATCH_SIZE = 100;

	for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
		const batch = allFiles.slice(i, i + BATCH_SIZE);

		for (let j = 0; j < batch.length; j++) {
			const filePath = batch[j];
			const tempPath = join(TEMP_DIR, `batch-${i}-file-${j}.parquet`);

			try {
				symlinkSync(filePath, tempPath);
			} catch {
				// Symlink already exists or other error
			}
		}

		// Insert entire batch at once using read_parquet on temp dir
		const tempPaths = batch.map((_, j) => join(TEMP_DIR, `batch-${i}-file-${j}.parquet`).replace(/'/g, "''"));
		const glob = tempPaths.join("', '");

		const insertQuery = `
			INSERT INTO observations (
				indicator_code, freq, ref_area, time_period, obs_value,
				geo_level, dept_code, muni_code, urban_rural, sex, age, adjustment,
				ext_1, ext_2, ext_3, obs_status
			)
			SELECT
				INDICATOR as indicator_code,
				FREQ as freq,
				REF_AREA as ref_area,
				TIME_PERIOD as time_period,
				OBS_VALUE as obs_value,
				GEO_LEVEL as geo_level,
				DEPT_CODE as dept_code,
				MUNI_CODE as muni_code,
				URBAN_RURAL as urban_rural,
				SEX as sex,
				AGE as age,
				ADJUSTMENT as adjustment,
				NULL as ext_1,
				NULL as ext_2,
				NULL as ext_3,
				COALESCE(OBS_STATUS, 'A') as obs_status
			FROM read_parquet(['${glob}'])
		`;

		try {
			await new Promise<void>((res, rej) => {
				db.run(insertQuery, (err: Error | null) => {
					if (err) rej(err);
					else res();
				});
			});
		} catch (e: any) {
			console.warn(`[canonical] Batch ${i} failed:`, e.message.slice(0, 100));
			// Fallback: insert one by one
			for (let j = 0; j < batch.length; j++) {
				const tempPath = join(TEMP_DIR, `batch-${i}-file-${j}.parquet`).replace(/'/g, "''");
				const singleQuery = insertQuery.replace(`read_parquet(['${glob}'])`, `read_parquet('${tempPath}')`);
				try {
					await new Promise<void>((res, rej) => {
						db.run(singleQuery, (err: Error | null) => {
							if (err) rej(err);
							else res();
						});
					});
				} catch {
					// Skip
				}
			}
		}

		// Clean up symlinks
		for (let j = 0; j < batch.length; j++) {
			const tempPath = join(TEMP_DIR, `batch-${i}-file-${j}.parquet`);
			try { unlinkSync(tempPath); } catch {}
		}

		processed += batch.length;
		if (processed % 1000 === 0 || processed === allFiles.length) {
			const countResult = await new Promise<{ count: number }[]>((res, rej) => {
				db.all('SELECT COUNT(*) as count FROM observations', (err: Error | null, rows: any) => {
					if (err) rej(err);
					else res(rows as { count: number }[]);
				});
			});
			totalRows = Number(countResult[0].count);
			console.log(`[canonical] Processed ${processed}/${allFiles.length} → ${totalRows.toLocaleString()} rows`);
		}
	}

	console.log('[canonical] Creating indexes...');
	await new Promise<void>((res, rej) => {
		db.run(
			'CREATE INDEX idx_obs_indicator_freq ON observations(indicator_code, freq, ref_area)',
			(err: Error | null) => {
				if (err) rej(err);
				else res();
			}
		);
	});
	await new Promise<void>((res, rej) => {
		db.run(
			'CREATE INDEX idx_obs_time ON observations(time_period)',
			(err: Error | null) => {
				if (err) rej(err);
				else res();
			}
		);
	});

	// Clean up temp dir
	try {
		import('fs').then(({ rmdirSync }) => rmdirSync(TEMP_DIR));
	} catch {}

	console.log(`[canonical] Done! ${totalRows.toLocaleString()} rows, ${allFiles.length} files`);
	db.close();
}

run().catch((err) => {
	console.error('[canonical] Failed:', err);
	process.exit(1);
});
