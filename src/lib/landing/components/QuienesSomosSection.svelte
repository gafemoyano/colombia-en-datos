<section id="quienes-somos" class="bg-white">
	<div class="mx-auto max-w-5xl px-6 py-20 text-center">
		<h2 class="text-3xl font-bold text-slate-900 md:text-4xl">¿Quiénes somos?</h2>
		<p class="mt-3 text-lg text-slate-600 max-w-3xl mx-auto">
			Colombia en Datos es un equipo de expertos que quiere que en Colombia las ideas, programas, políticas y
			avances se discutan con datos y no con especulaciones. Nuestra misión es poner la información al alcance de
			cualquier persona para que pueda argumentar mejor, comparar con claridad y mostrar resultados que importan.
			Visualizar y hablar de lo que pasa en serio, con evidencia.
		</p>

		<div class="mt-10 flex justify-center">
			<div class="max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm text-left">
				<div class="flex items-center gap-4">
					<div class="grid h-12 w-12 place-items-center rounded-full bg-slate-100 font-semibold text-slate-700">
						JF
					</div>
					<div>
						<a
							href="/cv.pdf"
							target="_blank"
							rel="noopener noreferrer"
							class="font-semibold text-slate-900 hover:text-[var(--c-primary)] underline decoration-[var(--c-primary)]/40 underline-offset-4"
						>
							Juan Fernando Ortiz Serrano
						</a>
						<div class="text-sm text-slate-500">Fundador</div>
					</div>
				</div>
				<p class="mt-4 text-slate-700">
					Transformo datos complejos en información estratégica para orientar decisiones de inversión,
					monitorear KPIs y evaluar impacto.
				</p>
			</div>
		</div>

		<div class="mt-12 grid gap-6 sm:grid-cols-3">
			{#each [
				{ title: 'Claridad metodológica', description: 'Documentamos formas de cálculo.' },
				{ title: 'Visualización al instante', description: 'Visualiza y descarga con un clic.' },
				{ title: 'Actualización responsable', description: 'Versionamos fuentes y comunicamos cambios.' }
			] as value (value.title)}
				<div class="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
					<h3 class="text-base font-semibold text-slate-900">{value.title}</h3>
					<p class="mt-2 text-sm text-slate-600">{value.description}</p>
				</div>
			{/each}
		</div>
	</div>
</section>
