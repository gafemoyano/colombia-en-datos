<script lang="ts">
	import type { IconName } from '$lib/landing/icons';
	import Icon from './Icon.svelte';

	const chips = [
		'Series comparables',
		'Metodologías claras',
		'Explicaciones simples',
		'Cálculo de indicadores a través de microdatos'
	];

	const cards: { icon: IconName; title: string; bullets: string[] }[] = [
		{
			icon: 'database',
			title: '¿Qué significa?',
			bullets: [
				'Visualiza fácilmente: gráficas listas para utilizar con filtros simples.',
				'Descarga inmediata: lleva los datos a tu herramienta favorita.',
				'Metodologías de cálculo explicadas para públicos no expertos.',
				'Comparaciones fáciles: normalizaciones a la mano para comparar bien.'
			]
		},
		{
			icon: 'download',
			title: '¿Qué implica para ti?',
			bullets: [
				'Menos búsqueda y limpieza, más tiempo para analizar.',
				'Series de tiempo listas y actualizadas periódicamente.',
				'Resultados confiables y explicables para públicos no técnicos.',
				'Todo en un solo lugar, sin ir a mil fuentes'
			]
		},
		{
			icon: 'git-merge',
			title: '¿Qué ofrecemos?',
			bullets: [
				'Datos e indicadores calculados y explicados claramente.',
				'Gráficas y descargas para uso inmediato.',
				'API simple para integrar o automatizar cuando haga falta.',
				'Análisis a profundidad de temáticas relevantes para ti.'
			]
		}
	];
</script>

<section id="que-hacemos" class="bg-white py-20">
	<div class="mx-auto max-w-7xl px-6">
		<p class="text-xs font-semibold uppercase tracking-widest text-slate-500">¿Qué hacemos?</p>

		<h2 class="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
			Indicadores estandarizados listos para usar
		</h2>
		<p class="mt-4 text-lg md:text-xl text-slate-700 leading-relaxed max-w-5xl">
			Calculamos, unificamos y estandarizamos indicadores de política pública. Descargas y
			visualizaciones listas para que equipos de gobierno, academia, consultoras y sociedad civil
			tomen decisiones sin perder tiempo limpiando datos.
		</p>

		<div class="mt-6 flex flex-wrap gap-2 text-sm">
			{#each chips as chip}
				<span class="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-600">
					{chip}
				</span>
			{/each}
		</div>

		<div class="mt-10 grid gap-6 md:grid-cols-3">
			{#each cards as card (card.title)}
				<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
					<Icon name={card.icon} className="h-7 w-7 text-[var(--c-primary)]" ariaHidden="true" />
					<h3 class="mt-4 text-xl font-semibold text-slate-900">{card.title}</h3>
					<ul class="mt-3 space-y-2 text-slate-600">
						{#each card.bullets as bullet}
							<li class="flex items-start gap-2">
								<span class="mt-2 h-1.5 w-1.5 rounded-full bg-[var(--c-primary)]"></span>
								<span>{bullet}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/each}

			<div class="md:col-span-3">
				<div
					class="mt-2 rounded-2xl border border-[var(--c-border)] bg-gradient-to-r from-[var(--c-mint-soft)] to-[var(--c-coral-soft)] p-5 shadow-sm"
				>
					<div class="flex items-start gap-4">
						<div
							class="grid h-10 w-10 place-items-center rounded-xl bg-[var(--c-primary)] text-white"
						>
							<Icon name="sparkles" className="h-5 w-5" ariaHidden="true" />
						</div>
						<p class="text-base font-medium text-slate-800 md:text-xl">
							<strong class="font-semibold">Convertimos datos públicos de Colombia </strong>
							en indicadores claros y comparables. Disponibles a un clic. Fácil. Rápido.
						</p>
					</div>
				</div>
			</div>
		</div>

		<div class="mt-8 flex flex-col gap-3 sm:flex-row">
			<a
				href="#mas-info"
				class="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 hover:bg-slate-50 focus:ring-2 focus:ring-slate-300"
			>
				¡Quiero más información!
			</a>
		</div>
	</div>
</section>
