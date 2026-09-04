<script lang="ts">
	type Status = 'idle' | 'loading' | 'success' | 'error';

	const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	const FORMSPREE_ENDPOINT = 'https://formspree.io/f/mpwjgvgo';

	let status = $state<Status>('idle');
	let errors = $state<Record<string, string>>({});
	let form = $state({
		email: '',
		motivo: '',
		entidadRol: '',
		personaRol: '',
		acepta: false,
		interesFinanciar: false,
		_gotcha: ''
	});

	function clearError(field: string) {
		if (!(field in errors)) return;
		const nextErrors = { ...errors };
		delete nextErrors[field];
		errors = nextErrors;
	}

	function validate() {
		const nextErrors: Record<string, string> = {};
		if (!form.email.trim()) nextErrors.email = 'Por favor escribe tu correo.';
		else if (!emailRe.test(form.email)) nextErrors.email = 'Revisa el formato del correo.';

		if (!form.motivo.trim()) nextErrors.motivo = 'Cuéntanos por qué te interesa.';
		else if (form.motivo.trim().length < 10) nextErrors.motivo = 'Agrega un poco más de detalle.';

		if (!form.acepta) nextErrors.acepta = 'Debes aceptar la política de privacidad para continuar.';
		if (form._gotcha) nextErrors._gotcha = 'Solicitud inválida.';

		errors = nextErrors;
		return Object.keys(nextErrors).length === 0;
	}

	function resetForm() {
		form = {
			email: '',
			motivo: '',
			entidadRol: '',
			personaRol: '',
			acepta: false,
			interesFinanciar: false,
			_gotcha: ''
		};
	}

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		if (!validate()) return;

		status = 'loading';
		try {
			const payload = {
				email: form.email,
				motivo: form.motivo,
				entidadRol: form.entidadRol || '(no especificado)',
				personaRol: form.personaRol || '(no especificado)',
				acepta: form.acepta ? 'sí' : 'no',
				interesFinanciar: form.interesFinanciar ? 'sí' : 'no',
				_subject: 'Nueva solicitud de información - ColombianDatos',
				_gotcha: form._gotcha,
				_page: typeof window !== 'undefined' ? window.location.href : ''
			};

			const response = await fetch(FORMSPREE_ENDPOINT, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'application/json'
				},
				body: JSON.stringify(payload)
			});

			if (!response.ok) throw new Error('Fallo en el envío');

			status = 'success';
			resetForm();
		} catch (error) {
			console.error(error);
			status = 'error';
		} finally {
			setTimeout(() => {
				status = 'idle';
			}, 3000);
		}
	}
</script>

<section
	id="mas-info"
	class="min-h-[100svh] pt-24 flex items-center scroll-mt-24"
	aria-labelledby="masinfo-title"
