<script lang="ts">
	import type { IconName } from '$lib/landing/icons';
	import Icon from './Icon.svelte';

	type PreviewSlide = {
		eyebrow: string;
		icon: IconName;
		title: string;
		description: string;
		bullets: string[];
		tags: string[];
	};

	const previewSlides: PreviewSlide[] = [
		{
			eyebrow: 'Explorador',
			icon: 'search',
			title: 'Encuentra el indicador correcto',
			description:
				'Busca por temática o nombre, delimita el área geográfica y trabaja con escalas comunes entre indicadores.',
			bullets: [
				'Analizamos y agregamos múltiples temáticas de política.',
				'Construimos indicadores a través de microdatos.',
				'Presentamos la información de manera optimizada para el dato que quieres ver.'
			],
			tags: ['Visualización', 'Análisis', 'Interpretación']
		},
		{
			eyebrow: 'Controles de visualización',
			icon: 'sliders-horizontal',
			title: 'Filtra y desagrega con claridad',
			description: 'Cada dimensión puede filtrarse o usarse como desglose.',
			bullets: [
				'Rangos de tiempo con inicio y fin.',
				'Filtros por dimensiones disponibles.',
				'Series de tiempo desagregadas por área geográfica, edad, nivel territorial, sexo ¡o lo que imagines! .'
			],
			tags: ['Series de tiempo', 'Desagregaciones listas', 'Análisis más simples']
		},
		{
			eyebrow: 'Graficador y contexto',
			icon: 'line-chart',
			title: 'Visualiza conociendo el contexto del indicador',
			description:
				'El gráfico se presenta contra fichas técnicas que explican unidades, fuentes de información, actualizaciones y forma de medición.',
			bullets: [
				'Gráficas fácil de leer.',
				'Metodologías explicadas para públicos no expertos.',
				'Contexto del indicador siempre claro.'
			],
			tags: ['Gráfico', 'Metodología', 'Contexto']
		}
	];

	let activeSlide = $state(0);
	let activePreview = $derived(previewSlides[activeSlide]);

	$effect(() => {
		const interval = window.setInterval(() => {
			activeSlide = (activeSlide + 1) % previewSlides.length;
		}, 10000);

		return () => window.clearInterval(interval);
	});
</script>

<section id="inicio" class="relative mx-auto max-w-7xl px-6 py-20 md:py-28">
	<div class="grid items-center gap-12 md:grid-cols-2">
		<div>
			<span class="inline-block rounded-full bg-[var(--c-soft)] px-3 py-1 text-sm text-slate-600">
				Plataforma estandarizada de indicadores
			</span>
			<h1 class="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
				Utiliza datos de <span class="text-[var(--c-primary)]">fuentes oficiales</span> para
				diagnosticar, formular e implementar programas y proyectos
				<span class="underline decoration-[var(--c-primary)]/40 underline-offset-4">
					públicos y privados.
				</span>
			</h1>
			<p class="mt-6 max-w-xl text-lg text-slate-600">
				Calculamos, explicamos y presentamos datos para tomar mejores decisiones de política. No
				tienes que ser experto en datos ¡ni en Excel!
			</p>

			<div class="mt-8 flex flex-col gap-3 sm:flex-row">
				<a
					href="/explore"
					class="inline-flex items-center justify-center rounded-xl bg-[var(--c-primary)] px-5 py-3 font-medium text-white shadow hover:bg-[var(--c-primary-600)] focus:outline-none focus:ring-2 focus:ring-[var(--c-primary)]/40"
				>
					<Icon name="play" className="mr-2 h-5 w-5" ariaHidden="true" />
					Ver demo
				</a>
			</div>

			<div class="mt-6 flex items-center gap-4 text-sm text-slate-500">
				<span class="inline-flex items-center gap-1">
					<span class="h-1.5 w-1.5 rounded-full bg-[var(--c-primary)]"></span>
					Privacidad primero
				</span>
				<span class="inline-flex items-center gap-1">
					<span class="h-1.5 w-1.5 rounded-full bg-[var(--c-primary)]"></span>
					Optimizada para SEO
				</span>
			</div>
		</div>

		<div class="relative">
			<div class="rounded-3xl border border-[var(--c-border)] bg-white p-4 shadow-sm">
				<div
					class="min-h-[22rem] rounded-2xl bg-gradient-to-br from-[var(--c-soft)] via-white to-[var(--c-accent-soft)] p-5"
				>
					<div class="flex items-center justify-between gap-4">
						<span
							class="inline-flex items-center gap-2 rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-[var(--c-primary)] shadow-sm"
						>
							<Icon name={activePreview.icon} className="h-4 w-4" ariaHidden="true" />
							{activePreview.eyebrow}
						</span>
						<span class="text-xs font-medium text-[var(--c-muted)]">
							{activeSlide + 1} / {previewSlides.length}
						</span>
					</div>

					<div class="mt-5 rounded-2xl border border-[var(--c-border)] bg-white/90 p-5 shadow-sm">
						<h3 class="text-xl font-semibold text-slate-900">{activePreview.title}</h3>
						<p class="mt-2 text-sm leading-relaxed text-[var(--c-muted)]">
							{activePreview.description}
						</p>

						<div class="mt-5 space-y-3">
							{#each activePreview.bullets as bullet (bullet)}
								<div class="flex items-start gap-3 text-sm text-slate-700">
									<span class="mt-1.5 h-2 w-2 rounded-full bg-[var(--c-primary)]"></span>
									<span>{bullet}</span>
								</div>
							{/each}
						</div>

						<div class="mt-6 flex flex-wrap gap-2">
							{#each activePreview.tags as tag (tag)}
								<span
									class="rounded-full border border-[var(--c-border)] bg-white px-3 py-1 text-xs font-medium text-[var(--c-muted)]"
								>
									{tag}
								</span>
							{/each}
						</div>
					</div>
				</div>
			</div>

			<div class="mt-4 flex justify-center gap-2">
				{#each previewSlides as slide, index (slide.eyebrow)}
					<button
						type="button"
						aria-label={`Ver ${slide.eyebrow}`}
						onclick={() => (activeSlide = index)}
						class={`h-2.5 rounded-full transition-all ${
							activeSlide === index
								? 'w-8 bg-[var(--c-primary)]'
								: 'w-2.5 bg-slate-300 hover:bg-slate-400'
						}`}
					></button>
				{/each}
			</div>
		</div>
	</div>
</section>
