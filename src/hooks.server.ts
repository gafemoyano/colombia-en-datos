import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';
import type { Handle } from '@sveltejs/kit';

function unauthorized() {
	return new Response('Authentication required', {
		status: 401,
		headers: {
			'WWW-Authenticate': 'Basic realm="Colombia en Datos Admin"'
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

export const handle: Handle = async ({ event, resolve }) => {
	if (
		requiresAdminAuth(event.url.pathname, event.request.method) &&
		!isAdminAuthorized(event.request)
	) {
		return unauthorized();
	}

	return resolve(event);
};
