import { and, asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { getDb } from '$lib/db/client';
import * as schema from '$lib/db/schema';
import {
	dataSources,
	dimensionDefinitions,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';

export const REQUIRED_DEFINITION_HEADERS = ['indicator_code', 'freq', 'name', 'dimensions'] as const;
export const OPTIONAL_DEFINITION_HEADERS = [
	'group_code',
	'group_name',
	'short_name',
	'description',
	'methodology',
	'source_citation',
	'unit',
	'unit_mult',
	'decimals',
	'default_viz',
	'updated'
] as const;

const ALL_DEFINITION_HEADERS = new Set<string>([
	...REQUIRED_DEFINITION_HEADERS,
	...OPTIONAL_DEFINITION_HEADERS
]);
const FREQ_PATTERN = /^[A-Z]$/;

type AppDb = LibSQLDatabase<typeof schema>;

export interface DataSourceDefinitionInput {
	code: string;
	name: string;
}

export interface SaveDefinitionsInput {
	dataSource: DataSourceDefinitionInput;
	definitionText: string;
}

export interface DefinitionValidationError {
	row: number;
	field: string;
	message: string;
}

export interface NormalizedDefinitionRow {
	rowNumber: number;
	indicatorCode: string;
	freq: string;
	name: string;
	dimensions: string[];
	groupCode: string;
	groupName: string;
	shortName: string | null;
	description: string | null;
	methodology: string | null;
	sourceCitation: string | null;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	defaultViz: string | null;
	updated: string | null;
	isExistingIndicator?: boolean;
	existingIndicatorId?: number;
}

export interface SaveDefinitionsSummary {
	dataSourceCode: string;
	dataSourceName: string;
	createdDataSource: boolean;
	createdGroups: number;
	createdIndicators: number;
	createdFrequencies: number;
	createdDimensions: number;
}

export type SaveDefinitionsResult =
	| {
			ok: true;
			dataSourceCode: string;
			summary: SaveDefinitionsSummary;
		}
	| {
			ok: false;
			dataSourceCode: string;
			errors: DefinitionValidationError[];
		};

export interface AdminDefinitionFrequency {
	indicatorCode: string;
	indicatorName: string;
	freq: string;
	dimensions: string[];
	groupCode: string;
	groupName: string;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	defaultViz: string | null;
	description: string | null;
	methodology: string | null;
	sourceCitation: string | null;
}

interface ParsedGridRow {
	rowNumber: number;
	values: Record<string, string>;
}

interface ExistingIndicatorInfo {
	id: number;
	code: string;
	dataSourceCode: string;
}

function error(row: number, field: string, message: string): DefinitionValidationError {
	return { row, field, message };
}

function optionalText(value: string | undefined): string | null {
	const trimmed = value?.trim() || '';
	return trimmed.length > 0 ? trimmed : null;
}

function parseInteger(value: string | undefined): number | null | 'invalid' {
	const trimmed = value?.trim() || '';
	if (!trimmed) return null;
	if (!/^-?\d+$/.test(trimmed)) return 'invalid';
	return Number.parseInt(trimmed, 10);
}

export function normalizeDataSourceCode(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_+/g, '_');
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
	if (delimiter === '\t') return line.split('\t');

	const cells: string[] = [];
	let current = '';
	let quoted = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];

		if (char === '"') {
			if (quoted && next === '"') {
				current += '"';
				index += 1;
			} else {
				quoted = !quoted;
			}
		} else if (char === delimiter && !quoted) {
			cells.push(current);
			current = '';
		} else {
			current += char;
		}
	}

	cells.push(current);
	return cells;
}

