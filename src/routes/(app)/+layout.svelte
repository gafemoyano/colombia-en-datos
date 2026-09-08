<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { page } from '$app/state';

	let { children } = $props();
	const exploring = $derived(page.url.pathname === '/explore');
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white shadow">
		<div
			class={exploring
				? 'mx-auto flex h-14 max-w-[1800px] items-center gap-4 px-4 sm:px-6'
				: 'max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8'}
		>
			<h1
				class={exploring
					? 'text-lg font-semibold tracking-tight text-gray-900'
					: 'text-3xl font-bold text-gray-900'}
			>
				Colombian Datos
			</h1>
			{#if exploring}<span class="border-l pl-4 text-sm text-muted-foreground">Explorador</span
				>{/if}
		</div>
	</header>
	<main
		class={exploring
			? 'mx-auto max-w-[1800px] px-4 py-4 sm:px-6'
			: 'max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8'}
	>
		{@render children?.()}
	</main>
</div>
