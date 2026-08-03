import { json } from '@sveltejs/kit';
import { and, eq, inArray } from 'drizzle-orm';
import { getAvailableIndicators } from '$lib/server/duckdb';
import { getDb } from '$lib/db/client';
import {
	dataSources,
	dimensionDefinitions,
	indicatorDimensions,
	indicatorFrequencies,
	indicatorGroups,
	indicators
} from '$lib/db/schema';
import type { RequestHandler } from './$types';

const CODE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const FREQ_PATTERN = /^[A-Z]$/;

interface NormalizedCreateIndicatorPayload {
	code: string;
	name: string;
	dataSourceCode: string;
	dataSourceName: string;
	groupCode: string;
	groupName: string;
	dimensionsByFreq: Record<string, string[]>;
	shortName: string | null;
	description: string | null;
	methodology: string | null;
	sourceCitation: string | null;
	unit: string | null;
	unitMult: number | null;
	decimals: number | null;
	defaultViz: string | null;
	updated: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function integerValue(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	if (typeof value !== 'string') return null;

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && String(parsed) === value.trim() ? parsed : null;
}

function humanizeCode(code: string): string {
	return code
		.replace(/[_.-]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizePayload(
	body: unknown
): { ok: true; value: NormalizedCreateIndicatorPayload } | { ok: false; errors: string[] } {
	const errors: string[] = [];

	if (!isRecord(body)) {
		return { ok: false, errors: ['Request body must be a JSON object'] };
	}

	const code = stringValue(body.code);
	const name = stringValue(body.name);
	const dataSourceCode = stringValue(body.dataSourceCode) || stringValue(body.areaCode);
	const groupCode = stringValue(body.groupCode);

	if (!code) errors.push('code is required');
	else if (!CODE_PATTERN.test(code))
		errors.push('code may only contain letters, numbers, _, . and -');

	if (!name) errors.push('name is required');
	if (!dataSourceCode) errors.push('dataSourceCode is required');
	else if (!CODE_PATTERN.test(dataSourceCode)) {
		errors.push('dataSourceCode may only contain letters, numbers, _, . and -');
	}

	if (!groupCode) errors.push('groupCode is required');
	else if (!CODE_PATTERN.test(groupCode)) {
		errors.push('groupCode may only contain letters, numbers, _, . and -');
	}

	const dimensionsByFreqInput = body.dimensionsByFreq;
	const dimensionsByFreq: Record<string, string[]> = {};

	if (!isRecord(dimensionsByFreqInput)) {
		errors.push('dimensionsByFreq must be an object like { "A": ["GEO_LEVEL"] }');
	} else {
		for (const [rawFreq, rawDimensions] of Object.entries(dimensionsByFreqInput)) {
			const freq = rawFreq.trim().toUpperCase();

			if (!FREQ_PATTERN.test(freq)) {
				errors.push(`Invalid frequency "${rawFreq}"; expected a single letter like A, M or Q`);
				continue;
			}

			if (!Array.isArray(rawDimensions)) {
				errors.push(`dimensionsByFreq.${rawFreq} must be an array of dimension codes`);
				continue;
			}

			const normalizedDimensions: string[] = [];
			for (const rawDimension of rawDimensions) {
				const dimension = stringValue(rawDimension)?.toUpperCase();
				if (!dimension) {
					errors.push(`dimensionsByFreq.${rawFreq} contains an invalid dimension code`);
					continue;
				}
				if (!CODE_PATTERN.test(dimension)) {
					errors.push(`Invalid dimension code "${dimension}"`);
					continue;
				}
				if (!normalizedDimensions.includes(dimension)) normalizedDimensions.push(dimension);
			}

			dimensionsByFreq[freq] = normalizedDimensions;
		}
	}

	if (isRecord(dimensionsByFreqInput) && Object.keys(dimensionsByFreq).length === 0) {
		errors.push('dimensionsByFreq must include at least one frequency');
	}

	const unitMult = integerValue(body.unitMult);
	if (
		body.unitMult !== undefined &&
		body.unitMult !== null &&
		body.unitMult !== '' &&
		unitMult === null
	) {
		errors.push('unitMult must be an integer');
	}

	const decimals = integerValue(body.decimals);
	if (
		body.decimals !== undefined &&
		body.decimals !== null &&
		body.decimals !== '' &&
		decimals === null
	) {
		errors.push('decimals must be an integer');
	}

	if (errors.length > 0 || !code || !name || !dataSourceCode || !groupCode) {
		return { ok: false, errors };
	}

	return {
		ok: true,
		value: {
			code,
			name,
			dataSourceCode,
			dataSourceName:
				stringValue(body.dataSourceName) || stringValue(body.areaName) || humanizeCode(dataSourceCode),
			groupCode,
			groupName: stringValue(body.groupName) || humanizeCode(groupCode),
			dimensionsByFreq,
			shortName: stringValue(body.shortName),
			description: stringValue(body.description),
			methodology: stringValue(body.methodology),
			sourceCitation: stringValue(body.sourceCitation) || stringValue(body.source),
			unit: stringValue(body.unit),
			unitMult,
			decimals,
			defaultViz: stringValue(body.defaultViz),
			updated: stringValue(body.updated)
		}
	};
}

function isUniqueConstraintError(error: unknown): boolean {
	return error instanceof Error && /unique|constraint/i.test(error.message);
}

export const GET: RequestHandler = async () => {
	const indicators = await getAvailableIndicators();
	return json({ indicators });
};

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;

	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const normalized = normalizePayload(body);
	if (!normalized.ok) {
		return json({ error: 'Validation failed', errors: normalized.errors }, { status: 400 });
	}

	const payload = normalized.value;
	const db = getDb();

	const existingIndicator = await db
		.select({ id: indicators.id })
		.from(indicators)
		.where(eq(indicators.code, payload.code))
		.limit(1);

	if (existingIndicator.length > 0) {
		return json(
			{ error: `Indicator ${payload.code} already exists`, code: payload.code },
			{ status: 409 }
		);
	}

	const requestedDimensionCodes = [...new Set(Object.values(payload.dimensionsByFreq).flat())];

	if (requestedDimensionCodes.length > 0) {
		const knownDimensions = await db
			.select({ code: dimensionDefinitions.code })
			.from(dimensionDefinitions)
			.where(inArray(dimensionDefinitions.code, requestedDimensionCodes));

		const knownDimensionCodes = new Set(knownDimensions.map((dimension) => dimension.code));
		const missingDimensionCodes = requestedDimensionCodes.filter(
			(code) => !knownDimensionCodes.has(code)
		);

		if (missingDimensionCodes.length > 0) {
			return json(
				{
					error: 'Unknown dimension codes',
					dimensions: missingDimensionCodes
				},
				{ status: 400 }
			);
		}
	}

	try {
		const created = await db.transaction(async (tx) => {
			const existingDataSource = await tx
				.select({ id: dataSources.id })
				.from(dataSources)
				.where(eq(dataSources.code, payload.dataSourceCode))
				.limit(1);

			const dataSourceId =
				existingDataSource[0]?.id ??
				(
					await tx
						.insert(dataSources)
						.values({ code: payload.dataSourceCode, name: payload.dataSourceName })
						.returning({ id: dataSources.id })
				)[0].id;

			const existingGroup = await tx
				.select({ id: indicatorGroups.id })
				.from(indicatorGroups)
				.where(
					and(
						eq(indicatorGroups.dataSourceId, dataSourceId),
						eq(indicatorGroups.code, payload.groupCode)
					)
				)
				.limit(1);

			const groupId =
				existingGroup[0]?.id ??
				(
					await tx
						.insert(indicatorGroups)
						.values({
							dataSourceId,
							code: payload.groupCode,
							name: payload.groupName,
							sourceType: 'api'
						})
						.returning({ id: indicatorGroups.id })
				)[0].id;

			const [indicator] = await tx
				.insert(indicators)
				.values({
					indicatorGroupId: groupId,
					code: payload.code,
					name: payload.name,
					shortName: payload.shortName,
					description: payload.description,
					methodology: payload.methodology,
					sourceCitation: payload.sourceCitation,
					unit: payload.unit,
					unitMult: payload.unitMult,
					decimals: payload.decimals,
					defaultViz: payload.defaultViz,
					updated: payload.updated
				})
				.returning({ id: indicators.id });

			const frequencyRows = Object.keys(payload.dimensionsByFreq).map((freq) => ({
				indicatorId: indicator.id,
				freq
			}));

			await tx.insert(indicatorFrequencies).values(frequencyRows);

			const dimensionRows = Object.entries(payload.dimensionsByFreq).flatMap(([freq, dimensions]) =>
				dimensions.map((dimensionCode) => ({
					indicatorId: indicator.id,
					freq,
					dimensionCode,
					isFilterable: true,
					isSplitable: true
				}))
			);

			if (dimensionRows.length > 0) {
				await tx.insert(indicatorDimensions).values(dimensionRows);
			}

			return {
				id: indicator.id,
				dataSourceId,
				groupId
			};
		});

		return json(
			{
				indicator: {
					id: created.id,
					code: payload.code,
					name: payload.name,
					dataSourceCode: payload.dataSourceCode,
					groupCode: payload.groupCode,
					dimensionsByFreq: payload.dimensionsByFreq
				}
			},
			{ status: 201 }
		);
	} catch (error) {
		console.error('[POST /api/indicators] Failed to create indicator:', error);

		if (isUniqueConstraintError(error)) {
			return json(
				{ error: `Indicator ${payload.code} already exists`, code: payload.code },
				{ status: 409 }
			);
		}

		return json({ error: 'Failed to create indicator' }, { status: 500 });
	}
};
