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
