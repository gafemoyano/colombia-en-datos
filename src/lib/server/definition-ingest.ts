import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/db/client';
import {
	areas,
	dimensionDefinitions,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import { normalizeDataSourceCode } from '$lib/ingest/definitions';

export const REQUIRED_DEFINITION_HEADERS = [
	'indicator_code',
	'freq',
	'name',
	'dimensions'
] as const;

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

const SUPPORTED_HEADERS = new Set<string>([
	...REQUIRED_DEFINITION_HEADERS,
	...OPTIONAL_DEFINITION_HEADERS
]);

export interface DefinitionValidationError {
	rowNumber: number;
	field: string;
	message: string;
}

export interface ParsedDefinitionRow {
	rowNumber: number;
	indicatorCode: string;
	freq: string;
	name: string;
	dimensions: string[];
	values: Record<string, string>;
}

export interface DefinitionValidationResult {
	valid: boolean;
	errors: DefinitionValidationError[];
	rows: ParsedDefinitionRow[];
	dataSource: {
		code: string;
		name: string;
	};
	headers: string[];
}

export interface ValidateDefinitionPasteInput {
	dataSource: {
		code: string;
		name: string;
	};
	definitionText: string;
	knownDimensionCodes: string[];
}

export interface SaveDefinitionGridInput {
	dataSource: {
		code: string;
		name: string;
	};
	definitionText: string;
}

export interface SaveDefinitionGridResult {
	ok: boolean;
	validation: DefinitionValidationResult;
	saved?: {
		dataSourceCode: string;
		indicatorCount: number;
		frequencyCount: number;
	};
}

type AppDb = ReturnType<typeof getDb>;

interface ExistingIndicatorOwnership {
	id: number;
	code: string;
	frequency: string | null;
	indicatorGroupId: number;
	dataSourceId: number;
	dataSourceCode: string;
}

interface ParsedLine {
	lineNumber: number;
	text: string;
}

function nonEmptyLines(text: string): ParsedLine[] {
	return text
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n')
		.map((line, index) => ({ lineNumber: index + 1, text: line }))
		.filter((line) => line.text.trim().length > 0);
}

function detectDelimiter(headerLine: string): '\t' | ',' {
	return headerLine.includes('\t') ? '\t' : ',';
}

function parseDelimitedLine(line: string, delimiter: '\t' | ','): string[] {
	if (delimiter === '\t') return line.split('\t').map((cell) => cell.trim());

	const cells: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];
		const nextCharacter = line[index + 1];

		if (character === '"' && inQuotes && nextCharacter === '"') {
			current += '"';
			index += 1;
			continue;
		}

		if (character === '"') {
			inQuotes = !inQuotes;
			continue;
		}

		if (character === delimiter && !inQuotes) {
			cells.push(current.trim());
			current = '';
			continue;
		}

		current += character;
	}

	cells.push(current.trim());
	return cells;
}

function normalizeHeaders(rawHeaders: string[]): string[] {
	return rawHeaders.map((header) => header.trim().toLowerCase());
}

function rowValue(values: Record<string, string>, field: string): string {
	return values[field]?.trim() || '';
}

function parseDimensions(params: {
	rowNumber: number;
	value: string;
	knownDimensionCodes: Set<string>;
	errors: DefinitionValidationError[];
}): string[] {
	const rawValue = params.value.trim();
	if (!rawValue) return [];

	if (rawValue.includes(';')) {
		params.errors.push({
			rowNumber: params.rowNumber,
			field: 'dimensions',
			message: 'Use commas between dimension codes; semicolons are not supported.'
		});
		return [];
	}

	const dimensions = rawValue
		.split(',')
		.map((dimension) => dimension.trim().toUpperCase())
		.filter(Boolean);

	for (const dimension of dimensions) {
		if (!params.knownDimensionCodes.has(dimension)) {
			params.errors.push({
				rowNumber: params.rowNumber,
				field: 'dimensions',
				message: `Unknown Observation dimension code: ${dimension}`
			});
		}
	}

	return Array.from(new Set(dimensions));
}

function withValidationErrors(
	validation: DefinitionValidationResult,
	errors: DefinitionValidationError[]
): DefinitionValidationResult {
	return {
		...validation,
		errors: [...validation.errors, ...errors],
		valid: false
	};
}

function uniqueValues(values: string[]): string[] {
	return Array.from(new Set(values));
}

function optionalString(value: string): string | null {
	const trimmed = value.trim();
	return trimmed ? trimmed : null;
}

function optionalInteger(value: string): number | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	const parsed = Number.parseInt(trimmed, 10);
	return Number.isFinite(parsed) ? parsed : null;
}

