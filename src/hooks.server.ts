import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { existsSync, copyFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { createRequestTrace, serverTiming, withRequestTrace } from '$lib/server/performance';
import { performance } from 'node:perf_hooks';

function unauthorized() {
	return new Response('Authentication required', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="Colombian Datos Admin"'
		}
	});
}

function isAdminAuthorized(request: Request): boolean {
	const username = env.ADMIN_USERNAME || (dev ? 'admin' : undefined);
	const password = env.ADMIN_PASSWORD || env.ADMIN_TOKEN || (dev ? 'admin' : undefined);

	if (!username || !password) return false;

	const authorization = request.headers.get('authorization');
	if (!authorization?.startsWith('Basic ')) return false;

	const credentials = atob(authorization.slice('Basic '.length));
	const separator = credentials.indexOf(':');
	if (separator === -1) return false;

	const providedUsername = credentials.slice(0, separator);
	const providedPassword = credentials.slice(separator + 1);

	return providedUsername === username && providedPassword === password;
}

function requiresAdminAuth(pathname: string, method: string): boolean {
	return (
		pathname.startsWith('/admin') ||
		pathname.startsWith('/api/admin') ||
		((pathname === '/api/indicators' || pathname === '/api/indicators/') && method !== 'GET')
	);
}

function bootstrapCanonicalDb() {
	const dataPath = process.env.DATA_PATH;
	if (!dataPath) return;

	const targetDir = resolve(dataPath);
	const target = join(targetDir, 'observations.duckdb');
	if (existsSync(target)) return;

	const template = join(process.cwd(), 'data', 'observations.duckdb.template');
	if (!existsSync(template)) return;

	mkdirSync(targetDir, { recursive: true });
	console.log('[bootstrap] Seeding canonical DB from template:', template, '→', target);
	copyFileSync(template, target);
}

export const handle: Handle = async ({ event, resolve }) => {
	bootstrapCanonicalDb();

	if (
		requiresAdminAuth(event.url.pathname, event.request.method) &&
		!isAdminAuthorized(event.request)
	) {
		return unauthorized();
	}

	if (env.PERFORMANCE_TRACING !== '1' || event.route.id !== '/(app)/explore') {
		return resolve(event);
	}

	const trace = createRequestTrace();
	const cpuStart = process.cpuUsage();
	const eluStart = performance.eventLoopUtilization();
	console.info(
		JSON.stringify({
			type: 'explorer-performance-start',
			requestId: trace.requestId,
			timestamp: new Date().toISOString(),
			machine: env.FLY_MACHINE_ID ?? null
		})
	);
	let status = 500;
	return withRequestTrace(trace, async () => {
		try {
			const response = await resolve(event);
			status = response.status;
			// A redirect response can have immutable headers.
			const headers = new Headers(response.headers);
			headers.set('Server-Timing', serverTiming(trace));
			headers.set('X-Request-ID', trace.requestId);
			return new Response(response.body, { status, statusText: response.statusText, headers });
		} finally {
			const cpu = process.cpuUsage(cpuStart);
			console.info(
				JSON.stringify({
					type: 'explorer-performance',
					requestId: trace.requestId,
					timestamp: new Date().toISOString(),
					route: event.route.id,
					dataRequest: event.isDataRequest,
					status,
					durationMs: performance.now() - trace.started,
					machine: env.FLY_MACHINE_ID ?? null,
					region: env.FLY_REGION ?? null,
					version: env.FLY_IMAGE_REF ?? null,
					process: {
						rssBytes: process.memoryUsage.rss(),
						cpuUserMs: cpu.user / 1000,
						cpuSystemMs: cpu.system / 1000,
						eventLoopUtilization: performance.eventLoopUtilization(eluStart).utilization
					},
					spans: trace.spans,
					droppedSpans: trace.droppedSpans
				})
			);
		}
	});
};
