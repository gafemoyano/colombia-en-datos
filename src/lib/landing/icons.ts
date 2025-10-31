type IconElement = 'path' | 'circle' | 'rect' | 'ellipse';

type IconNode = [IconElement, Record<string, string>];

export const iconNodes = {
	'arrow-right': [
		['path', { d: 'M5 12h14' }],
		['path', { d: 'm12 5 7 7-7 7' }]
	],
	mail: [
		['path', { d: 'm22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7' }],
		['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2' }]
	],
	phone: [
		[
			'path',
			{
				d:
					'M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384'
			}
		]
	],
	sparkles: [
		[
			'path',
			{
				d:
					'M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z'
			}
		],
		['path', { d: 'M20 2v4' }],
		['path', { d: 'M22 4h-4' }],
		['circle', { cx: '4', cy: '20', r: '2' }]
	],
	play: [
		[
			'path',
			{
				d: 'M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z'
			}
		]
	],
	'circle-check': [
		['circle', { cx: '12', cy: '12', r: '10' }],
		['path', { d: 'm9 12 2 2 4-4' }]
	],
	layers: [
		[
			'path',
			{
				d: 'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z'
			}
		],
		[
			'path',
			{
				d: 'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12'
			}
		],
		[
			'path',
			{
				d: 'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17'
			}
		]
	],
	database: [
		['ellipse', { cx: '12', cy: '5', rx: '9', ry: '3' }],
		['path', { d: 'M3 5V19A9 3 0 0 0 21 19V5' }],
		['path', { d: 'M3 12A9 3 0 0 0 21 12' }]
	],
	download: [
		['path', { d: 'M12 15V3' }],
		['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
		['path', { d: 'm7 10 5 5 5-5' }]
	],
	'git-merge': [
		['circle', { cx: '18', cy: '18', r: '3' }],
		['circle', { cx: '6', cy: '6', r: '3' }],
		['path', { d: 'M6 21V9a9 9 0 0 0 9 9' }]
	]
} as const satisfies Record<string, IconNode[]>;

export type IconName = keyof typeof iconNodes;