>
	<div class="mx-auto max-w-3xl px-4 sm:px-6">
		<div
			class="rounded-2xl border border-zinc-200/70 bg-white/70 backdrop-blur p-6 sm:p-8 shadow-sm"
		>
			<header class="mb-6">
				<h2 id="masinfo-title" class="text-2xl sm:text-3xl font-semibold tracking-tight">
					¿Quieres conocer mejor a Colombia y sus datos?
				</h2>
				<p class="mt-2 text-zinc-600">
					Escríbenos y cuéntanos qué necesitas. Nos pondremos en contacto.
				</p>
			</header>

			<form class="space-y-6" onsubmit={handleSubmit} novalidate>
				<div aria-live="polite" class="text-sm">
					{#if status === 'loading'}
						<p class="text-zinc-600">Enviando tu solicitud...</p>
					{:else if status === 'success'}
						<p class="text-green-700">Listo. Recibimos tu solicitud. Te contactaremos pronto.</p>
					{:else if status === 'error'}
						<p class="text-red-700">Tuvimos un problema al enviar. Intenta de nuevo.</p>
					{/if}
				</div>

				<div class="hidden" aria-hidden="true">
					<label for="_gotcha" class="sr-only">No completar</label>
					<input
						id="_gotcha"
						name="_gotcha"
						type="text"
						tabindex="-1"
						autocomplete="off"
						bind:value={form._gotcha}
						oninput={() => clearError('_gotcha')}
					/>
				</div>

				<div>
					<label for="email" class="block text-sm font-medium">Correo electrónico*</label>
					<input
						id="email"
						name="email"
						type="email"
						inputmode="email"
						autocomplete="email"
						class="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10"
						placeholder="tucorreo@ejemplo.com"
						bind:value={form.email}
						aria-invalid={errors.email ? 'true' : 'false'}
						aria-describedby={errors.email ? 'email-error' : undefined}
						oninput={() => clearError('email')}
					/>
					{#if errors.email}
						<p id="email-error" role="alert" class="mt-1 text-sm text-red-700">
							{errors.email}
						</p>
					{/if}
				</div>

				<div>
					<label for="motivo" class="block text-sm font-medium"
						>¿Qué te interesa de ColombianDatos?*</label
					>
					<textarea
						id="motivo"
						name="motivo"
						rows="5"
						class="mt-1 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10"
						placeholder="Ej. Comparar municipios, descargar series normalizadas (per cápita/100 mil), documentar metodología."
						bind:value={form.motivo}
						aria-invalid={errors.motivo ? 'true' : 'false'}
						aria-describedby={errors.motivo ? 'motivo-error' : undefined}
						oninput={() => clearError('motivo')}
					></textarea>
					{#if errors.motivo}
						<p id="motivo-error" role="alert" class="mt-1 text-sm text-red-700">
							{errors.motivo}
						</p>
					{/if}
				</div>

				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label for="entidadRol" class="block text-sm font-medium"
							>Tipo de entidad (opcional)</label
						>
						<select
							id="entidadRol"
							name="entidadRol"
							class="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10"
							bind:value={form.entidadRol}
						>
							<option value="">Selecciona una opción</option>
							<option>Entidad de gobierno</option>
							<option>ONG - Sociedad Civil</option>
							<option>Empresa / Consultora</option>
							<option>Universidad - Docente/Investigación</option>
							<option>Organismo Multilateral</option>
							<option>Medios de comunicación</option>
							<option>Otro</option>
						</select>
					</div>

					<div>
						<label for="personaRol" class="block text-sm font-medium"
							>Rol en la entidad (opcional)</label
						>
						<select
							id="personaRol"
							name="personaRol"
							class="mt-2 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 shadow-inner focus:outline-none focus:ring-2 focus:ring-black/10"
							bind:value={form.personaRol}
						>
							<option value="">Selecciona una opción</option>
							<option>Investigador</option>
							<option>Servidor/a público/a</option>
							<option>Consultor(a)</option>
							<option>Estudiante</option>
							<option>Periodista/Sociedad civil</option>
							<option>Otro</option>
						</select>
					</div>
				</div>

				<div class="flex items-start gap-3">
					<input
						id="interesFinanciar"
						name="interesFinanciar"
						type="checkbox"
						class="mt-1 size-5 rounded border-zinc-300 accent-[var(--c-primary)]"
						bind:checked={form.interesFinanciar}
					/>
					<label for="interesFinanciar" class="text-sm">Me interesa financiar este proyecto.</label>
				</div>

				<div class="flex items-start gap-3">
					<input
						id="acepta"
						name="acepta"
						type="checkbox"
						class="mt-1 size-5 rounded border-zinc-300 accent-[var(--c-primary)]"
						bind:checked={form.acepta}
						aria-invalid={errors.acepta ? 'true' : 'false'}
						aria-describedby={errors.acepta ? 'acepta-error' : undefined}
						onchange={() => clearError('acepta')}
					/>
					<label for="acepta" class="text-sm">
						Acepto la política de privacidad y el uso de mis datos para ser contactado sobre esta
						solicitud.
					</label>
				</div>
				{#if errors.acepta}
					<p id="acepta-error" role="alert" class="mt-1 text-sm text-red-700">
						{errors.acepta}
					</p>
				{/if}

				<div class="pt-2">
					<button
						type="submit"
						class="inline-flex items-center justify-center rounded-xl bg-[var(--c-primary)] px-5 py-3 text-white font-medium shadow hover:bg-[var(--c-primary-600)] disabled:opacity-50"
						disabled={status === 'loading'}
					>
						{status === 'loading' ? 'Enviando...' : 'Enviar solicitud'}
					</button>
					<p class="mt-2 text-xs text-zinc-500">
						Visualiza en un clic. Descarga al instante. API simple cuando se necesite.
					</p>
				</div>
			</form>
		</div>
	</div>
</section>