function parseDefinitionGrid(definitionText: string): {
	headers: string[];
	rows: ParsedGridRow[];
	errors: DefinitionValidationError[];
} {
	const normalizedText = definitionText.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
	if (!normalizedText) {
		return {
			headers: [],
			rows: [],
			errors: [error(1, 'definitions', 'Pega una tabla con encabezados y al menos una fila')]
		};
	}

	const lines = normalizedText.split('\n');
	const delimiter = lines[0].includes('\t') ? '\t' : ',';
	const headers = splitDelimitedLine(lines[0], delimiter).map((header) => header.trim());
	const normalizedHeaders = headers.map((header) => header.toLowerCase());
	const errors: DefinitionValidationError[] = [];
	const seenHeaders = new Set<string>();

	for (const header of normalizedHeaders) {
		if (!header) {
			errors.push(error(1, 'header', 'Hay un encabezado vacío'));
			continue;
		}
		if (seenHeaders.has(header)) {
			errors.push(error(1, header, `El encabezado ${header} está duplicado`));
		}
		seenHeaders.add(header);
		if (!ALL_DEFINITION_HEADERS.has(header)) {
			errors.push(error(1, header, `El encabezado ${header} no está soportado`));
		}
	}

	for (const requiredHeader of REQUIRED_DEFINITION_HEADERS) {
		if (!seenHeaders.has(requiredHeader)) {
			errors.push(error(1, requiredHeader, `Falta el encabezado requerido ${requiredHeader}`));
		}
	}

	const rows: ParsedGridRow[] = [];
	for (let index = 1; index < lines.length; index += 1) {
		const cells = splitDelimitedLine(lines[index], delimiter);
		if (cells.every((cell) => !cell.trim())) continue;

		if (cells.length > normalizedHeaders.length) {
			errors.push(
				error(index + 1, 'row', 'La fila tiene más celdas que encabezados; revisa tabuladores o comas')
			);
		}

		const values: Record<string, string> = {};
		for (let headerIndex = 0; headerIndex < normalizedHeaders.length; headerIndex += 1) {
			values[normalizedHeaders[headerIndex]] = cells[headerIndex]?.trim() || '';
		}
		rows.push({ rowNumber: index + 1, values });
	}

	if (rows.length === 0) {
		errors.push(error(2, 'definitions', 'La tabla no contiene filas de definiciones'));
	}

	return { headers: normalizedHeaders, rows, errors };
}

async function loadExistingIndicators(db: AppDb): Promise<Map<string, ExistingIndicatorInfo>> {
	const rows = await db
		.select({
			id: indicators.id,
			code: indicators.code,
			dataSourceCode: dataSources.code
		})
		.from(indicators)
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id));

	return new Map(rows.map((row) => [row.code, row]));
}

async function loadExistingFrequencyKeys(db: AppDb): Promise<Set<string>> {
	const rows = await db
		.select({ indicatorId: indicatorFrequencies.indicatorId, freq: indicatorFrequencies.freq })
		.from(indicatorFrequencies);

	return new Set(rows.map((row) => `${row.indicatorId}\u0000${row.freq}`));
}

async function loadKnownDimensionCodes(db: AppDb): Promise<Set<string>> {
	const rows = await db.select({ code: dimensionDefinitions.code }).from(dimensionDefinitions);
	return new Set(rows.map((row) => row.code.toUpperCase()));
}

function normalizeDimensions(
	value: string,
	rowNumber: number,
	knownDimensionCodes: Set<string>,
	errors: DefinitionValidationError[]
): string[] {
	if (!value.trim()) return [];
	if (value.includes(';')) {
		errors.push(error(rowNumber, 'dimensions', 'Usa comas para separar dimensiones; ; no está soportado'));
	}

	const dimensions = value
		.split(',')
		.map((dimension) => dimension.trim().toUpperCase())
		.filter(Boolean);
	const seen = new Set<string>();

	for (const dimension of dimensions) {
		if (seen.has(dimension)) {
			errors.push(error(rowNumber, 'dimensions', `La dimensión ${dimension} está repetida`));
		}
		seen.add(dimension);

		if (!knownDimensionCodes.has(dimension)) {
			errors.push(error(rowNumber, 'dimensions', `La dimensión ${dimension} no existe`));
		}
	}

	return [...seen];
}

