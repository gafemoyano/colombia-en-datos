<script lang="ts">
	import Icon from './Icon.svelte';
</script>

<section id="inicio" class="relative mx-auto max-w-7xl px-6 py-20 md:py-28">
	<div class="grid items-center gap-12 md:grid-cols-2">
		<div>
			<span class="inline-block rounded-full bg-[var(--c-soft)] px-3 py-1 text-sm text-slate-600">
				Plataforma estandarizada de indicadores
			</span>
			<h1 class="mt-4 text-4xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
				Utiliza datos de <span class="text-[var(--c-primary)]">fuentes oficiales</span> para diagnosticar,
				formular e implementar programas y proyectos
				<span class="underline decoration-[var(--c-primary)]/40 underline-offset-4"> públicos y privados</span>.
			</h1>
			<p class="mt-6 max-w-xl text-lg text-slate-600">
				Calculamos, explicamos y presentamos datos para tomar mejores decisiones de política. No tienes que ser
				experto en datos ¡ni en Excel!
			</p>

			<div class="mt-8 flex flex-col gap-3 sm:flex-row">
				<a
					href="/app"
					class="inline-flex items-center justify-center rounded-xl bg-[var(--c-primary)] px-5 py-3 font-medium text-white shadow hover:bg-[var(--c-primary-600)] focus:outline-none focus:ring-2 focus:ring-[var(--c-primary)]/40"
				>
					<Icon name="play" className="mr-2 h-5 w-5" ariaHidden="true" />
					Ver demo
				</a>
				<a
					href="#indicadores"
					class="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-300"
				>
					Ver lista de indicadores
					<Icon name="arrow-right" className="ml-2 h-5 w-5" ariaHidden="true" />
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

		<div aria-hidden="true" class="relative">
			<div class="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-4 shadow-sm">
				<div class="aspect-[16/10] w-full rounded-2xl bg-gradient-to-br from-slate-100 to-slate-50">
					<div class="flex h-full items-center justify-center text-slate-500">
						Coloca aquí tu captura o video
					</div>
				</div>
			</div>
			<span class="pointer-events-none absolute -left-4 -top-4 rounded-full bg-white px-3 py-1 text-xs shadow">
				Mockup
			</span>
		</div>
	</div>
</section>
