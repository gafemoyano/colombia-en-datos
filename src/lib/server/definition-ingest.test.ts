import { describe, expect, it } from 'vitest';
import { validateDefinitionPaste } from './definition-ingest';

const knownDimensionCodes = ['SEX', 'AGE', 'URBAN_RURAL'];

function validate(definitionText: string) {
	return validateDefinitionPaste({
		dataSource: { code: 'Gran Encuesta Integrada de Hogares', name: 'GEIH' },
		definitionText,
		knownDimensionCodes
	});
}

describe('validateDefinitionPaste', () => {
	it('accepts required headers in any order', () => {
		const result = validate('name\tdimensions\tfreq\tindicator_code\nEmpleo\tSEX\tM\tEMP');

		expect(result.valid).toBe(true);
		expect(result.errors).toEqual([]);
		expect(result.rows).toMatchObject([
			{
				rowNumber: 2,
				indicatorCode: 'EMP',
				freq: 'M',
				name: 'Empleo',
				dimensions: ['SEX']
			}
		]);
	});

	it('enforces required headers deterministically', () => {
		const result = validate('indicator_code\tfreq\nEMP\tM');

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([
			{
				rowNumber: 1,
				field: 'name',
				message: 'Missing required header: name'
			},
			{
				rowNumber: 1,
				field: 'dimensions',
				message: 'Missing required header: dimensions'
			}
		]);
	});

	it('accepts empty dimensions as dimensionless definitions', () => {
		const result = validate('indicator_code\tfreq\tname\tdimensions\nEMP\tA\tEmpleo\t');

		expect(result.valid).toBe(true);
		expect(result.rows[0].dimensions).toEqual([]);
	});

	it('trims and uppercases comma-separated dimension codes', () => {
		const result = validate('indicator_code\tfreq\tname\tdimensions\nEMP\tM\tEmpleo\t sex, Age ');

		expect(result.valid).toBe(true);
		expect(result.rows[0].dimensions).toEqual(['SEX', 'AGE']);
	});

	it('rejects unknown Observation dimension codes with row and field details', () => {
		const result = validate('indicator_code\tfreq\tname\tdimensions\nEMP\tM\tEmpleo\tSEX,UNKNOWN');

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([
			{
				rowNumber: 2,
				field: 'dimensions',
				message: 'Unknown Observation dimension code: UNKNOWN'
			}
		]);
	});

	it('rejects semicolon-delimited dimensions', () => {
		const result = validate('indicator_code\tfreq\tname\tdimensions\nEMP\tM\tEmpleo\tSEX;AGE');

		expect(result.valid).toBe(false);
		expect(result.errors).toEqual([
			{
				rowNumber: 2,
				field: 'dimensions',
				message: 'Use commas between dimension codes; semicolons are not supported.'
			}
		]);
	});

	it('normalizes Data source codes but preserves Indicator code casing', () => {
		const result = validate('indicator_code\tfreq\tname\tdimensions\nEmp_Code\tm\tEmpleo\t');

		expect(result.dataSource.code).toBe('gran_encuesta_integrada_de_hogares');
		expect(result.rows[0].indicatorCode).toBe('Emp_Code');
		expect(result.rows[0].freq).toBe('M');
	});
});
