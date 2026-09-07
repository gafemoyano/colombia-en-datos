const MAX_RECORDED_ENTRIES = 120;
const recordedEntries: Array<{ kind: 'mark' | 'measure'; name: string }> = [];
let sequence = 0;

export interface ExplorerPerformanceContext {
	navigationId: string;
	requestId: string;
}

type PerformanceDetail = ExplorerPerformanceContext & {
	component: 'explorer' | 'plotly';
	phase: string;
	status?: 'completed' | 'cancelled';
};

function retain(kind: 'mark' | 'measure', name: string) {
	recordedEntries.push({ kind, name });
	while (recordedEntries.length > MAX_RECORDED_ENTRIES) {
		const expired = recordedEntries.shift();
		if (expired?.kind === 'mark') performance.clearMarks(expired.name);
		else if (expired) performance.clearMeasures(expired.name);
	}
}

export function createNavigationId(): string {
	sequence += 1;
	return `${Date.now().toString(36)}-${sequence.toString(36)}`;
}

export function performanceMark(
	context: ExplorerPerformanceContext,
	component: PerformanceDetail['component'],
	phase: string,
	status?: PerformanceDetail['status']
): string {
	sequence += 1;
	const name = `explorer:${context.navigationId}:${component}:${phase}:${sequence.toString(36)}`;
	performance.mark(name, {
		detail: {
			navigationId: context.navigationId,
			requestId: context.requestId,
			component,
			phase,
			...(status && { status })
		}
	});
	retain('mark', name);
	return name;
}

export function performanceMeasure(
	context: ExplorerPerformanceContext,
	component: PerformanceDetail['component'],
	phase: string,
	start: string | number,
	end: string,
	status: PerformanceDetail['status'] = 'completed'
): string {
	// An old start mark may have been evicted during a long or superseded render.
	if (typeof start === 'string' && !performance.getEntriesByName(start, 'mark').length) return '';
	if (!performance.getEntriesByName(end, 'mark').length) return '';
	sequence += 1;
	const name = `explorer:${context.navigationId}:${component}:${phase}:duration:${sequence.toString(36)}`;
	performance.measure(name, {
		start,
		end,
		detail: {
			navigationId: context.navigationId,
			requestId: context.requestId,
			component,
			phase,
			status
		}
	});
	retain('measure', name);
	return name;
}
