<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ArrowLeft, Database, FileSpreadsheet, ListChecks, Sparkles } from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Label from '$lib/components/ui/Label.svelte';
	import Separator from '$lib/components/ui/Separator.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { normalizeDataSourceCode } from '$lib/ingest/definitions';
	import { cn } from '$lib/utils';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const sampleDefinitionText = '';
	let dataSourceCode = $state('');
	let dataSourceName = $state('');
	let definitionText = $state('');
	const normalizedPreview = $derived(normalizeDataSourceCode(dataSourceCode));
	const selectedExists = $derived(Boolean(data.selectedDataSource));

	$effect(() => {
		dataSourceCode = data.selectedInput.code;
		dataSourceName = data.selectedInput.name;
	});

	$effect(() => {
		definitionText = form?.definitionText || sampleDefinitionText;
	});

	function frequencyLabel(freq: string): string {
		return freq === 'M' ? 'Mensual' : freq === 'A' ? 'Anual' : freq;
	}

	function ingestHref(params: URLSearchParams): string {
		const search = params.toString();
		return search ? `/admin/ingest?${search}` : '/admin/ingest';
	}

	function handleExistingDataSourceChange(event: Event) {
		const code = (event.currentTarget as HTMLSelectElement).value;
		const params = new URLSearchParams(page.url.searchParams);

		if (code) {
			params.set('data_source', code);
			params.delete('data_source_name');
		} else {
			params.delete('data_source');
			params.delete('data_source_name');
		}

		goto(ingestHref(params), { keepFocus: true, noScroll: false });
	}
</script>

