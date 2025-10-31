import { writable } from 'svelte/store';

export const selectedIndicators = writable<string[]>(['GDP']);
export const availableIndicators = writable<string[]>([]);
