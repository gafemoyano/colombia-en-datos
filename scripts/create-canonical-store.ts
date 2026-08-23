import duckdb from 'duckdb';
import { basename, dirname, resolve, join } from 'path';
import { existsSync, readdirSync, symlinkSync, unlinkSync, mkdirSync, renameSync, rmSync } from 'fs';
import {
	EXPORTACIONES_PARQUET_BASENAME,
	exportacionesInsert
} from '../src/lib/server/contracts/exportaciones-load';

const DATA_PATH = process.env.DATA_PATH ? resolve(process.env.DATA_PATH) : resolve(process.cwd(), 'data');
const CANONICAL_PATH = process.env.CANONICAL_DUCKDB_PATH
	? resolve(process.env.CANONICAL_DUCKDB_PATH)
	: resolve(DATA_PATH, 'observations.duckdb');
const BUILD_PATH = process.env.CANONICAL_BUILD_PATH
	? resolve(process.env.CANONICAL_BUILD_PATH)
	: `${CANONICAL_PATH}.next-${Date.now()}`;
const TEMP_DIR = resolve('/tmp', 'ced-canonical-' + Date.now());

async function run() {
	console.log('[canonical] Data path:', DATA_PATH);
	console.log('[canonical] Building store at', BUILD_PATH);
	console.log('[canonical] Final store path', CANONICAL_PATH);

	if (existsSync(BUILD_PATH)) {
		unlinkSync(BUILD_PATH);
	}

	mkdirSync(dirname(BUILD_PATH), { recursive: true });
	mkdirSync(TEMP_DIR, { recursive: true });
	console.log('[canonical] Temp dir:', TEMP_DIR);

	const db = new duckdb.Database(BUILD_PATH);

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

	// Exportaciones carries its breakdown in CATEGORY, which the generic SELECT
	// below has no column for. It is loaded separately from its own contract so
	// the breakdown survives; see contracts/exportaciones-load.
	const scanned = findParquetFiles(DATA_PATH);
	const contractFiles = scanned.filter(
		(file) => basename(file) === EXPORTACIONES_PARQUET_BASENAME
	);
	const allFiles = scanned.filter((file) => basename(file) !== EXPORTACIONES_PARQUET_BASENAME);
	console.log(
		`[canonical] Found ${scanned.length} parquet files (${allFiles.length} generic, ${contractFiles.length} contract-loaded)`
	);

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
				COALESCE(
					NULLIF(GEO_LEVEL, ''),
					CASE
						WHEN REF_AREA = 'CO' THEN 'NAT'
						WHEN LENGTH(REF_AREA) = 2 THEN 'DEP'
						WHEN LENGTH(REF_AREA) = 5 THEN 'MUN'
						ELSE NULL
					END
				) as geo_level,
				COALESCE(
					NULLIF(DEPT_CODE, ''),
					CASE
						WHEN REF_AREA = 'CO' THEN '00'
						WHEN LENGTH(REF_AREA) IN (2, 5) THEN SUBSTR(REF_AREA, 1, 2)
						ELSE NULL
					END
				) as dept_code,
				COALESCE(
					NULLIF(MUNI_CODE, ''),
					CASE
						WHEN REF_AREA = 'CO' THEN '0000'
						WHEN LENGTH(REF_AREA) = 5 THEN REF_AREA
						ELSE NULL
					END
				) as muni_code,
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

	for (const filePath of contractFiles) {
		console.log('[canonical] Loading via contract:', basename(filePath));
		await new Promise<void>((res, rej) => {
			db.run(exportacionesInsert(filePath), (err: Error | null) => {
				if (err) rej(err);
				else res();
			});
		});
	}

	if (contractFiles.length > 0) {
		const countResult = await new Promise<{ count: number }[]>((res, rej) => {
			db.all('SELECT COUNT(*) as count FROM observations', (err: Error | null, rows: any) => {
				if (err) rej(err);
				else res(rows as { count: number }[]);
			});
		});
		totalRows = Number(countResult[0].count);
		console.log(`[canonical] After contract loads → ${totalRows.toLocaleString()} rows`);
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

	console.log('[canonical] Writing schema metadata...');
	await new Promise<void>((res, rej) => {
		db.run(
			'CREATE TABLE IF NOT EXISTS _meta (key VARCHAR PRIMARY KEY, value VARCHAR)',
			(err: Error | null) => {
				if (err) rej(err);
				else res();
			}
		);
	});
	await new Promise<void>((res, rej) => {
		db.run(
			"INSERT OR REPLACE INTO _meta VALUES ('schema_version', '1')",
			(err: Error | null) => {
				if (err) rej(err);
				else res();
			}
		);
	});

	// Clean up temp dir
	try {
		rmSync(TEMP_DIR, { recursive: true, force: true });
	} catch {}

	db.close();

	if (BUILD_PATH !== CANONICAL_PATH) {
		renameSync(BUILD_PATH, CANONICAL_PATH);
		console.log('[canonical] Atomically replaced', CANONICAL_PATH);
	}

	console.log(`[canonical] Done! ${totalRows.toLocaleString()} rows, ${scanned.length} files`);
}

run().catch((err) => {
	console.error('[canonical] Failed:', err);
	process.exit(1);
});