function normalizeRows(params: {
	parsedRows: ParsedGridRow[];
	dataSourceCode: string;
	dataSourceName: string;
	knownDimensionCodes: Set<string>;
	existingIndicators: Map<string, ExistingIndicatorInfo>;
	existingFrequencyKeys: Set<string>;
	errors: DefinitionValidationError[];
}): NormalizedDefinitionRow[] {
	const normalizedRows: NormalizedDefinitionRow[] = [];
	const seenFrequencyRows = new Set<string>();
	const firstNewRowsByIndicator = new Map<string, NormalizedDefinitionRow>();

	for (const parsedRow of params.parsedRows) {
		const values = parsedRow.values;
		const indicatorCode = values.indicator_code?.trim() || '';
		const freq = values.freq?.trim().toUpperCase() || '';
		const name = values.name?.trim() || '';
		const groupCodeInput = values.group_code?.trim() || '';
		const groupCode = groupCodeInput || params.dataSourceCode;
		const groupName = values.group_name?.trim() || (groupCodeInput ? groupCode : params.dataSourceName);
		const unitMult = parseInteger(values.unit_mult);
		const decimals = parseInteger(values.decimals);

		if (!indicatorCode) {
			params.errors.push(error(parsedRow.rowNumber, 'indicator_code', 'indicator_code es obligatorio'));
		}
		if (!freq) {
			params.errors.push(error(parsedRow.rowNumber, 'freq', 'freq es obligatorio'));
		} else if (!FREQ_PATTERN.test(freq)) {
			params.errors.push(error(parsedRow.rowNumber, 'freq', 'freq debe ser una sola letra como A, M o Q'));
		}
		if (!name) {
			params.errors.push(error(parsedRow.rowNumber, 'name', 'name es obligatorio'));
		}
		if (unitMult === 'invalid') {
			params.errors.push(error(parsedRow.rowNumber, 'unit_mult', 'unit_mult debe ser un entero'));
		}
		if (decimals === 'invalid') {
			params.errors.push(error(parsedRow.rowNumber, 'decimals', 'decimals debe ser un entero'));
		}

		const dimensions = normalizeDimensions(
			values.dimensions || '',
			parsedRow.rowNumber,
			params.knownDimensionCodes,
			params.errors
		);

		if (!indicatorCode || !freq || !name || unitMult === 'invalid' || decimals === 'invalid') {
			continue;
		}

		const existingIndicator = params.existingIndicators.get(indicatorCode);
		const normalizedRow: NormalizedDefinitionRow = {
			rowNumber: parsedRow.rowNumber,
			indicatorCode,
			freq,
			name,
			dimensions,
			groupCode,
			groupName,
			shortName: optionalText(values.short_name),
			description: optionalText(values.description),
			methodology: optionalText(values.methodology),
			sourceCitation: optionalText(values.source_citation),
			unit: optionalText(values.unit),
			unitMult,
			decimals,
			defaultViz: optionalText(values.default_viz),
			updated: optionalText(values.updated),
			isExistingIndicator: Boolean(existingIndicator),
			existingIndicatorId: existingIndicator?.id
		};

		const pasteFrequencyKey = `${indicatorCode}\u0000${freq}`;
		if (seenFrequencyRows.has(pasteFrequencyKey)) {
			params.errors.push(
				error(parsedRow.rowNumber, 'freq', `La frecuencia ${indicatorCode}/${freq} está repetida en la tabla`)
			);
		}
		seenFrequencyRows.add(pasteFrequencyKey);

		if (existingIndicator && existingIndicator.dataSourceCode !== params.dataSourceCode) {
			params.errors.push(
				error(
					parsedRow.rowNumber,
					'indicator_code',
					`El indicador ${indicatorCode} ya pertenece a la fuente ${existingIndicator.dataSourceCode}`
				)
			);
		}

		if (
			existingIndicator &&
			params.existingFrequencyKeys.has(`${existingIndicator.id}\u0000${freq}`)
		) {
			params.errors.push(
				error(parsedRow.rowNumber, 'freq', `La frecuencia ${indicatorCode}/${freq} ya existe y no se puede redefinir`)
			);
		}

		if (!existingIndicator) {
			const firstRow = firstNewRowsByIndicator.get(indicatorCode);
			if (!firstRow) {
				firstNewRowsByIndicator.set(indicatorCode, normalizedRow);
			} else {
				validateSameIndicatorFields(firstRow, normalizedRow, params.errors);
			}
		}

		normalizedRows.push(normalizedRow);
	}

	return normalizedRows;
}

