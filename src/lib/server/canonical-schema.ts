/**
 * The canonical SDMX contract.
 *
 * Every survey the data team ships lands in one parquet with exactly these 36
 * columns, in this order. That is the whole contract: if a file matches, the
 * generic loader can ingest it with no per-survey code. If it does not match,
 * we want a loud failure naming the drift rather than a silent column drop --
 * silently dropping CATEGORY is what forced the bespoke exportaciones loader
 * we are replacing.
 *
 * Verified against data/canonical/ on 2026-09-02: GEIH, ECV, EMICRON and
 * Exportaciones all match this exactly, and all four declare the same
 * `primary_key` in their metadata `_schema` block.
 */

/** The 36 columns of the source parquet, in file order. */
export const CANONICAL_PARQUET_COLUMNS = [
	'DATAFLOW',
	'FREQ',
	'INDICATOR',
	'INDICATOR_NAME',
	'SOURCE_ROW',
	'THEME',
	'REF_AREA',
	'DEPT_CODE',
	'MUNI_CODE',
	'GEO_LEVEL',
	'AREA',
	'DOMAIN',
	'CLASE',
	'URBAN_RURAL',
	'SEX',
	'HEAD_SEX',
	'AGE',
	'CATEGORY',
	'CATEGORY_LABEL',
	'ADJUSTMENT',
	'TIME_PERIOD',
	'OBS_VALUE',
	'UNIT',
	'UNIT_MULT',
	'OBS_STATUS',
	'DECIMALS',
	'YEAR',
	'MONTH',
	'WEIGHT_TYPE',
	'ESTIMATION_SCOPE',
	'REPRESENTATIVE',
	'SOURCE_VARIABLES',
	'FORMULA',
	'UNIVERSE',
	'METHODOLOGY_NOTE',
	'SOURCE'
] as const;

/**
 * The dimensions that identify an observation, in the order all four metadata
 * files declare as `_schema.primary_key`. DATAFLOW and INDICATOR are part of
 * the declared key but are identity rather than dimension, so they are listed
 * first and separately below.
 */
export const CANONICAL_KEY_COLUMNS = [
	'DATAFLOW',
	'FREQ',
	'INDICATOR',
	'REF_AREA',
	'DEPT_CODE',
	'MUNI_CODE',
	'GEO_LEVEL',
	'AREA',
	'DOMAIN',
	'CLASE',
	'URBAN_RURAL',
	'SEX',
	'HEAD_SEX',
	'AGE',
	'CATEGORY',
	'ADJUSTMENT',
	'TIME_PERIOD'
] as const;

/**
 * Dimension columns of the `observations` table, lowercased. These are the
 * columns the Explorer may filter or split on. `category` is one of them --
 * that is the change that makes the loader generic, because every survey's
 * breakdown now has a home instead of only Exportaciones' having one.
 */
export const OBSERVATION_DIMENSIONS = [
	'freq',
	'time_period',
	'ref_area',
	'dept_code',
	'muni_code',
	'geo_level',
	'area',
	'domain',
	'clase',
	'urban_rural',
	'sex',
	'head_sex',
	'age',
	'category',
	'adjustment'
] as const;

/**
 * Attributes that vary per observation, so they cannot be normalised onto the
 * indicator. GEIH is the proof: a single indicator there carries two
 * WEIGHT_TYPEs, five ESTIMATION_SCOPEs and both values of REPRESENTATIVE,
 * because its monthly area-level estimates are exploratory while its annual
 * department-level ones are not.
 */
export const OBSERVATION_ATTRIBUTES = [
	'unit',
	'unit_mult',
	'decimals',
	'obs_status',
	'weight_type',
	'estimation_scope',
	'representative'
] as const;

export const CANONICAL_SCHEMA_VERSION = 2;

/** DDL for the canonical store. Kept here so loader and validator agree. */
export const OBSERVATIONS_DDL = `
	CREATE TABLE observations (
		-- identity
		dataflow          VARCHAR NOT NULL,
		indicator_code    VARCHAR NOT NULL,
		-- dimensions
		freq              VARCHAR NOT NULL,
		time_period       VARCHAR NOT NULL,
		ref_area          VARCHAR NOT NULL,
		dept_code         VARCHAR NOT NULL,
		muni_code         VARCHAR NOT NULL,
		geo_level         VARCHAR NOT NULL,
		area              VARCHAR NOT NULL,
		domain            VARCHAR NOT NULL,
		clase             VARCHAR NOT NULL,
		urban_rural       VARCHAR NOT NULL,
		sex               VARCHAR NOT NULL,
		head_sex          VARCHAR NOT NULL,
		age               VARCHAR NOT NULL,
		category          VARCHAR NOT NULL,
		adjustment        VARCHAR NOT NULL,
		-- measure
		obs_value         DOUBLE,
		-- per-observation attributes
		unit              VARCHAR,
		unit_mult         INTEGER,
		decimals          INTEGER,
		obs_status        VARCHAR,
		weight_type       VARCHAR,
		estimation_scope  VARCHAR,
		representative    BOOLEAN,
		-- derived from TIME_PERIOD, kept for cheap range filters
		year              INTEGER,
		month             INTEGER
	)
`;

/**
 * Category labels are indicator-scoped: GEIH's CATEGORY='1' is "Hombre",
 * "Contributivo", "Indígena" and eight other things depending on the
 * indicator. So the codelist is keyed on (indicator_code, category) and never
 * on the code alone. `_schema.codelists.CATEGORY` in every metadata file says
 * the same thing: {"scope": "INDICATOR"}.
 */
export const INDICATOR_CATEGORIES_DDL = `
	CREATE TABLE indicator_categories (
		indicator_code  VARCHAR NOT NULL,
		category        VARCHAR NOT NULL,
		category_label  VARCHAR,
		obs_count       BIGINT
	)
`;

/**
 * Indicator-level facts, lifted out of the 7.2M observation rows where the
 * source repeats them verbatim on every row.
 */
export const INDICATORS_DDL = `
	CREATE TABLE indicator_meta (
		indicator_code  VARCHAR NOT NULL,
		dataflow        VARCHAR NOT NULL,
		indicator_name  VARCHAR,
		theme           VARCHAR,
		source          VARCHAR,
		survey          VARCHAR NOT NULL,
		unit            VARCHAR,
		unit_mult       INTEGER,
		decimals        INTEGER,
		obs_count       BIGINT,
		time_min        VARCHAR,
		time_max        VARCHAR,
		freqs           VARCHAR,
		category_count  INTEGER
	)
`;
