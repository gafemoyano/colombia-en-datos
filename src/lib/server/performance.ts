import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface Span {
	id: number;
	parentId?: number;
	name: string;
	startMs: number;
	durationMs: number;
	status: 'ok' | 'error';
	rows?: number;
}

export interface RequestTrace {
	requestId: string;
	started: number;
	spans: Span[];
	nextId: number;
	droppedSpans: number;
}

const context = new AsyncLocalStorage<{ trace: RequestTrace; parentId?: number }>();
const MAX_SPANS = 256;
const rounded = (value: number) => Math.round(value * 100) / 100;

export function createRequestTrace(): RequestTrace {
	return {
		requestId: randomUUID(),
		started: performance.now(),
		spans: [],
		nextId: 0,
		droppedSpans: 0
	};
}

export function withRequestTrace<T>(trace: RequestTrace, work: () => T): T {
	return context.run({ trace }, work);
}

export function currentRequestId(): string | null {
	return context.getStore()?.trace.requestId ?? null;
}

// Names are static operation labels, never SQL, URLs, parameters or error messages.
export async function measure<T>(name: string, work: () => Promise<T>): Promise<T> {
	const active = context.getStore();
	if (!active) return work();
	const { trace, parentId } = active;
	if (trace.nextId >= MAX_SPANS) {
		trace.droppedSpans++;
		return work();
	}
	const id = ++trace.nextId;
	const started = performance.now();
	const span: Span = {
		id,
		parentId,
		name,
		startMs: rounded(started - trace.started),
		durationMs: 0,
		status: 'ok'
	};
	trace.spans.push(span);
	try {
		const result = await context.run({ trace, parentId: id }, work);
		if (Array.isArray(result)) span.rows = result.length;
		else if (
			result &&
			typeof result === 'object' &&
			'rows' in result &&
			Array.isArray(result.rows)
		) {
			span.rows = result.rows.length;
		}
		return result;
	} catch (error) {
		span.status = 'error';
		throw error;
	} finally {
		span.durationMs = rounded(performance.now() - started);
	}
}

export function traced<A extends unknown[], T>(name: string, work: (...args: A) => Promise<T>) {
	return (...args: A): Promise<T> => measure(name, () => work(...args));
}

export function serverTiming(trace: RequestTrace): string {
	// Bounded headers; full nested detail lives in the JSON log.
	const totals = new Map<string, number>();
	for (const span of trace.spans) {
		totals.set(span.name, (totals.get(span.name) ?? 0) + span.durationMs);
	}
	return [
		`server;dur=${rounded(performance.now() - trace.started)}`,
		...Array.from(totals, ([name, duration]) => `${name};dur=${rounded(duration)}`)
	].join(', ');
}
