export function normalizeDataSourceCode(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.replace(/_+/g, '_');
}
