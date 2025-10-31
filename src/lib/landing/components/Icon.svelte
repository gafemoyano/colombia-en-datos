<script lang="ts">
	import type { IconName } from '$lib/landing/icons';
	import { iconNodes } from '$lib/landing/icons';

	export let name: IconName;
	export let className = '';
	export let ariaHidden: 'true' | 'false' | undefined = 'true';
	export let role: string | undefined = undefined;

	const nodes = iconNodes[name];
</script>

<svg
	class={className}
	role={role}
	aria-hidden={ariaHidden}
	xmlns="http://www.w3.org/2000/svg"
	fill="none"
	viewBox="0 0 24 24"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
>
	{#each nodes as [element, attrs]}
		<svelte:element this={element} {...attrs} />
	{/each}
</svg>
