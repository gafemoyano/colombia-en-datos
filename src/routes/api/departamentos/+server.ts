import { json } from '@sveltejs/kit';
import { db } from '$lib/db/client';
import { departamentos } from '$lib/db/schema';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	const deps = await db.select().from(departamentos).orderBy(departamentos.name);
	return json({ departamentos: deps });
};
