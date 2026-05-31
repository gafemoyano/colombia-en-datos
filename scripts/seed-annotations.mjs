import { createClient } from '@libsql/client';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL environment variable is not set');

const db = createClient({
	url: databaseUrl,
	authToken: process.env.TURSO_AUTH_TOKEN
});

const AREA_DISPLAY_NAMES = {
	empleo: 'Empleo',
	emicron: 'Empresas (EMICRON)',
	calidad_vida: 'Calidad de vida'
};

const SME_SUFFIX_LABELS = {
	TOTAL: 'Total de micronegocios',
	PATRON: 'Micronegocios de empleadores',
	CTA_PROP: 'Micronegocios de trabajadores por cuenta propia',
	MALE: 'Micronegocios liderados por hombres',
	FEMALE: 'Micronegocios liderados por mujeres',
	STARTED_ALONE: 'Micronegocios iniciados en solitario',
	STARTED_WITH_FAMILY: 'Micronegocios iniciados con familiares',
	STARTED_WITH_OTHERS: 'Micronegocios iniciados con otras personas',
	STARTED_BY_OTHER_PEOPLE: 'Micronegocios iniciados por otras personas',
	STARTED_BY_FAMILY: 'Micronegocios iniciados por familiares',
	STARTED_BY_OTHERS: 'Micronegocios iniciados por terceros',
	PRIMARYSOURCE_SAVINGS: 'Micronegocios cuya fuente principal de recursos fueron ahorros',
	PRIMARYSOURCE_FAMILYLOAN:
		'Micronegocios cuya fuente principal de recursos fue un préstamo familiar',
	PRIMARYSOURCE_BANKLOAN:
		'Micronegocios cuya fuente principal de recursos fue un préstamo bancario',
	PRIMARYSOURCE_SHARKLOAN:
		'Micronegocios cuya fuente principal de recursos fue un préstamo gota a gota',
	PRIMARYSOURCE_SEED: 'Micronegocios cuya fuente principal de recursos fue capital semilla',
	PRIMARYSOURCE_NONEED: 'Micronegocios que no necesitaron recursos para iniciar',
	PRIMARYSOURCE_DONTKNOW: 'Micronegocios sin información sobre la fuente principal de recursos',
	PRIMARYSOURCE_OTHER: 'Micronegocios con otra fuente principal de recursos',
	REASON_NO_OTHER_INCOME: 'Micronegocios creados por no tener otra fuente de ingresos',
	REASON_OPPORTUNITY: 'Micronegocios creados por oportunidad de negocio',
	REASON_TRADITION: 'Micronegocios creados por tradición familiar',
	REASON_COMPLEMENT_INCOME: 'Micronegocios creados para complementar ingresos',
	REASON_CAREER: 'Micronegocios creados por ejercer oficio o carrera',
	REASON_LOW_EMPLOYABILITY: 'Micronegocios creados por baja empleabilidad',
	REASON_OTHER: 'Micronegocios creados por otra razón'
};

function normalizeCode(value) {
	return String(value || '')
		.replace(/^"|"$/g, '')
		.trim();
}

function cleanTitle(value) {
	const normalized = normalizeCode(value);
	return normalized.length > 0 ? normalized : null;
}

function normalizeMachineText(value) {
	return normalizeCode(value)
		.toLowerCase()
		.replace(/[^a-z0-9áéíóúñ]+/gi, ' ')
		.trim();
}

function isRawTitle(code, title) {
	if (!title) return true;
	return normalizeMachineText(title) === normalizeMachineText(code) || title.includes('_');
}

function titleCaseSpanish(value) {
	const lowerWords = new Set([
		'a',
		'al',
		'con',
		'de',
		'del',
		'el',
		'en',
		'la',
		'las',
		'los',
		'o',
		'por',
		'y'
	]);
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((word, index) => {
			const lower = word.toLowerCase();
			if (index > 0 && lowerWords.has(lower)) return lower;
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join(' ');
}

function fallbackName(code) {
	if (/^[A-Z0-9]+$/.test(code)) return code;
	if (code.startsWith('NUM_SME_')) {
		const suffix = code.replace('NUM_SME_', '');
		return (
			SME_SUFFIX_LABELS[suffix] || titleCaseSpanish(`Micronegocios ${suffix.replace(/_/g, ' ')}`)
		);
	}
	return titleCaseSpanish(code.replace(/_/g, ' '));
}

function loadCatalog() {
	const candidatePaths = [
		join(process.env.DATA_PATH || '', 'metadata', 'metadata_with_collections.json'),
		join(process.cwd(), 'data', 'metadata', 'metadata_with_collections.json')
	].filter(Boolean);
	const metadataPath = candidatePaths.find((path) => existsSync(path));
	if (!metadataPath)
		throw new Error(`metadata_with_collections.json not found in ${candidatePaths.join(', ')}`);
	console.log('Loading metadata catalog:', metadataPath);
	return JSON.parse(readFileSync(metadataPath, 'utf-8'));
}

function buildMetadataIndex(catalog) {
	const result = new Map();
	for (const [code, indicator] of Object.entries(catalog.indicators || {})) {
		const normalizedCode = normalizeCode(code);
		const existing = result.get(normalizedCode);
		if (
			existing &&
			!isRawTitle(normalizedCode, existing.title) &&
			isRawTitle(normalizedCode, indicator.title)
		)
			continue;
		result.set(normalizedCode, indicator);
	}
	return result;
}

const catalog = loadCatalog();
const metadataByCode = buildMetadataIndex(catalog);

for (const [code, name] of Object.entries(AREA_DISPLAY_NAMES)) {
	await db.execute({ sql: 'UPDATE data_sources SET name = ? WHERE code = ?', args: [name, code] });
}

const result = await db.execute(
	'SELECT id, code, name, methodology, source_citation, unit, unit_mult, decimals, default_viz, updated FROM indicators'
);
let updatedCount = 0;

for (const indicator of result.rows) {
	const metadata = metadataByCode.get(indicator.code);
	const metadataTitle = cleanTitle(metadata?.title);
	const nextName =
		metadataTitle && metadataTitle !== indicator.code
			? metadataTitle
			: fallbackName(indicator.code);

	const patch = {};
	if (isRawTitle(indicator.code, indicator.name)) patch.name = nextName;
	if (!indicator.methodology && metadata?.methodology) patch.methodology = metadata.methodology;
	if (!indicator.source_citation && metadata?.source) patch.source_citation = metadata.source;
	if (!indicator.unit && metadata?.unit) patch.unit = metadata.unit;
	if (indicator.unit_mult === null && metadata?.unit_mult !== undefined)
		patch.unit_mult = metadata.unit_mult;
	if (indicator.decimals === null && metadata?.decimals !== undefined)
		patch.decimals = metadata.decimals;
	if (!indicator.default_viz && metadata?.default_viz) patch.default_viz = metadata.default_viz;
	if (!indicator.updated && metadata?.updated) patch.updated = metadata.updated;

	const entries = Object.entries(patch);
	if (entries.length === 0) continue;

	await db.execute({
		sql: `UPDATE indicators SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE id = ?`,
		args: [...entries.map(([, value]) => value), indicator.id]
	});
	updatedCount++;
}

console.log(`Updated annotation fields for ${updatedCount} indicators`);
