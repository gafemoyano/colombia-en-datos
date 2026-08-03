const duckdb = require('/app/node_modules/duckdb');
const { createClient } = require('/app/node_modules/@libsql/client');
const fs = require('fs');
const crypto = require('crypto');

const SOURCE_PARQUET = '/data/geih_2021_2026_arq_ok_v2.parquet';
const CANONICAL_DUCKDB = '/data/observations.duckdb';
const GROUP_CODE = 'geih_totales';

const DIMENSION_DEFAULTS = {
	GEO_LEVEL: { default_value: 'NAT', is_filterable: 1, is_splitable: 1 },
	DEPT_CODE: { default_value: '00', is_filterable: 1, is_splitable: 1 },
	MUNI_CODE: { default_value: '0000', is_filterable: 1, is_splitable: 1 },
	URBAN_RURAL: { default_value: 'T', is_filterable: 1, is_splitable: 1 },
	SEX: { default_value: 'T', is_filterable: 1, is_splitable: 1 },
	AGE: { default_value: 'TOTAL', is_filterable: 1, is_splitable: 1 },
	ADJUSTMENT: { default_value: 'NSA', is_filterable: 1, is_splitable: 1 }
};

async function runSqlite(sql, params = []) {
	console.log(`[SQLite] ${sql.trim().substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
	return sqliteClient.execute({ sql, args: params });
}

function runDuckdbAll(db, sql) {
	return new Promise((resolve, reject) => {
		db.all(sql, (err, rows) => {
			if (err) reject(err);
			else resolve(rows.map((row) => Object.values(row)));
		});
	});
}

function runDuckdbExec(db, sql) {
	return new Promise((resolve, reject) => {
		db.exec(sql, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}

async function main() {
	console.log('=== GEIH canonical load started ===');
	console.log('Source:', SOURCE_PARQUET);
	console.log('Canonical DB:', CANONICAL_DUCKDB);

	if (!fs.existsSync(SOURCE_PARQUET)) {
		throw new Error(`Source parquet not found: ${SOURCE_PARQUET}`);
	}
	if (!fs.existsSync(CANONICAL_DUCKDB)) {
		throw new Error(`Canonical DB not found: ${CANONICAL_DUCKDB}`);
	}

	global.sqliteClient = createClient({
		url: process.env.DATABASE_URL,
		authToken: process.env.TURSO_AUTH_TOKEN
	});

	const indicatorRows = (
		await runSqlite(
			`
		SELECT i.id, i.code, i.name, i.frequency
		FROM indicators i
		JOIN indicator_groups g ON i.indicator_group_id = g.id
		WHERE g.code = ?
		ORDER BY i.code
	`,
			[GROUP_CODE]
		)
	).rows;
	console.log(`Found ${indicatorRows.length} GEIH indicators in SQLite`);
	if (indicatorRows.length === 0) {
		throw new Error('No GEIH indicators found in SQLite');
	}
	const indicatorIds = indicatorRows.map((r) => Number(r[0]));
	const indicatorCodeToId = new Map(indicatorRows.map((r) => [r[1], Number(r[0])]));
	const indicatorCodes = Array.from(indicatorCodeToId.keys());
	const indicatorCodesSql = indicatorCodes.map((c) => `'${c}'`).join(',');

	console.log('Connecting to canonical DuckDB...');
	const db = new duckdb.Database(CANONICAL_DUCKDB);
	const tableRows = await runDuckdbAll(
		db,
		"SELECT name FROM sqlite_master WHERE type='table' AND name='observations'"
	);
	if (tableRows.length === 0) {
		throw new Error('observations table does not exist in canonical DuckDB');
	}
	console.log('observations table exists');

	console.log('Deleting existing GEIH observations...');
	const deleteObsSql = `DELETE FROM observations WHERE indicator_code IN (${indicatorCodesSql})`;
	await runDuckdbExec(db, deleteObsSql);
	const remainingCount = (await runDuckdbAll(db, 'SELECT COUNT(*) FROM observations'))[0][0];
	console.log('Remaining total observations:', remainingCount);

	console.log('Loading observations from source parquet...');
	const insertSql = `
		INSERT INTO observations (
			indicator_code, freq, ref_area, time_period, obs_value,
			geo_level, dept_code, muni_code, urban_rural, sex, age, adjustment,
			ext_1, ext_2, ext_3, obs_status
		)
		SELECT
			INDICADOR AS indicator_code,
			FREQ AS freq,
			REF_AREA AS ref_area,
			PRINTF('%04d-%02d', CAST(SPLIT_PART(TIME_PERIOD, '-', 2) AS INTEGER), CAST(SPLIT_PART(TIME_PERIOD, '-', 1) AS INTEGER)) AS time_period,
			OBS_VALUE AS obs_value,
			GEO_LEVEL AS geo_level,
			DEPT_CODE AS dept_code,
			MUNI_CODE AS muni_code,
			URBAN_RURAL AS urban_rural,
			SEX AS sex,
			AGE AS age,
			ADJUSTEMENT AS adjustment,
			NULL AS ext_1,
			NULL AS ext_2,
			NULL AS ext_3,
			OBS_STATUS AS obs_status
		FROM read_parquet('${SOURCE_PARQUET}')
	`;
	await runDuckdbExec(db, insertSql);
	const insertedCount = (
		await runDuckdbAll(
			db,
			`SELECT COUNT(*) FROM observations WHERE indicator_code IN (${indicatorCodesSql})`
		)
	)[0][0];
	console.log('Inserted GEIH observations:', insertedCount);

	await new Promise((resolve, reject) => {
		db.close((err) => {
			if (err) reject(err);
			else resolve();
		});
	});
	console.log('Canonical DuckDB updated and closed.');

	console.log('Registering indicator_dimensions...');
	await runSqlite(`DELETE FROM indicator_dimensions WHERE indicator_id IN (${indicatorIds.join(',')})`);
	for (const row of indicatorRows) {
		const indicatorId = Number(row[0]);
		const frequency = row[2];
		for (const [dimCode, cfg] of Object.entries(DIMENSION_DEFAULTS)) {
			await runSqlite(
				`INSERT INTO indicator_dimensions (indicator_id, freq, dimension_code, default_value, is_filterable, is_splitable) VALUES (?, ?, ?, ?, ?, ?)`,
				[indicatorId, frequency, dimCode, cfg.default_value, cfg.is_filterable, cfg.is_splitable]
			);
		}
	}
	console.log('Registered dimensions for', indicatorRows.length, 'indicators');

	console.log('Creating data_releases and indicator_data_sources...');
	await runSqlite(`DELETE FROM data_releases WHERE indicator_id IN (${indicatorIds.join(',')})`);
	await runSqlite(`DELETE FROM indicator_data_sources WHERE indicator_id IN (${indicatorIds.join(',')})`);

	const rowsPerIndicator = Math.floor(Number(insertedCount) / indicatorRows.length);
	const periodStart = '2010-01';
	const periodEnd = '2026-03';
	const yearMin = 2010;
	const yearMax = 2026;

	for (const row of indicatorRows) {
		const indicatorId = Number(row[0]);
		const code = row[1];
		const frequency = row[2];
		const refArea = 'CO';
		const checksum = crypto.createHash('sha256').update(`${SOURCE_PARQUET}-${code}`).digest('hex');

		const releaseRes = await runSqlite(
			`INSERT INTO data_releases (indicator_id, release_date, period_start, period_end, row_count, source_format, source_name, uploaded_by, status, checksum) VALUES (?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				indicatorId,
				periodStart,
				periodEnd,
				rowsPerIndicator,
				'PARQUET',
				'GEIH Armonizadas',
				'load-geih-canonical',
				'published',
				checksum
			]
		);
		const releaseId = Number(releaseRes.lastInsertRowid);

		await runSqlite(
			`INSERT INTO indicator_data_sources (indicator_id, ref_area, freq, year_min, year_max, row_count, release_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[indicatorId, refArea, frequency, yearMin, yearMax, rowsPerIndicator, releaseId]
		);
		console.log(`  ${code}: release_id=${releaseId}, rows=${rowsPerIndicator}`);
	}

	console.log('=== GEIH canonical load completed successfully ===');
	process.exit(0);
}

main().catch((err) => {
	console.error('FATAL:', err);
	process.exit(1);
});