function groupCodeForRow(row: ParsedDefinitionRow, dataSourceCode: string): string {
	return rowValue(row.values, 'group_code') || dataSourceCode;
}

function groupNameForRow(
	row: ParsedDefinitionRow,
	dataSourceCode: string,
	dataSourceName: string
): string {
	const groupCode = groupCodeForRow(row, dataSourceCode);
	return (
		rowValue(row.values, 'group_name') ||
		(groupCode === dataSourceCode ? dataSourceName : groupCode)
	);
}

const INDICATOR_CONSISTENCY_FIELDS = [
	'name',
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

function consistencyValue(
	row: ParsedDefinitionRow,
	field: (typeof INDICATOR_CONSISTENCY_FIELDS)[number],
	dataSourceCode: string,
	dataSourceName: string
): string {
	if (field === 'name') return row.name;
	if (field === 'group_code') return groupCodeForRow(row, dataSourceCode);
	if (field === 'group_name') return groupNameForRow(row, dataSourceCode, dataSourceName);
	return rowValue(row.values, field);
}

export function validateDefinitionPaste(
	input: ValidateDefinitionPasteInput
): DefinitionValidationResult {
	const errors: DefinitionValidationError[] = [];
	const rows: ParsedDefinitionRow[] = [];
	const lines = nonEmptyLines(input.definitionText);
	const dataSource = {
		code: normalizeDataSourceCode(input.dataSource.code),
		name: input.dataSource.name.trim()
	};

	if (lines.length === 0) {
		return {
			valid: false,
			errors: [
				{
					rowNumber: 1,
					field: 'grid',
					message: 'Paste a header row and at least one definition row.'
				}
			],
			rows,
			dataSource,
			headers: []
		};
	}

	const delimiter = detectDelimiter(lines[0].text);
	const headers = normalizeHeaders(parseDelimitedLine(lines[0].text, delimiter));
	const headerSet = new Set(headers);

	for (const requiredHeader of REQUIRED_DEFINITION_HEADERS) {
		if (!headerSet.has(requiredHeader)) {
			errors.push({
				rowNumber: lines[0].lineNumber,
				field: requiredHeader,
				message: `Missing required header: ${requiredHeader}`
			});
		}
	}

	const seenHeaders = new Set<string>();
	for (const header of headers) {
		if (!header) {
			errors.push({
				rowNumber: lines[0].lineNumber,
				field: 'header',
				message: 'Header names cannot be blank.'
			});
			continue;
		}

		if (seenHeaders.has(header)) {
			errors.push({
				rowNumber: lines[0].lineNumber,
				field: header,
				message: `Duplicate header: ${header}`
			});
		}
		seenHeaders.add(header);

		if (!SUPPORTED_HEADERS.has(header)) {
			errors.push({
				rowNumber: lines[0].lineNumber,
				field: header,
				message: `Unsupported header: ${header}`
			});
		}
	}

	const knownDimensionCodes = new Set(
		input.knownDimensionCodes.map((code) => code.trim().toUpperCase()).filter(Boolean)
	);

	for (const line of lines.slice(1)) {
		const cells = parseDelimitedLine(line.text, delimiter);
		if (cells.length > headers.length) {
			errors.push({
				rowNumber: line.lineNumber,
				field: 'row',
				message: `Expected ${headers.length} cells but found ${cells.length}. Check the pasted delimiter and quote cells containing separators.`
			});
		}

		const values = Object.fromEntries(
			headers.map((header, index) => [header, cells[index]?.trim() || ''])
		);
		const indicatorCode = rowValue(values, 'indicator_code');
		const freq = rowValue(values, 'freq').toUpperCase();
		const name = rowValue(values, 'name');

		if (headerSet.has('indicator_code') && !indicatorCode) {
			errors.push({
				rowNumber: line.lineNumber,
				field: 'indicator_code',
				message: 'Indicator code is required.'
			});
		}

		if (headerSet.has('freq') && !freq) {
			errors.push({
				rowNumber: line.lineNumber,
				field: 'freq',
				message: 'Frequency is required.'
			});
		}

		if (headerSet.has('name') && !name) {
			errors.push({
				rowNumber: line.lineNumber,
				field: 'name',
				message: 'Name is required.'
			});
		}

		const dimensions = parseDimensions({
			rowNumber: line.lineNumber,
			value: rowValue(values, 'dimensions'),
			knownDimensionCodes,
			errors
		});

		rows.push({
			rowNumber: line.lineNumber,
			indicatorCode,
			freq,
			name,
			dimensions,
			values
		});
	}

	if (lines.length === 1) {
		errors.push({
			rowNumber: lines[0].lineNumber,
			field: 'grid',
			message: 'Paste at least one definition row.'
		});
	}

	return {
		valid: errors.length === 0,
		errors,
		rows,
		dataSource,
		headers
	};
}

export async function saveDefinitionGrid(
	input: SaveDefinitionGridInput,
	db: AppDb = getDb()
): Promise<SaveDefinitionGridResult> {
	const dimensionRows = await db
		.select({ code: dimensionDefinitions.code })
		.from(dimensionDefinitions);
	let validation = validateDefinitionPaste({
		...input,
		knownDimensionCodes: dimensionRows.map((row) => row.code)
	});

	if (!validation.valid) return { ok: false, validation };

	const errors: DefinitionValidationError[] = [];
	if (!validation.dataSource.code) {
		errors.push({
			rowNumber: 0,
			field: 'data_source',
			message: 'Data source code is required.'
		});
	}
	if (!validation.dataSource.name) {
		errors.push({
			rowNumber: 0,
			field: 'data_source_name',
			message: 'Data source name is required.'
		});
	}

	const indicatorCodes = uniqueValues(validation.rows.map((row) => row.indicatorCode));
	const existingIndicatorsByCode = new Map<string, ExistingIndicatorOwnership>();
	if (indicatorCodes.length > 0) {
		const existingIndicators = await db
			.select({
				id: indicators.id,
				code: indicators.code,
				frequency: indicators.frequency,
				indicatorGroupId: indicators.indicatorGroupId,
				dataSourceId: areas.id,
				dataSourceCode: areas.code
			})
			.from(indicators)
			.innerJoin(indicatorGroups, eq(indicators.indicatorGroupId, indicatorGroups.id))
			.innerJoin(areas, eq(indicatorGroups.areaId, areas.id))
			.where(inArray(indicators.code, indicatorCodes));
		for (const row of existingIndicators) existingIndicatorsByCode.set(row.code, row);
	}

	const existingIndicatorIds = Array.from(existingIndicatorsByCode.values()).map((row) => row.id);
	const existingFrequencyRows = existingIndicatorIds.length
		? await db
				.select({ indicatorId: indicatorFrequencies.indicatorId, freq: indicatorFrequencies.freq })
				.from(indicatorFrequencies)
				.where(inArray(indicatorFrequencies.indicatorId, existingIndicatorIds))
		: [];
	const existingFrequenciesByIndicatorId = new Map<number, Set<string>>();
	for (const row of existingFrequencyRows) {
		const frequencies = existingFrequenciesByIndicatorId.get(row.indicatorId) || new Set<string>();
		frequencies.add(row.freq);
		existingFrequenciesByIndicatorId.set(row.indicatorId, frequencies);
	}
	for (const row of existingIndicatorsByCode.values()) {
		if (!row.frequency) continue;
		const frequencies = existingFrequenciesByIndicatorId.get(row.id) || new Set<string>();
		frequencies.add(row.frequency);
		existingFrequenciesByIndicatorId.set(row.id, frequencies);
	}

	const frequencyKeys = new Set<string>();
	const indicatorConsistency = new Map<string, Map<string, string>>();
	for (const row of validation.rows) {
		const frequencyKey = `${row.indicatorCode}\u0000${row.freq}`;
		if (frequencyKeys.has(frequencyKey)) {
			errors.push({
				rowNumber: row.rowNumber,
				field: 'freq',
				message: `Duplicate Indicator frequency in pasted grid: ${row.indicatorCode}/${row.freq}`
			});
		}
		frequencyKeys.add(frequencyKey);

		const existingIndicator = existingIndicatorsByCode.get(row.indicatorCode);
		if (existingIndicator && existingIndicator.dataSourceCode !== validation.dataSource.code) {
			errors.push({
				rowNumber: row.rowNumber,
				field: 'indicator_code',
				message: `Indicator code ${row.indicatorCode} already belongs to Data source ${existingIndicator.dataSourceCode}.`
			});
			continue;
		}

		if (existingIndicator) {
			const existingFrequencies =
				existingFrequenciesByIndicatorId.get(existingIndicator.id) || new Set<string>();
			if (existingFrequencies.has(row.freq)) {
				errors.push({
					rowNumber: row.rowNumber,
					field: 'freq',
					message: `Indicator frequency already exists: ${row.indicatorCode}/${row.freq}`
				});
			}
			continue;
		}

		const existingValues = indicatorConsistency.get(row.indicatorCode) || new Map<string, string>();
		for (const field of INDICATOR_CONSISTENCY_FIELDS) {
			const currentValue = consistencyValue(
				row,
				field,
				validation.dataSource.code,
				validation.dataSource.name
			);
			const existingValue = existingValues.get(field);
			if (existingValue !== undefined && existingValue !== currentValue) {
				errors.push({
					rowNumber: row.rowNumber,
					field,
					message: `Rows for Indicator ${row.indicatorCode} must use the same ${field}.`
				});
			}
			existingValues.set(field, currentValue);
		}
		indicatorConsistency.set(row.indicatorCode, existingValues);
	}

	if (errors.length > 0) {
		validation = withValidationErrors(validation, errors);
		return { ok: false, validation };
	}

	const rowsByIndicator = new Map<string, ParsedDefinitionRow[]>();
	for (const row of validation.rows) {
		const groupedRows = rowsByIndicator.get(row.indicatorCode) || [];
		groupedRows.push(row);
		rowsByIndicator.set(row.indicatorCode, groupedRows);
	}

	await db.transaction(async (tx) => {
		const existingDataSources = await tx
			.select({ id: areas.id })
			.from(areas)
			.where(eq(areas.code, validation.dataSource.code))
			.limit(1);
		const dataSourceId = existingDataSources[0]?.id
			? existingDataSources[0].id
			: (
					await tx
						.insert(areas)
						.values({ code: validation.dataSource.code, name: validation.dataSource.name })
						.returning({ id: areas.id })
				)[0].id;

		const groupIdsByCode = new Map<string, number>();

		for (const [indicatorCode, indicatorRows] of rowsByIndicator.entries()) {
			const firstRow = indicatorRows[0];
			const existingIndicator = existingIndicatorsByCode.get(indicatorCode);
			let indicatorId = existingIndicator?.id;

			if (!indicatorId) {
				const groupCode = groupCodeForRow(firstRow, validation.dataSource.code);
				const groupName = groupNameForRow(
					firstRow,
					validation.dataSource.code,
					validation.dataSource.name
				);
				let indicatorGroupId = groupIdsByCode.get(groupCode);
				if (!indicatorGroupId) {
					const existingGroups = await tx
						.select({ id: indicatorGroups.id })
						.from(indicatorGroups)
						.where(
							and(eq(indicatorGroups.areaId, dataSourceId), eq(indicatorGroups.code, groupCode))
						)
						.limit(1);
					indicatorGroupId = existingGroups[0]?.id
						? existingGroups[0].id
						: (
								await tx
									.insert(indicatorGroups)
									.values({
										areaId: dataSourceId,
										code: groupCode,
										name: groupName
									})
									.returning({ id: indicatorGroups.id })
							)[0].id;
					groupIdsByCode.set(groupCode, indicatorGroupId);
				}

				const frequencies = uniqueValues(indicatorRows.map((row) => row.freq)).sort((a, b) =>
					a.localeCompare(b)
				);
				const [createdIndicator] = await tx
					.insert(indicators)
					.values({
						indicatorGroupId,
						code: indicatorCode,
						name: firstRow.name,
						shortName: optionalString(rowValue(firstRow.values, 'short_name')),
						description: optionalString(rowValue(firstRow.values, 'description')),
						methodology: optionalString(rowValue(firstRow.values, 'methodology')),
						frequency: frequencies[0],
						source: optionalString(rowValue(firstRow.values, 'source_citation')),
						unit: optionalString(rowValue(firstRow.values, 'unit')),
						unitMult: optionalInteger(rowValue(firstRow.values, 'unit_mult')),
						decimals: optionalInteger(rowValue(firstRow.values, 'decimals')),
						defaultViz: optionalString(rowValue(firstRow.values, 'default_viz')),
						updated: optionalString(rowValue(firstRow.values, 'updated'))
					})
					.returning({ id: indicators.id });
				indicatorId = createdIndicator.id;
			}

			await tx.insert(indicatorFrequencies).values(
				uniqueValues(indicatorRows.map((row) => row.freq)).map((freq) => ({
					indicatorId,
					freq
				}))
			);

			const dimensionValues = indicatorRows.flatMap((row) =>
				row.dimensions.map((dimensionCode) => ({
					indicatorId,
					freq: row.freq,
					dimensionCode
				}))
			);
			if (dimensionValues.length > 0) {
				await tx.insert(indicatorDimensions).values(dimensionValues);
			}
		}
	});

	return {
		ok: true,
		validation,
		saved: {
			dataSourceCode: validation.dataSource.code,
			indicatorCount: rowsByIndicator.size,
			frequencyCount: validation.rows.length
		}
	};
}
