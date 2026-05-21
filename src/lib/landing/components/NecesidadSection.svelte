<script lang="ts">
	import Icon from './Icon.svelte';

	const problemas = [
		'Fuentes fragmentadas, formatos distintos, metadatos incompletos',
		'Tareas manuales y reportes repetitivos que consumen tiempo',
		'Baja interoperabilidad entre sistemas y falta de trazabilidad',
		'Información demasiado agregada, sin granularidad',
		'Capacidades heterogéneas entre personas en el manejo de datos'
	];
</script>

<section id="necesidad" class="bg-[var(--c-soft)]/60">
	<div class="mx-auto max-w-7xl px-6 py-20">
		<p class="text-xs font-semibold uppercase tracking-widest text-slate-500">
			¿Por qué lo hacemos?
		</p>

		<h2 class="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 md:text-5xl">
			Datos públicos dispersos y poco usables
		</h2>

		<div class="mt-6 grid items-start gap-10 md:grid-cols-2">
			<div>
				<p class="text-lg md:text-xl text-slate-700 leading-relaxed">
					La gestión pública necesita evidencia oportuna. Sin embargo, los datos están dispersos
					entre entidades, en formatos heterogéneos y con poca estandarización, lo que dificulta el
					diagnóstico, la formulación y la evaluación de políticas.
				</p>
			</div>

			<div>
				<h3 class="text-2xl font-bold text-slate-900">¿Qué existe hoy?</h3>
				<ul class="mt-4 space-y-3 text-slate-700">
					{#each problemas as problema}
						<li class="flex gap-3">
							<Icon
								name="circle-check"
								className="mt-0.5 h-5 w-5 flex-none text-[var(--c-primary)]"
								ariaHidden="true"
							/>
							<span>{problema}</span>
						</li>
					{/each}
				</ul>

				<div class="mt-5 flex flex-wrap gap-2 text-sm">
					{#each ['Microdatos', 'Interoperabilidad', 'Datos abiertos'] as chip}
						<span class="rounded-full border border-slate-300 bg-white px-3 py-1 text-slate-600">
							{chip}
						</span>
					{/each}
				</div>
			</div>

			<div
				role="note"
				aria-label="Mensaje clave"
				class="md:col-span-2 mt-4 rounded-2xl border border-[var(--c-border)] bg-gradient-to-r from-[var(--c-warm-soft)] to-[var(--c-mint-soft)] p-5 shadow-sm"
			>
				<div class="flex items-start gap-4">
					<div
						class="grid h-10 w-10 place-items-center rounded-xl bg-[var(--c-primary)] text-white"
					>
						<Icon name="layers" className="h-5 w-5" ariaHidden="true" />
					</div>
					<p class="text-base font-medium text-slate-800 md:text-xl">
						<strong class="font-semibold">Unificamos, calculamos y analizamos indicadores</strong> para
						facilitar el diagnóstico, el seguimiento y la evaluación de política pública.
					</p>
				</div>
			</div>
		</div>
	</div>
</section>
