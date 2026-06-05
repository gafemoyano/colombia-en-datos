import { describe, expect, it } from 'vitest';
import { buildAvailableIndicatorCatalog } from './duckdb';

describe('buildAvailableIndicatorCatalog', () => {
	it('hides definition-only indicators without visible frequencies', () => {
		const catalog = buildAvailableIndicatorCatalog(
			[
				{
					code: 'DRAFT_ONLY',
					name: 'Draft only',
					shortName: null,
					frequency: 'A',
					area: 'Draft source',
					group: 'Draft group'
				}
			],
			new Map()
		);

		expect(catalog).toEqual([]);
	});

	it('keeps published indicators with visible observation frequencies', () => {
		const catalog = buildAvailableIndicatorCatalog(
			[
				{
					code: 'PUBLISHED',
					name: 'Published indicator',
					shortName: 'Published',
					frequency: 'A',
					area: 'Published source',
					group: 'Published group'
				}
			],
			new Map([['PUBLISHED', ['M', 'A']]])
		);

		expect(catalog).toEqual([
			{
				code: 'PUBLISHED',
				name: 'Published indicator',
				shortName: 'Published',
				frequency: 'M',
				availableFrequencies: ['M', 'A'],
				area: 'Published source',
				group: 'Published group'
			}
		]);
	});
});