function validateSameIndicatorFields(
	firstRow: NormalizedDefinitionRow,
	row: NormalizedDefinitionRow,
	errors: DefinitionValidationError[]
) {
	const comparableFields: Array<keyof NormalizedDefinitionRow> = [
		'name',
		'groupCode',
		'groupName',
		'shortName',
		'description',
		'methodology',
		'sourceCitation',
		'unit',
		'unitMult',
		'decimals',
		'defaultViz',
		'updated'
	];

	for (const field of comparableFields) {
		if (firstRow[field] === row[field]) continue;
		errors.push(
			error(
				row.rowNumber,
				String(field),
				`El indicador ${row.indicatorCode} aparece en varias frecuencias; ${String(field)} debe coincidir en todas`
			)
		);
	}
}

async function validateDefinitions(
	input: SaveDefinitionsInput,
	db: AppDb
): Promise<{
	dataSourceCode: string;
	dataSourceName: string;
	rows: NormalizedDefinitionRow[];
	errors: DefinitionValidationError[];
}> {
	const dataSourceCode = normalizeDataSourceCode(input.dataSource.code);
	const dataSourceName = input.dataSource.name.trim();
	const errors: DefinitionValidationError[] = [];

	if (!dataSourceCode) {
		errors.push(error(0, 'data_source_code', 'El código de la fuente de datos es obligatorio'));
	}
	if (!dataSourceName) {
		errors.push(error(0, 'data_source_name', 'El nombre de la fuente de datos es obligatorio'));
	}

	const parsed = parseDefinitionGrid(input.definitionText);
	errors.push(...parsed.errors);
	if (errors.length > 0 || !dataSourceCode || !dataSourceName) {
		return { dataSourceCode, dataSourceName, rows: [], errors };
	}

	const [knownDimensionCodes, existingIndicators, existingFrequencyKeys] = await Promise.all([
		loadKnownDimensionCodes(db),
		loadExistingIndicators(db),
		loadExistingFrequencyKeys(db)
	]);

	const rows = normalizeRows({
		parsedRows: parsed.rows,
		dataSourceCode,
		dataSourceName,
		knownDimensionCodes,
		existingIndicators,
		existingFrequencyKeys,
		errors
	});

	return { dataSourceCode, dataSourceName, rows, errors };
}

export async function saveIndicatorDefinitionRows(
	input: SaveDefinitionsInput,
	options: { db?: AppDb } = {}
): Promise<SaveDefinitionsResult> {
	const db = options.db || getDb();
	const validation = await validateDefinitions(input, db);

	if (validation.errors.length > 0) {
		return {
			ok: false,
			dataSourceCode: validation.dataSourceCode,
			errors: validation.errors
		};
	}

	const summary = await db.transaction(async (tx) => {
		const existingDataSource = await tx
			.select({ id: dataSources.id, name: dataSources.name })
			.from(dataSources)
			.where(eq(dataSources.code, validation.dataSourceCode))
			.limit(1);

		const createdDataSource = existingDataSource.length === 0;
		const dataSource = existingDataSource[0] ??
			(
				await tx
					.insert(dataSources)
					.values({ code: validation.dataSourceCode, name: validation.dataSourceName })
					.returning({ id: dataSources.id, name: dataSources.name })
			)[0];

		const groupIds = new Map<string, number>();
		let createdGroups = 0;
		let createdIndicators = 0;
		let createdFrequencies = 0;
		let createdDimensions = 0;
		const indicatorIds = new Map<string, number>();

		for (const row of validation.rows) {
			if (row.existingIndicatorId) {
				indicatorIds.set(row.indicatorCode, row.existingIndicatorId);
				continue;
			}

			if (!groupIds.has(row.groupCode)) {
				const existingGroup = await tx
					.select({ id: indicatorGroups.id })
					.from(indicatorGroups)
					.where(
						and(
							eq(indicatorGroups.dataSourceId, dataSource.id),
							eq(indicatorGroups.code, row.groupCode)
						)
					)
					.limit(1);

				if (existingGroup[0]) {
					groupIds.set(row.groupCode, existingGroup[0].id);
				} else {
					const [createdGroup] = await tx
						.insert(indicatorGroups)
						.values({
							dataSourceId: dataSource.id,
							code: row.groupCode,
							name: row.groupName,
							sourceType: 'definition_ingest'
						})
						.returning({ id: indicatorGroups.id });
					groupIds.set(row.groupCode, createdGroup.id);
					createdGroups += 1;
				}
			}
		}

		for (const row of validation.rows) {
			if (indicatorIds.has(row.indicatorCode)) continue;

			const [createdIndicator] = await tx
				.insert(indicators)
				.values({
					indicatorGroupId: groupIds.get(row.groupCode)!,
					code: row.indicatorCode,
					name: row.name,
					shortName: row.shortName,
					description: row.description,
					methodology: row.methodology,
					sourceCitation: row.sourceCitation,
					unit: row.unit,
					unitMult: row.unitMult,
					decimals: row.decimals,
					defaultViz: row.defaultViz,
					updated: row.updated
				})
				.returning({ id: indicators.id });

			indicatorIds.set(row.indicatorCode, createdIndicator.id);
			createdIndicators += 1;
		}

		for (const row of validation.rows) {
			const indicatorId = indicatorIds.get(row.indicatorCode)!;
			await tx.insert(indicatorFrequencies).values({ indicatorId, freq: row.freq });
			createdFrequencies += 1;

			if (row.dimensions.length > 0) {
				await tx.insert(indicatorDimensions).values(
					row.dimensions.map((dimensionCode) => ({
						indicatorId,
						freq: row.freq,
						dimensionCode,
						isFilterable: true,
						isSplitable: true
					}))
				);
				createdDimensions += row.dimensions.length;
			}
		}

		return {
			dataSourceCode: validation.dataSourceCode,
			dataSourceName: dataSource.name,
			createdDataSource,
			createdGroups,
			createdIndicators,
			createdFrequencies,
			createdDimensions
		};
	});

	return {
		ok: true,
		dataSourceCode: validation.dataSourceCode,
		summary
	};
}