<svelte:head>
	<title>Admin · Ingesta de definiciones</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6">
	<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
		<div class="space-y-3">
			<a href="/admin" class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
				<ArrowLeft class="h-4 w-4" />
				Volver a indicadores
			</a>
			<div>
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="text-3xl font-bold tracking-tight text-slate-950">Ingesta de definiciones</h1>
					<Badge variant="secondary" class="gap-1">
						<Sparkles class="h-3.5 w-3.5" />
						Admin
					</Badge>
				</div>
				<p class="mt-2 max-w-2xl text-sm text-slate-500">
					Prepara definiciones de frecuencias de indicadores para una fuente de datos. Las
					definiciones guardadas sin observaciones publicadas deben verse aquí, no en el explorador
					público.
				</p>
			</div>
		</div>

		<a href="/admin" class={cn(buttonVariants({ variant: 'outline' }))}>Catálogo admin</a>
	</div>

	{#if data.saved}
		<div class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
			Definiciones guardadas. La página se recargó con la fuente de datos seleccionada.
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[360px_1fr]">
		<div class="space-y-6">
			<Card class="p-5">
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
					<Database class="h-4 w-4" />
					Fuente de datos
				</div>
				<p class="mt-2 text-sm text-slate-500">
					Selecciona una fuente existente o escribe una nueva. El código estable se normaliza a
					lowercase snake-case antes de usarlo en la URL.
				</p>
				<Separator class="my-5" />

				<div class="space-y-2">
					<Label for="existing-data-source">Fuente existente</Label>
					<select
						id="existing-data-source"
						class="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
						value={data.selectedDataSource?.code || ''}
						onchange={handleExistingDataSourceChange}
					>
						<option value="">Nueva fuente o sin seleccionar</option>
						{#each data.dataSources as dataSource}
							<option value={dataSource.code}>{dataSource.name} · {dataSource.code}</option>
						{/each}
					</select>
				</div>

				<form method="GET" class="mt-5 space-y-4">
					<div class="space-y-2">
						<Label for="data-source-code">Código de fuente</Label>
						<Input
							id="data-source-code"
							name="data_source"
							value={dataSourceCode}
							placeholder="Gran Encuesta Integrada de Hogares"
							oninput={(event) =>
								(dataSourceCode = (event.currentTarget as HTMLInputElement).value)}
						/>
					</div>

					<div class="space-y-2">
						<Label for="data-source-name">Nombre de fuente</Label>
						<Input
							id="data-source-name"
							name="data_source_name"
							value={dataSourceName}
							placeholder="Gran Encuesta Integrada de Hogares"
							oninput={(event) =>
								(dataSourceName = (event.currentTarget as HTMLInputElement).value)}
						/>
						{#if selectedExists}
							<p class="text-xs text-slate-500">
								Esta fuente ya existe. La ingesta no debe renombrarla.
							</p>
						{/if}
					</div>

					<div class="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
						<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
							Código normalizado
						</div>
						<div class="mt-1 font-mono text-slate-950">{normalizedPreview || '—'}</div>
					</div>

					<Button type="submit" class="w-full" disabled={!normalizedPreview}>Usar fuente</Button>
				</form>
			</Card>

			<Card class="p-5">
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
					<FileSpreadsheet class="h-4 w-4" />
					Grilla de definiciones
				</div>
				<p class="mt-2 text-sm text-slate-500">
					Pega filas copiadas desde una hoja de cálculo. Las columnas se separan automáticamente por
					tabulación; CSV no está soportado. En la columna
					<code class="rounded bg-slate-100 px-1 font-mono">dimensions</code>, usa coma para
					múltiples códigos.
				</p>

				<div class="mt-4 overflow-hidden rounded-lg border border-slate-200 text-xs">
					<table class="min-w-full">
						<thead class="bg-slate-50 text-slate-500">
							<tr>
								<th class="px-3 py-2 text-left font-medium">indicator_code</th>
								<th class="px-3 py-2 text-left font-medium">freq</th>
								<th class="px-3 py-2 text-left font-medium">name</th>
								<th class="px-3 py-2 text-left font-medium">dimensions</th>
							</tr>
						</thead>
						<tbody class="bg-white">
							<tr>
								<td class="px-3 py-2 font-mono">EMP</td>
								<td class="px-3 py-2 font-mono">M</td>
								<td class="px-3 py-2">Empleo</td>
								<td class="px-3 py-2 font-mono">SEX, AGE</td>
							</tr>
						</tbody>
					</table>
				</div>

				<form method="POST" class="mt-4 space-y-4">
					<input type="hidden" name="data_source" value={normalizedPreview} />
					<input type="hidden" name="data_source_name" value={dataSourceName} />
					<Textarea
						name="definition_text"
						class="min-h-44 font-mono text-xs"
						value={definitionText}
						placeholder="Pega aquí las filas copiadas desde tu hoja de cálculo…"
						oninput={(event) =>
							(definitionText = (event.currentTarget as HTMLTextAreaElement).value)}
					/>
					<Button type="submit" class="w-full" disabled={!normalizedPreview}
						>Guardar definiciones</Button
					>
				</form>

				{#if form?.validation}
					<div
						class="mt-4 rounded-lg border p-3 text-sm {form.validation.valid
							? 'border-emerald-200 bg-emerald-50 text-emerald-800'
							: 'border-red-200 bg-red-50 text-red-800'}"
					>
						{#if form.validation.valid}
							La grilla es válida.
						{:else}
							La grilla tiene {form.validation.errors.length} error(es). No se guardó ninguna fila.
						{/if}
					</div>

					{#if form.validation.errors.length > 0}
						<div class="mt-4 overflow-hidden rounded-lg border border-red-200">
							<table class="min-w-full text-xs">
								<thead class="bg-red-50 text-red-700">
									<tr>
										<th class="px-3 py-2 text-left font-medium">Fila</th>
										<th class="px-3 py-2 text-left font-medium">Campo</th>
										<th class="px-3 py-2 text-left font-medium">Error</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-red-100 bg-white">
									{#each form.validation.errors as error}
										<tr>
											<td class="px-3 py-2 font-mono">{error.rowNumber}</td>
											<td class="px-3 py-2 font-mono">{error.field}</td>
											<td class="px-3 py-2">{error.message}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					{/if}
				{/if}
			</Card>
		</div>

		<Card class="overflow-hidden">
			<div
				class="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<div>
					<div class="flex items-center gap-2 font-semibold text-slate-950">
						<ListChecks class="h-4 w-4" />
						Frecuencias definidas
					</div>
					<p class="mt-1 text-sm text-slate-500">
						{#if data.selectedInput.code}
							Fuente <span class="font-mono">{data.selectedInput.code}</span>
						{:else}
							Selecciona una fuente de datos para ver sus definiciones.
						{/if}
					</p>
				</div>
				<Badge variant={data.definitions.length > 0 ? 'secondary' : 'outline'}>
					{data.definitions.length} definiciones
				</Badge>
			</div>

			{#if data.selectedInput.code && data.definitions.length > 0}
				<div class="overflow-x-auto">
					<table class="min-w-full text-sm">
						<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
							<tr>
								<th class="px-5 py-3 text-left font-medium">Indicador</th>
								<th class="px-5 py-3 text-left font-medium">Grupo</th>
								<th class="px-5 py-3 text-left font-medium">Frecuencia</th>
								<th class="px-5 py-3 text-left font-medium">Dimensiones</th>
								<th class="px-5 py-3 text-left font-medium">Estado</th>
							</tr>
						</thead>
						<tbody class="divide-y">
							{#each data.definitions as definition}
								<tr class="hover:bg-slate-50/70">
									<td class="max-w-md px-5 py-4">
										<div class="font-medium text-slate-950">{definition.indicatorName}</div>
										<div class="mt-1 font-mono text-xs text-slate-500">
											{definition.indicatorCode}
										</div>
									</td>
									<td class="px-5 py-4 text-slate-600">
										<div>{definition.groupName}</div>
										<div class="mt-1 font-mono text-xs text-slate-500">{definition.groupCode}</div>
									</td>
									<td class="px-5 py-4">
										<Badge variant="secondary">{frequencyLabel(definition.freq)}</Badge>
									</td>
									<td class="px-5 py-4">
										{#if definition.dimensions.length > 0}
											<div class="flex flex-wrap gap-1.5">
												{#each definition.dimensions as dimension}
													<Badge variant="outline" class="font-mono">{dimension}</Badge>
												{/each}
											</div>
										{:else}
											<span class="text-slate-500">Sin dimensiones</span>
										{/if}
									</td>
									<td class="px-5 py-4">
										<Badge variant={definition.published ? 'success' : 'warning'}>
											{definition.published ? 'Con observaciones' : 'Sin publicar'}
										</Badge>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else if data.selectedInput.code}
				<div class="p-10 text-center">
					<p class="font-medium text-slate-950">No hay frecuencias definidas para esta fuente.</p>
					<p class="mt-1 text-sm text-slate-500">
						Cuando el guardado esté conectado, las nuevas definiciones aparecerán aquí después de
						recargar la página.
					</p>
				</div>
			{:else}
				<div class="p-10 text-center">
					<p class="font-medium text-slate-950">Selecciona una fuente para comenzar.</p>
					<p class="mt-1 text-sm text-slate-500">
						El estado de la ruta mantiene la fuente seleccionada para que puedas recargar o
						compartir el enlace admin.
					</p>
				</div>
			{/if}
		</Card>
	</div>
</div>
