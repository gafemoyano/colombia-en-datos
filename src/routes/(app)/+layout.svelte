<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();
	const exploring = $derived(page.url.pathname === '/explore');
</script>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white shadow">
		<div
			class={exploring
				? 'mx-auto flex h-14 max-w-[1800px] items-center gap-4 px-4 sm:px-6'
				: 'max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8'}
		>
			<h1 class="shrink-0">
				<a href="/" class="block rounded focus-visible:outline-2 focus-visible:outline-offset-4">
					<img
						src="/brand/primary-light.svg"
						alt="Colombian Datos — Inicio"
						width="330"
						height="64"
						class={exploring ? 'h-auto w-[180px] sm:w-[206px]' : 'h-auto w-[247px]'}
					/>
				</a>
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