export async function listAdminDefinitionFrequencies(
	dataSourceCode: string,
	options: { db?: AppDb } = {}
): Promise<AdminDefinitionFrequency[]> {
	const db = options.db || getDb();
	const normalizedCode = normalizeDataSourceCode(dataSourceCode);
	if (!normalizedCode) return [];

	const rows = await db
		.select({
			indicatorCode: indicators.code,
			indicatorName: indicators.name,
			freq: indicatorFrequencies.freq,
			dimensionId: indicatorDimensions.id,
			dimensionCode: indicatorDimensions.dimensionCode,
			groupCode: indicatorGroups.code,
			groupName: indicatorGroups.name,
			unit: indicators.unit,
			unitMult: indicators.unitMult,
			decimals: indicators.decimals,
			defaultViz: indicators.defaultViz,
			description: indicators.description,
			methodology: indicators.methodology,
			sourceCitation: indicators.sourceCitation
		})
		.from(indicatorFrequencies)
		.innerJoin(indicators, eq(indicatorFrequencies.indicatorId, indicators.id))
		.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
		.innerJoin(dataSources, eq(indicatorGroups.dataSourceId, dataSources.id))
		.leftJoin(
			indicatorDimensions,
			and(
				eq(indicatorDimensions.indicatorId, indicators.id),
				eq(indicatorDimensions.freq, indicatorFrequencies.freq)
			)
		)
		.where(eq(dataSources.code, normalizedCode))
		.orderBy(
			asc(indicatorGroups.name),
			asc(indicators.code),
			asc(indicatorFrequencies.freq),
			asc(indicatorDimensions.id)
		);

	const byFrequency = new Map<string, AdminDefinitionFrequency>();
	for (const row of rows) {
		const key = `${row.indicatorCode}\u0000${row.freq}`;
		const current = byFrequency.get(key) || {
			indicatorCode: row.indicatorCode,
			indicatorName: row.indicatorName,
			freq: row.freq,
			dimensions: [],
			groupCode: row.groupCode,
			groupName: row.groupName,
			unit: row.unit,
			unitMult: row.unitMult,
			decimals: row.decimals,
			defaultViz: row.defaultViz,
			description: row.description,
			methodology: row.methodology,
			sourceCitation: row.sourceCitation
		};
		if (row.dimensionCode && !current.dimensions.includes(row.dimensionCode)) {
			current.dimensions.push(row.dimensionCode);
		}
		byFrequency.set(key, current);
	}

	return Array.from(byFrequency.values()).sort(
		(a, b) =>
			a.groupName.localeCompare(b.groupName) ||
			a.indicatorCode.localeCompare(b.indicatorCode) ||
			a.freq.localeCompare(b.freq)
	);
}
