<script lang="ts">
	import rawData from '$lib/landing/data/indicators_catalog.json';

	type Indicator = {
		code: string;
		title: string;
		unit?: string | null;
		updated?: string | null;
	};

	type CatalogBlock = {
		category: string;
		subcategory: string;
		indicators: Indicator[];
	};

	const catalog = rawData as CatalogBlock[];
</script>

<section id="indicadores" class="min-h-[100svh] pt-24 scroll-mt-24 snap-start">
	<div class="mx-auto max-w-5xl px-4 sm:px-6">
		<header class="mb-6">
			<h2 class="text-2xl sm:text-3xl font-semibold tracking-tight">Catálogo de indicadores</h2>
			<p class="mt-2 text-zinc-600">
				Lista organizada por temas. Títulos claros, unidad y fecha de actualización.
			</p>
		</header>

		<div class="space-y-8">
			{#each catalog as block (block.category + block.subcategory)}
				<div class="rounded-2xl border border-zinc-200 bg-white/70 backdrop-blur p-5 shadow-sm">
					<h3 class="text-lg font-semibold">
						{block.category} <span class="text-zinc-500">— {block.subcategory}</span>
					</h3>
					<ul class="mt-3 divide-y divide-zinc-200">
						{#each block.indicators as ind (ind.code)}
							<li class="py-3">
								<div class="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1">
									<div>
										<span class="font-medium">{ind.title}</span>
										<span class="text-xs text-zinc-500">({ind.code})</span>
									</div>
									<div class="text-sm text-zinc-600">
										{ind.unit ?? '—'}
										{#if ind.updated}
											<span class="ml-2 text-zinc-500">· act. {ind.updated}</span>
										{/if}
									</div>
								</div>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>

		<p class="mt-4 text-xs text-zinc-500">
			Fuente y metodología estarán enlazadas en cada ficha de indicador. Comparaciones justas: per cápita, por 100
			mil, ajustado por precios.
		</p>
	</div>
</section>
