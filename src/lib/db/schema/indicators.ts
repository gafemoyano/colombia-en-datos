import { sqliteTable, integer, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const dataSources = sqliteTable('data_sources', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code', { length: 50 }).notNull().unique(),
	name: text('name', { length: 255 }).notNull(),
	description: text('description'),
	createdAt: text('created_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull(),
	updatedAt: text('updated_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull()
});

export const indicatorGroups = sqliteTable(
	'indicator_groups',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		dataSourceId: integer('data_source_id')
			.references(() => dataSources.id)
			.notNull(),
		code: text('code', { length: 255 }).notNull(),
		name: text('name', { length: 255 }).notNull(),
		description: text('description'),
		sourceType: text('source_type', { length: 50 }),
		filterWhitelist: text('filter_whitelist', { mode: 'json' }).$type<string[]>(),
		createdAt: text('created_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull(),
		updatedAt: text('updated_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull()
	},
	(table) => ({
		indicatorGroupsUnique: uniqueIndex('indicator_groups_data_source_code_unique').on(
			table.dataSourceId,
			table.code
		)
	})
);

export const indicators = sqliteTable('indicators', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	indicatorGroupId: integer('indicator_group_id')
		.references(() => indicatorGroups.id)
		.notNull(),
	code: text('code', { length: 100 }).notNull().unique(),
	name: text('name', { length: 255 }).notNull(),
	shortName: text('short_name', { length: 255 }),
	description: text('description'),
	methodology: text('methodology'),
	// Deprecated: frequency is per-observation, not per-indicator.
	// Kept for backward compatibility during migration. Will be removed in Phase 3.
	frequency: text('frequency', { length: 1 }),
	sourceCitation: text('source_citation', { length: 255 }),
	unit: text('unit', { length: 100 }),
	unitMult: integer('unit_mult'),
	decimals: integer('decimals'),
	defaultViz: text('default_viz', { length: 50 }),
	updated: text('updated', { length: 50 }),
	createdAt: text('created_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull(),
	updatedAt: text('updated_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull()
});

// Legacy table: maps indicators to parquet file paths.
// Deprecated in Phase 1. Replaced by indicator_data_sources + canonical store.
// Kept for reference during transition.
export const indicatorFiles = sqliteTable(
	'indicator_files',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		indicatorId: integer('indicator_id')
			.references(() => indicators.id)
			.notNull(),
		refArea: text('ref_area', { length: 50 }).notNull(),
		year: integer('year').notNull(),
		filePath: text('file_path').notNull(),
		createdAt: text('created_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull()
	},
	(table) => ({
		indicatorFilesUnique: uniqueIndex('indicator_files_unique').on(
			table.indicatorId,
			table.refArea,
			table.year,
			table.filePath
		)
	})
);

// ---------------------------------------------------------------------------
// Phase 1: Dimension registry
// ---------------------------------------------------------------------------

export const dimensionDefinitions = sqliteTable('dimension_definitions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	code: text('code', { length: 100 }).notNull().unique(),
	name: text('name', { length: 255 }).notNull(),
	sortOrder: integer('sort_order'),
	isStandard: integer('is_standard', { mode: 'boolean' }).default(true),
	createdAt: text('created_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull()
});

export const dimensionValues = sqliteTable(
	'dimension_values',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		dimensionCode: text('dimension_code', { length: 100 })
			.notNull()
			.references(() => dimensionDefinitions.code),
		code: text('code', { length: 100 }).notNull(),
		labelEs: text('label_es', { length: 255 }),
		sortOrder: integer('sort_order')
	},
	(table) => ({
		uniqueDimensionValue: uniqueIndex('dimension_values_unique').on(
			table.dimensionCode,
			table.code
		)
	})
);

export const indicatorFrequencies = sqliteTable(
	'indicator_frequencies',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		indicatorId: integer('indicator_id')
			.notNull()
			.references(() => indicators.id),
		freq: text('freq', { length: 1 }).notNull(),
		createdAt: text('created_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull(),
		updatedAt: text('updated_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull()
	},
	(table) => ({
		uniqueIndicatorFrequency: uniqueIndex('indicator_frequencies_unique').on(
			table.indicatorId,
			table.freq
		)
	})
);

export const indicatorDimensions = sqliteTable(
	'indicator_dimensions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		indicatorId: integer('indicator_id')
			.notNull()
			.references(() => indicators.id),
		freq: text('freq', { length: 1 }).notNull().default('*'),
		dimensionCode: text('dimension_code', { length: 100 })
			.notNull()
			.references(() => dimensionDefinitions.code),
		defaultValue: text('default_value', { length: 100 }),
		isFilterable: integer('is_filterable', { mode: 'boolean' }).default(true),
		isSplitable: integer('is_splitable', { mode: 'boolean' }).default(true)
	},
	(table) => ({
		uniqueIndicatorDimension: uniqueIndex('indicator_dimensions_unique').on(
			table.indicatorId,
			table.freq,
			table.dimensionCode
		)
	})
);

// ---------------------------------------------------------------------------
// Phase 1: Batch lineage / releases
// ---------------------------------------------------------------------------

export const ingestBatches = sqliteTable('ingest_batches', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	dataSourceId: integer('data_source_id').references(() => dataSources.id),
	originalName: text('original_name'),
	checksum: text('checksum'),
	sourceFormat: text('source_format', { length: 50 }),
	rowCount: integer('row_count'),
	status: text('status', { length: 50 }).notNull().default('uploaded'),
	createdAt: text('created_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull(),
	updatedAt: text('updated_at')
		.default(sql`(CURRENT_TIMESTAMP)`)
		.notNull(),
	publishedAt: text('published_at')
});

export const dataReleases = sqliteTable('data_releases', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	indicatorId: integer('indicator_id')
		.notNull()
		.references(() => indicators.id),
	ingestBatchId: integer('ingest_batch_id').references(() => ingestBatches.id),
	releaseDate: text('release_date').default(sql`(CURRENT_TIMESTAMP)`),
	periodStart: text('period_start'),
	periodEnd: text('period_end'),
	rowCount: integer('row_count'),
	sourceFormat: text('source_format', { length: 50 }),
	sourceName: text('source_name'),
	uploadedBy: text('uploaded_by'),
	status: text('status', { length: 50 }).default('published'),
	checksum: text('checksum')
});

export const ingestBatchSlices = sqliteTable(
	'ingest_batch_slices',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		batchId: integer('batch_id')
			.notNull()
			.references(() => ingestBatches.id),
		indicatorCode: text('indicator_code', { length: 100 }).notNull(),
		freq: text('freq', { length: 1 }).notNull(),
		indicatorId: integer('indicator_id').references(() => indicators.id),
		rowCount: integer('row_count'),
		periodStart: text('period_start'),
		periodEnd: text('period_end'),
		status: text('status', { length: 50 }).notNull().default('proposed'),
		releaseId: integer('release_id').references(() => dataReleases.id),
		createdAt: text('created_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull(),
		updatedAt: text('updated_at')
			.default(sql`(CURRENT_TIMESTAMP)`)
			.notNull()
	},
	(table) => ({
		uniqueIngestBatchSlice: uniqueIndex('ingest_batch_slices_unique').on(
			table.batchId,
			table.indicatorCode,
			table.freq
		)
	})
);

// ---------------------------------------------------------------------------
// Phase 1: Canonical data sources
// ---------------------------------------------------------------------------

export const indicatorDataSources = sqliteTable(
	'indicator_data_sources',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		indicatorId: integer('indicator_id')
			.notNull()
			.references(() => indicators.id),
		refArea: text('ref_area', { length: 50 }).notNull(),
		freq: text('freq', { length: 1 }).notNull(),
		yearMin: integer('year_min'),
		yearMax: integer('year_max'),
		rowCount: integer('row_count'),
		releaseId: integer('release_id').references(() => dataReleases.id)
	},
	(table) => ({
		uniqueIndicatorDataSource: uniqueIndex('indicator_data_sources_unique').on(
			table.indicatorId,
			table.refArea,
			table.freq
		)
	})
);
