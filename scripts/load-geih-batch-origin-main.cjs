const duckdb = require('/app/node_modules/duckdb');
const { createClient } = require('/app/node_modules/@libsql/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AREA_CODE = 'geih';
const AREA_NAME = 'Gran Encuesta Integrada de Hogares (GEIH)';
const GROUP_CODE = 'geih_totales';
const GROUP_NAME = 'GEIH - Totales';
const SOURCE = 'GEIH';

const DEFAULT_NAMES = {
	pob_total: 'Población total',
	viviendas: 'Viviendas',
	hogares: 'Hogares',
	mean_personas_hogar: 'Promedio de personas por hogar',
	pet: 'Población en edad de trabajar',
	pea: 'Población económicamente activa',
	ocupados: 'Ocupados',
	desocupados: 'Desocupados',
	to: 'Tasa de ocupación',
	tgp: 'Tasa global de participación',
	tdsi: 'Tasa de desempleo'
};

const args = process.argv.slice(2);
const filePath = args.find((a) => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
const publish = args.includes('--publish');

if (!filePath || (!dryRun && !publish) || (dryRun && publish)) {
	console.error('Usage: node load-geih-origin-main.cjs <parquet> --dry-run|--publish');
	process.exit(1);
}

const dataPath = process.env.DATA_PATH
	? path.resolve(process.env.DATA_PATH)
	: path.resolve(process.cwd(), 'data');
const parquetPath = path.resolve(filePath);
const client = createClient({
	url: process.env.DATABASE_URL,
	authToken: process.env.TURSO_AUTH_TOKEN
});

function escape(str) {
	return String(str).replace(/'/g, "''");
}
function indicatorName(code) {
	return DEFAULT_NAMES[code] || code;
}

function runSql(sql) {
	return client.execute(sql).then((r) => ({ rows: r.rows, columns: r.columns }));
}

async function runSingle(sql) {
	const r = await runSql(sql);
	if (r.rows.length === 0) return undefined;
	const obj = {};
	r.columns.forEach((c, i) => (obj[c] = r.rows[0][i]));
	return obj;
}

function runDuckDb(database, sql, ...params) {
	return new Promise((resolve, reject) => {
		database.run(sql, ...params, (err) => (err ? reject(err) : resolve()));
	});
}

function queryDuckDb(database, sql) {
	return new Promise((resolve, reject) => {
		database.all(sql, (err, rows) => (err ? reject(err) : resolve(rows)));
	});
}

async function sha256(filepath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash('sha256');
		const s = fs.createReadStream(filepath);
		s.on('error', reject);
		s.on('data', (c) => hash.update(c));
		s.on('end', () => resolve(hash.digest('hex')));
	});
}

async function main() {
	console.log('[load-geih-origin] Parquet:', parquetPath);
	console.log('[load-geih-origin] Output:', dataPath);
	console.log('[load-geih-origin] Mode:', dryRun ? 'DRY RUN' : 'PUBLISH');
	const checksum = await sha256(parquetPath);
	console.log('[load-geih-origin] Checksum:', checksum);

	const schemaCheck = await runSql(
		"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('areas','indicator_groups','indicators','indicator_files')"
	);
	const found = new Set(schemaCheck.rows.map((r) => r[0]));
	for (const t of ['areas', 'indicator_groups', 'indicators', 'indicator_files']) {
		if (!found.has(t)) throw new Error(`Missing table: ${t}`);
	}

	const profileDb = new duckdb.Database(':memory:');
	const escaped = parquetPath.replace(/'/g, "''");
	const profileSql = `
    SELECT
      INDICADOR AS indicator_code,
      FREQ AS freq,
      REF_AREA AS ref_area,
      ANY_VALUE(UNIT) AS unit,
      ANY_VALUE(UNIT_MULT) AS unit_mult,
      ANY_VALUE(DECIMALS) AS decimals,
      ARRAY_AGG(DISTINCT YEAR ORDER BY YEAR) AS years,
      MIN(PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER))) AS period_start,
      MAX(PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER))) AS period_end
    FROM read_parquet('${escaped}')
    GROUP BY INDICADOR, FREQ, REF_AREA
    ORDER BY INDICADOR
  `;
	const slices = await queryDuckDb(profileDb, profileSql);
	console.log(`[load-geih-origin] Derived ${slices.length} slice(s)`);
	for (const s of slices) {
		console.log(
			`  - ${s.indicator_code}/${s.freq} (${s.ref_area}): ${s.years.length} years, ${s.period_start}..${s.period_end}`
		);
	}

	if (dryRun) {
		console.log('[load-geih-origin] Dry run complete.');
		profileDb.close();
		return;
	}

	let area = await runSingle(`SELECT id FROM areas WHERE code = '${escape(AREA_CODE)}' LIMIT 1`);
	if (!area) {
		await runSql(
			`INSERT INTO areas (code, name, description) VALUES ('${escape(AREA_CODE)}', '${escape(AREA_NAME)}', NULL)`
		);
		area = await runSingle(`SELECT id FROM areas WHERE code = '${escape(AREA_CODE)}' LIMIT 1`);
		console.log(`[load-geih-origin] Created area: ${AREA_CODE}`);
	} else {
		console.log(`[load-geih-origin] Using area: ${AREA_CODE}`);
	}

	let group = await runSingle(
		`SELECT id FROM indicator_groups WHERE area_id = ${area.id} AND code = '${escape(GROUP_CODE)}' LIMIT 1`
	);
	if (!group) {
		await runSql(
			`INSERT INTO indicator_groups (area_id, code, name, description) VALUES (${area.id}, '${escape(GROUP_CODE)}', '${escape(GROUP_NAME)}', NULL)`
		);
		group = await runSingle(
			`SELECT id FROM indicator_groups WHERE area_id = ${area.id} AND code = '${escape(GROUP_CODE)}' LIMIT 1`
		);
		console.log(`[load-geih-origin] Created group: ${GROUP_CODE}`);
	} else {
		console.log(`[load-geih-origin] Using group: ${GROUP_CODE}`);
	}

	const codes = slices.map((s) => `'${escape(s.indicator_code)}'`).join(',');
	const existingRows = await runSql(
		`SELECT id, code, frequency, source, unit, unit_mult, decimals FROM indicators WHERE code IN (${codes})`
	);
	const existing = new Map();
	for (const row of existingRows.rows) {
		const obj = {};
		existingRows.columns.forEach((c, i) => (obj[c] = row[i]));
		existing.set(obj.code, obj);
	}

	for (const slice of slices) {
		console.log(`[load-geih-origin] Publishing ${slice.indicator_code}/${slice.freq}...`);
		let indicator = existing.get(slice.indicator_code);
		const unit = slice.unit ? `'${escape(slice.unit)}'` : 'NULL';
		const unitMult = slice.unit_mult === null ? 'NULL' : slice.unit_mult;
		const decimals = slice.decimals === null ? 'NULL' : slice.decimals;

		if (!indicator) {
			await runSql(
				`INSERT INTO indicators (indicator_group_id, code, name, description, frequency, source, unit, unit_mult, decimals) VALUES (${group.id}, '${escape(slice.indicator_code)}', '${escape(indicatorName(slice.indicator_code))}', NULL, '${escape(slice.freq)}', '${escape(SOURCE)}', ${unit}, ${unitMult}, ${decimals})`
			);
			indicator = await runSingle(
				`SELECT id, code FROM indicators WHERE code = '${escape(slice.indicator_code)}' LIMIT 1`
			);
			console.log(`[load-geih-origin]   Created indicator: ${slice.indicator_code}`);
		} else {
			const updates = [];
			if (!indicator.frequency) updates.push(`frequency = '${escape(slice.freq)}'`);
			if (!indicator.source) updates.push(`source = '${escape(SOURCE)}'`);
			if (!indicator.unit && slice.unit) updates.push(`unit = ${unit}`);
			if (indicator.unit_mult === null && slice.unit_mult !== null)
				updates.push(`unit_mult = ${unitMult}`);
			if (indicator.decimals === null && slice.decimals !== null)
				updates.push(`decimals = ${decimals}`);
			if (updates.length) {
				await runSql(`UPDATE indicators SET ${updates.join(', ')} WHERE id = ${indicator.id}`);
				console.log(`[load-geih-origin]   Updated indicator: ${slice.indicator_code}`);
			}
		}

		await runSql(
			`DELETE FROM indicator_files WHERE indicator_id = ${indicator.id} AND ref_area = '${escape(slice.ref_area)}'`
		);
		const dir = path.join(
			dataPath,
			AREA_CODE,
			GROUP_CODE,
			'FREQ=M',
			`INDICATOR=${slice.indicator_code}`,
			'REF_AREA=CO'
		);
		if (fs.existsSync(dir)) {
			for (const f of fs.readdirSync(dir)) {
				if (f.endsWith('.parquet')) fs.unlinkSync(path.join(dir, f));
			}
		}

		for (const year of slice.years) {
			const outPath = path.join(dir, `part-${year}.parquet`);
			fs.mkdirSync(path.dirname(outPath), { recursive: true });
			const copySql = `
        COPY (
          SELECT
            INDICADOR AS INDICATOR,
            FREQ,
            REF_AREA,
            PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER)) AS TIME_PERIOD,
            OBS_VALUE,
            UNIT,
            UNIT_MULT,
            DECIMALS,
            COALESCE(OBS_STATUS, 'A') AS OBS_STATUS
          FROM read_parquet('${escaped}')
          WHERE INDICADOR = '${escape(slice.indicator_code)}'
            AND FREQ = '${escape(slice.freq)}'
            AND YEAR = ${year}
        ) TO '${outPath.replace(/'/g, "''")}' (FORMAT PARQUET)
      `;
			await runDuckDb(profileDb, copySql);
			await runSql(
				`INSERT INTO indicator_files (indicator_id, ref_area, year, file_path) VALUES (${indicator.id}, '${escape(slice.ref_area)}', ${year}, '${escape(outPath)}')`
			);
			console.log(`[load-geih-origin]   Wrote ${outPath}`);
		}
	}

	profileDb.close();
	console.log('[load-geih-origin] Done.');
}

main().catch((e) => {
	console.error('[load-geih-origin] Failed:', e);
	process.exit(1);
});
