<script lang="ts">
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();

	const links = [
		{ href: '/explore', label: 'Explorar' },
		{ href: '/app', label: 'Series' }
	];
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<!--
	Data-tool shell: a 44px header and a fluid container capped at 1920px. The
	previous 1280px cap left ~30% of a 1920px screen empty around a chart.
-->
<div class="bg-muted/40 min-h-screen">
	<header class="bg-card sticky top-0 z-30 border-b">
		<div class="mx-auto flex h-11 max-w-[1920px] items-center gap-6 px-4 sm:px-6">
			<a href="/" class="text-sm font-semibold tracking-tight">Colombia en Datos</a>
			<nav class="flex items-center gap-1 text-sm" aria-label="Secciones">
				{#each links as link}
					{@const active = page.url.pathname.startsWith(link.href)}
					<a
						href={link.href}
						aria-current={active ? 'page' : undefined}
						class={[
							'rounded-md px-2 py-1 transition-colors',
							active
								? 'bg-muted text-foreground font-medium'
								: 'text-muted-foreground hover:text-foreground hover:bg-muted/60'
						]}
					>
						{link.label}
					</a>
				{/each}
			</nav>
		</div>
	</header>
	<main class="mx-auto max-w-[1920px] px-4 py-3 sm:px-6">
		{@render children?.()}
	</main>
</div>
