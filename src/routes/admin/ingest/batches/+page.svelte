<script lang="ts">
	import {
		ArrowLeft,
		Database,
		DatabaseZap,
		FileArchive,
		FileUp,
		Layers3,
		Plus,
		Save,
		Send,
		ShieldCheck
	} from 'lucide-svelte';
	import BatchProfileSummary from '$lib/components/admin/BatchProfileSummary.svelte';
	import BatchPublishSummary from '$lib/components/admin/BatchPublishSummary.svelte';
	import DefinitionDraftEditor from '$lib/components/admin/DefinitionDraftEditor.svelte';
	import MappingReview from '$lib/components/admin/MappingReview.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Label from '$lib/components/ui/Label.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { normalizeDataSourceCode } from '$lib/ingest/definitions';
	import type { AdminDefinitionDraftEdit } from '$lib/server/batch-ingest/admin-workflow';
	import type { AcceptedBatchColumnMapping } from '$lib/server/batch-ingest/storage';
	import type { DefinitionValidationResult } from '$lib/server/definition-ingest';
	import { cn } from '$lib/utils';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let selectedDataSourceCode = $state('');
	let dataSourceCode = $state('');
	let dataSourceName = $state('');
	let dataSourceDescription = $state('');
	let definitionEdits = $state<AdminDefinitionDraftEdit[]>([]);
	let reviewedMappings = $state<AcceptedBatchColumnMapping[]>([]);
	let replacementConfirmed = $state(false);
	let initializedBatchId = $state<number | null>(null);

	const existingDataSource = $derived(
		data.dataSources.find((source) => source.code === selectedDataSourceCode) ?? null
	);
	const normalizedCode = $derived(normalizeDataSourceCode(dataSourceCode));
	const batch = $derived(data.batch);
	const definitionEditsJson = $derived(JSON.stringify(definitionEdits));
	const reviewedMappingsJson = $derived(JSON.stringify(reviewedMappings));
	const canStage = $derived(
		batch?.manifest.batch.status === 'analyzed' ||
			(batch?.manifest.batch.status === 'failed' &&
				(!batch.staged || batch.staged.validation.valid))
	);
	const canPublish = $derived(
		batch?.manifest.batch.status === 'staged' && Boolean(batch.staged?.validation.valid)
	);
	const definitionValidation = $derived(
		form && 'validation' in form ? (form.validation as DefinitionValidationResult) : null
	);

	$effect(() => {
		if (form?.action === 'analyze' && form.dataSource) {
			selectedDataSourceCode = '';
			dataSourceCode = form.dataSource.code;
			dataSourceName = form.dataSource.name;
			dataSourceDescription = form.dataSource.description;
		}
	});

	$effect(() => {
		const current = data.batch;
		const currentBatchId = current?.manifest.batch.id ?? null;
		if (currentBatchId === initializedBatchId) return;
		initializedBatchId = currentBatchId;
		definitionEdits =
			current?.definitionDrafts?.drafts.map((draft) => ({
				id: draft.id,
				values: { ...draft.values }
			})) ?? [];
		const sourceMappings =
			current?.acceptedMapping?.mappings ?? current?.profile?.mappings.mappings ?? [];
		reviewedMappings = sourceMappings.map((mapping) => ({
			sourceColumn: mapping.sourceColumn,
			canonicalField: mapping.canonicalField,
			transforms: [...mapping.transforms]
		}));
		replacementConfirmed = false;
	});

	function selectDataSource(event: Event) {
		selectedDataSourceCode = (event.currentTarget as HTMLSelectElement).value;
		const selected = data.dataSources.find((source) => source.code === selectedDataSourceCode);
		if (selected) {
			dataSourceCode = selected.code;
			dataSourceName = selected.name;
			dataSourceDescription = selected.description ?? '';
			return;
		}
		dataSourceCode = '';
		dataSourceName = '';
		dataSourceDescription = '';
	}

	function resultMessage(result: string | null): string | null {
		return (
			{
				analyzed:
					'El archivo se conservó y el análisis terminó. Revisa la evidencia de todos los segmentos antes de continuar.',
				'definitions-saved':
					'Las definiciones se guardaron de forma atómica. Ahora puedes aceptar el mapeo y preparar todos los segmentos.',
				staged:
					'La preparación terminó. Revisa la validación de todos los segmentos antes de publicar.',
				published: 'El lote se publicó y la trazabilidad por segmento quedó registrada.'
			}[result ?? ''] ?? null
		);
	}

	function statusLabel(status: string): string {
		return (
			{
				uploaded: 'Cargado',
				analyzed: 'Analizado',
				staged: 'Preparado',
				publishing: 'Publicando',
				published: 'Publicado',
				failed: 'Fallido'
			}[status] ?? status
		);
	}
</script>

<svelte:head>
	<title>Admin · Ingesta por lotes</title>
</svelte:head>

<div class="mx-auto max-w-7xl space-y-6">
	<header class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
		<div class="space-y-3">
			<a href="/admin/ingest" class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
				<ArrowLeft class="h-4 w-4" />
				Volver a definiciones
			</a>
			<div>
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="text-3xl font-bold tracking-tight text-slate-950">Ingesta por lotes</h1>
					<Badge variant="secondary" class="gap-1">
						<ShieldCheck class="h-3.5 w-3.5" />
						Admin
					</Badge>
				</div>
				<p class="mt-2 max-w-2xl text-sm text-slate-600">
					Carga un archivo Parquet natural con uno o varios indicadores. El sistema deriva cada
					combinación de indicador y frecuencia como un segmento independiente del mismo lote.
				</p>
			</div>
		</div>

		{#if batch}
			<a href="/admin/ingest/batches" class={cn(buttonVariants({ variant: 'outline' }))}>
				<Plus class="h-4 w-4" />
				Nuevo lote
			</a>
		{/if}
	</header>

	{#if resultMessage(data.result)}
		<div
			class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
			role="status"
			aria-live="polite"
		>
			{resultMessage(data.result)}
		</div>
	{/if}

	{#if data.loadError}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			<p class="font-semibold">No se pudo cargar el lote.</p>
			<p class="mt-1">{data.loadError.message}</p>
		</div>
	{/if}

	{#if form?.error}
		<div
			class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
			role="alert"
			aria-live="assertive"
		>
			<p class="font-semibold">La operación no se completó.</p>
			<p class="mt-1">{form.error.message}</p>
			<p class="mt-2 font-medium">
				{form.error.retryable
					? 'Puedes reintentar esta operación con el mismo lote y los mismos datos aceptados.'
					: 'Corrige los datos indicados antes de volver a enviar la operación.'}
			</p>
		</div>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
		<Card class="h-fit p-5">
			<div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
				<FileUp class="h-4 w-4" />
				Cargar y analizar lote
			</div>
			<p class="mt-2 text-sm text-slate-500">
				La fuente de datos es metadato compartido por todos los segmentos derivados. El archivo debe
				ser Parquet y debe declarar sus propios códigos de indicador y frecuencia.
			</p>

			<form method="POST" action="?/analyze" enctype="multipart/form-data" class="mt-5 space-y-4">
				<div class="space-y-2">
					<Label for="existing-data-source">Fuente registrada</Label>
					<select
						id="existing-data-source"
						class="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
						value={selectedDataSourceCode}
						onchange={selectDataSource}
					>
						<option value="">Crear una fuente nueva</option>
						{#each data.dataSources as source}
							<option value={source.code}>{source.name} · {source.code}</option>
						{/each}
					</select>
				</div>

				<div class="space-y-2">
					<Label for="data-source-code">Código de fuente</Label>
					<Input
						id="data-source-code"
						name="data_source_code"
						required
						readonly={Boolean(existingDataSource)}
						value={dataSourceCode}
						placeholder="geih"
						oninput={(event) => (dataSourceCode = (event.currentTarget as HTMLInputElement).value)}
					/>
					{#if !existingDataSource}
						<p class="text-xs text-slate-500">
							Identidad estable: <span class="font-mono text-slate-700"
								>{normalizedCode || '—'}</span
							>
						</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="data-source-name">Nombre de fuente</Label>
					<Input
						id="data-source-name"
						name="data_source_name"
						required
						readonly={Boolean(existingDataSource)}
						value={dataSourceName}
						placeholder="Gran Encuesta Integrada de Hogares"
						oninput={(event) => (dataSourceName = (event.currentTarget as HTMLInputElement).value)}
					/>
				</div>

				<div class="space-y-2">
					<Label for="data-source-description">Descripción (opcional)</Label>
					<Textarea
						id="data-source-description"
						name="data_source_description"
						readonly={Boolean(existingDataSource)}
						class="min-h-24"
						value={dataSourceDescription}
						placeholder="Contexto breve sobre la entrega o entidad productora."
						oninput={(event) =>
							(dataSourceDescription = (event.currentTarget as HTMLTextAreaElement).value)}
					/>
					{#if existingDataSource}
						<p class="text-xs text-slate-500">
							Los metadatos registrados son de solo lectura. Un conflicto se rechaza; no se
							actualiza la fuente durante la carga.
						</p>
					{/if}
				</div>

				<div class="space-y-2">
					<Label for="batch-file">Archivo Parquet</Label>
					<input
						id="batch-file"
						name="file"
						type="file"
						accept=".parquet,application/vnd.apache.parquet"
						required
						class="block w-full rounded-md border border-slate-200 bg-white text-sm text-slate-600 file:mr-3 file:border-0 file:border-r file:border-slate-200 file:bg-slate-50 file:px-3 file:py-2.5 file:text-sm file:font-medium file:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
					/>
				</div>

				<Button type="submit" class="w-full" disabled={!normalizedCode || !dataSourceName.trim()}>
					<FileArchive class="h-4 w-4" />
					Conservar y analizar
				</Button>
			</form>
		</Card>

		<div class="space-y-6">
			{#if batch}
				<Card class="overflow-hidden">
					<div
						class="flex flex-col gap-4 border-b border-slate-200 p-5 sm:flex-row sm:items-start sm:justify-between"
					>
						<div>
							<div class="flex flex-wrap items-center gap-2">
								<h2 class="font-semibold text-slate-950">Lote #{batch.manifest.batch.id}</h2>
								<Badge
									variant={batch.manifest.batch.status === 'failed' ? 'destructive' : 'secondary'}
								>
									{statusLabel(batch.manifest.batch.status)}
								</Badge>
							</div>
							<p class="mt-1 text-sm text-slate-500">
								{batch.manifest.batch.originalName || 'Archivo sin nombre'}
							</p>
						</div>
						<div class="text-left text-xs text-slate-500 sm:text-right">
							<div>{batch.manifest.totals.sliceCount} segmentos derivados</div>
							<div>
								{batch.manifest.totals.rowCount ?? batch.manifest.batch.rowCount ?? '—'} filas
							</div>
						</div>
					</div>
					<div class="grid gap-4 p-5 text-sm sm:grid-cols-2">
						<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
							<div class="flex items-center gap-2 font-medium text-slate-950">
								<Database class="h-4 w-4" /> Fuente de datos
							</div>
							{#if batch.dataSource}
								<div class="mt-2">{batch.dataSource.name}</div>
								<div class="mt-1 font-mono text-xs text-slate-500">{batch.dataSource.code}</div>
							{:else}
								<div class="mt-2 text-red-700">Sin fuente vinculada</div>
							{/if}
						</div>
						<div class="rounded-lg border border-slate-200 bg-slate-50 p-4">
							<div class="flex items-center gap-2 font-medium text-slate-950">
								<Layers3 class="h-4 w-4" /> Modelo del lote
							</div>
							<p class="mt-2 text-slate-600">
								Un archivo origina varios segmentos. Ningún código global de indicador se solicita
								para la carga.
							</p>
						</div>
					</div>
				</Card>

				{#if batch.profile}
					<BatchProfileSummary profile={batch.profile} />
				{/if}

				{#if batch.definitionDrafts}
					<form method="POST" action="?/saveDefinitions" class="space-y-4">
						<input type="hidden" name="batch_id" value={batch.manifest.batch.id} />
						<input type="hidden" name="definition_edits" value={definitionEditsJson} />
						<DefinitionDraftEditor
							drafts={batch.definitionDrafts.drafts}
							bind:edits={definitionEdits}
							disabled={batch.manifest.batch.status === 'published'}
						/>

						{#if form?.action === 'save-definitions' && definitionValidation}
							<div
								class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
								role="alert"
								aria-live="assertive"
							>
								<p class="font-semibold">
									No se guardó ninguna definición. Corrige {definitionValidation.errors.length}
									error(es) y vuelve a enviar todas las filas.
								</p>
								<div class="mt-3 overflow-x-auto">
									<table class="min-w-full text-xs">
										<caption class="sr-only">Errores de validación de definiciones</caption>
										<thead>
											<tr>
												<th class="pb-2 pr-4 text-left font-medium">Fila</th>
												<th class="pb-2 pr-4 text-left font-medium">Campo</th>
												<th class="pb-2 text-left font-medium">Acción requerida</th>
											</tr>
										</thead>
										<tbody>
											{#each definitionValidation.errors as error}
												<tr class="border-t border-red-200 align-top">
													<td class="py-2 pr-4 font-mono">{error.rowNumber}</td>
													<td class="py-2 pr-4 font-mono">{error.field}</td>
													<td class="py-2">{error.message}</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							</div>
						{/if}

						<div class="flex justify-end">
							<Button type="submit" disabled={batch.manifest.batch.status === 'published'}>
								<Save class="h-4 w-4" />
								Guardar todas las definiciones
							</Button>
						</div>
					</form>
				{/if}

				{#if batch.profile && reviewedMappings.length > 0}
					<form method="POST" action="?/stage" class="space-y-4">
						<input type="hidden" name="batch_id" value={batch.manifest.batch.id} />
						<input type="hidden" name="mappings" value={reviewedMappingsJson} />
						<MappingReview
							profile={batch.profile}
							bind:mappings={reviewedMappings}
							accepted={Boolean(batch.acceptedMapping)}
							disabled={!canStage}
						/>

						{#if batch.manifest.batch.status === 'failed' && batch.staged && !batch.staged.validation.valid}
							<div
								class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
								role="alert"
							>
								<p class="font-semibold">La validación preparada contiene errores persistentes.</p>
								<p class="mt-1">
									Este contrato aceptado no puede corregirse dentro del lote. Revisa los
									diagnósticos y carga un lote nuevo con el mapeo o los datos corregidos.
								</p>
							</div>
						{/if}

						<div class="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
							<p class="font-semibold text-slate-950">Aceptación y preparación atómicas</p>
							<p class="mt-1">
								La operación acepta el mapeo completo, aplica automáticamente los colapsos fijos
								documentados y prepara todos los segmentos. No admite selección parcial.
							</p>
						</div>

						<div class="flex justify-end">
							<Button type="submit" disabled={!canStage}>
								<DatabaseZap class="h-4 w-4" />
								{batch.acceptedMapping
									? 'Reintentar preparación sin cambiar el mapeo'
									: 'Aceptar mapeo y preparar lote'}
							</Button>
						</div>
					</form>
				{/if}

				{#each batch.errors as workflowError}
					<div
						class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
						role="alert"
					>
						<p class="font-semibold">No se pudo reconstruir un artefacto del lote.</p>
						<p class="mt-1">{workflowError.message}</p>
					</div>
				{/each}

				<BatchPublishSummary staged={batch.staged} published={batch.published} />

				{#if canPublish}
					<Card class="p-5">
						<form method="POST" action="?/publish" class="space-y-4">
							<input type="hidden" name="batch_id" value={batch.manifest.batch.id} />
							<div>
								<div class="flex items-center gap-2 font-semibold text-slate-950">
									<Send class="h-4 w-4" /> Publicar lote completo
								</div>
								<p class="mt-2 text-sm text-slate-600">
									La publicación reemplaza únicamente las combinaciones
									<code class="font-mono text-xs">indicator_code + freq</code> presentes en este lote.
									Los segmentos ausentes permanecen intactos. Todos los segmentos presentes se publican
									o ninguno se publica.
								</p>
							</div>

							<label
								class="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
							>
								<input
									type="checkbox"
									name="confirm_replacement"
									value="yes"
									bind:checked={replacementConfirmed}
									required
									class="mt-0.5 h-4 w-4 rounded border-amber-400 accent-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
								/>
								<span>
									<strong
										>Confirmo el reemplazo de los {batch.staged?.totals.sliceCount} segmentos presentes.</strong
									>
									Se crearán liberaciones de linaje separadas para cada segmento y no se modificarán los
									indicadores o frecuencias ausentes.
								</span>
							</label>

							<div class="flex justify-end">
								<Button type="submit" disabled={!replacementConfirmed}>
									<Send class="h-4 w-4" /> Publicar todos los segmentos
								</Button>
							</div>
						</form>
					</Card>
				{:else if batch.manifest.batch.status === 'publishing'}
					<div
						class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
						role="status"
						aria-live="polite"
					>
						<p class="font-semibold">La publicación está en curso o pendiente de recuperación.</p>
						<p class="mt-1">
							No inicies otra operación. Recarga este lote para consultar el punto durable y el
							resultado de linaje.
						</p>
					</div>
				{/if}
			{:else}
				<Card class="p-10 text-center">
					<Layers3 class="mx-auto h-8 w-8 text-slate-400" />
					<h2 class="mt-4 font-semibold text-slate-950">Ningún lote seleccionado</h2>
					<p class="mx-auto mt-2 max-w-lg text-sm text-slate-500">
						Carga un archivo para crear un lote durable. Después del análisis, la URL conservará su
						identificador para recargar o reintentar el flujo sin perder contexto.
					</p>
				</Card>
			{/if}
		</div>
	</div>
</div>
