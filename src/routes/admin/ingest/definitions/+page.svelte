<script lang="ts">
	import { goto } from '$app/navigation';
	import { CheckCircle2, ClipboardList, Database, Info, Save, Table2 } from 'lucide-svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import type { ActionData, PageData } from './$types';

	function normalizeCode(value: string): string {
		return value
			.normalize('NFD')
			.replace(/[\u0300-\u036f]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '_')
			.replace(/^_+|_+$/g, '')
			.replace(/_+/g, '_');
	}

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const exampleDefinitions = `indicator_code\tfreq\tname\tdimensions\tgroup_code\tgroup_name\tunit\tunit_mult\tdecimals
EMP_RATE\tM\tTasa de ocupación\tGEO_LEVEL, DEPT_CODE\templeo\tMercado laboral\tPorcentaje\t0\t1
EMP_RATE\tA\tTasa de ocupación\tGEO_LEVEL, DEPT_CODE\templeo\tMercado laboral\tPorcentaje\t0\t1
POP_TOTAL\tA\tPoblación total\t\tdemografia\tDemografía\tPersonas\t0\t0`;

	// svelte-ignore state_referenced_locally
	let dataSourceCode = $state(
		form?.values?.dataSourceCode || data.selectedDataSource?.code || data.selectedDataSourceCode || ''
	);
	// svelte-ignore state_referenced_locally
	let dataSourceName = $state(form?.values?.dataSourceName || data.selectedDataSource?.name || '');
	// svelte-ignore state_referenced_locally
	let definitions = $state(form?.values?.definitions || '');

	const normalizedCode = $derived(normalizeCode(dataSourceCode));

	function selectExistingDataSource(event: Event) {
		const code = (event.currentTarget as HTMLSelectElement).value;
		if (!code) return;
		const selected = data.dataSources.find((dataSource) => dataSource.code === code);
		dataSourceCode = selected?.code || code;
		dataSourceName = selected?.name || '';
		goto(`/admin/ingest/definitions?data_source=${encodeURIComponent(code)}`, {
			keepFocus: true,
			noScroll: true
		});
	}

	function useExample() {
		definitions = exampleDefinitions;
	}

	function dimensionLabel(dimensions: string[]): string {
		return dimensions.length > 0 ? dimensions.join(', ') : 'Sin dimensiones';
	}

	function frequencyLabel(freq: string): string {
		return freq === 'M' ? 'Mensual' : freq === 'A' ? 'Anual' : freq;
	}
</script>

<svelte:head>
	<title>Admin · Ingesta de definiciones</title>
</svelte:head>

<div class="space-y-8">
	<section class="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm">
		<div
			class="absolute right-0 top-0 h-40 w-40 translate-x-10 -translate-y-10 rounded-full bg-emerald-100 blur-3xl"
		></div>
		<div class="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
			<div class="max-w-3xl space-y-3">
				<Badge variant="secondary" class="gap-1">
					<ClipboardList class="h-3.5 w-3.5" />
					Ingesta administrativa
				</Badge>
				<div>
					<h1 class="text-3xl font-bold tracking-tight">Definir frecuencias de indicadores</h1>
					<p class="text-muted-foreground mt-2">
						Pega una tabla con encabezados para guardar definiciones inéditas por fuente de datos.
						Las observaciones y la publicación se harán en un paso posterior.
					</p>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<Card.Card class="p-4 shadow-none">
					<div class="text-2xl font-semibold">{data.dataSources.length}</div>
					<div class="text-muted-foreground text-xs">Fuentes</div>
				</Card.Card>
				<Card.Card class="p-4 shadow-none">
					<div class="text-2xl font-semibold">{data.definitions.length}</div>
					<div class="text-muted-foreground text-xs">Frecuencias seleccionadas</div>
				</Card.Card>
			</div>
		</div>
	</section>

	{#if data.saved}
		<Alert class="border-emerald-200 bg-emerald-50 text-emerald-950">
			<CheckCircle2 class="h-4 w-4" />
			<AlertTitle>Definiciones guardadas</AlertTitle>
			<AlertDescription>
				Se guardaron {data.createdFrequencies} frecuencia(s). La página se recargó en la fuente
				{data.selectedDataSource?.name || data.selectedDataSourceCode}.
			</AlertDescription>
		</Alert>
	{/if}

	<Card.Card>
		<Card.CardHeader>
			<Card.CardTitle class="flex items-center gap-2">
				<Database class="h-5 w-5" />
				Fuente de datos
			</Card.CardTitle>
			<Card.CardDescription>
				El código se normaliza a lowercase snake-case antes de guardar. Si la fuente existe, su
				nombre curado no se renombra desde esta página.
			</Card.CardDescription>
		</Card.CardHeader>
		<Card.CardContent class="space-y-5">
			<div class="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
				<div class="space-y-2">
					<Label for="existing-source">Seleccionar existente</Label>
					<select
						id="existing-source"
						class="border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs"
						onchange={selectExistingDataSource}
						value={data.selectedDataSourceCode}
					>
						<option value="">Nueva fuente o sin seleccionar</option>
						{#each data.dataSources as dataSource}
							<option value={dataSource.code}>{dataSource.name} · {dataSource.code}</option>
						{/each}
					</select>
				</div>
				<div class="space-y-2">
					<Label for="data-source-code">Código de fuente</Label>
					<Input
						id="data-source-code"
						name="data_source_code"
						form="definition-form"
						bind:value={dataSourceCode}
						placeholder="Ej. DANE Mercado Laboral"
					/>
					<p class="text-muted-foreground text-xs">
						Código normalizado: <span class="font-mono">{normalizedCode || '—'}</span>
					</p>
				</div>
				<div class="space-y-2">
					<Label for="data-source-name">Nombre</Label>
					<Input
						id="data-source-name"
						name="data_source_name"
						form="definition-form"
						bind:value={dataSourceName}
						placeholder="Ej. DANE - Mercado laboral"
					/>
				</div>
			</div>
		</Card.CardContent>
	</Card.Card>

	<form id="definition-form" method="POST" class="space-y-6">
		<Card.Card>
			<Card.CardHeader>
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<Card.CardTitle class="flex items-center gap-2">
							<Table2 class="h-5 w-5" />
							Tabla de definiciones
						</Card.CardTitle>
						<Card.CardDescription>
							Encabezados requeridos: indicator_code, freq, name, dimensions. Pega desde una
							hoja de cálculo usando columnas con encabezado.
						</Card.CardDescription>
					</div>
					<Button type="button" variant="outline" onclick={useExample}>Usar ejemplo</Button>
				</div>
			</Card.CardHeader>
			<Card.CardContent class="space-y-4">
				<div class="rounded-lg border bg-muted/30 p-4 text-sm">
					<div class="flex gap-2">
						<Info class="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
						<p class="text-muted-foreground">
							Las dimensiones se separan con comas y se validan contra el registro existente. Una
							celda vacía en <span class="font-mono">dimensions</span> crea una frecuencia sin
							dimensiones.
						</p>
					</div>
				</div>

				<Textarea
					name="definitions"
					bind:value={definitions}
					class="min-h-72 font-mono text-xs"
					placeholder={exampleDefinitions}
				/>

				{#if form?.errors?.length}
					<div class="overflow-hidden rounded-lg border border-destructive/30">
						<table class="min-w-full text-sm">
							<thead class="bg-destructive/10 text-destructive">
								<tr>
									<th class="px-4 py-2 text-left font-medium">Fila</th>
									<th class="px-4 py-2 text-left font-medium">Campo</th>
									<th class="px-4 py-2 text-left font-medium">Error</th>
								</tr>
							</thead>
							<tbody class="divide-y">
								{#each form.errors as error}
									<tr>
										<td class="px-4 py-2 font-mono text-xs">{error.row}</td>
										<td class="px-4 py-2 font-mono text-xs">{error.field}</td>
										<td class="px-4 py-2">{error.message}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</Card.CardContent>
			<Card.CardFooter class="justify-end gap-3">
				<Button href="/admin" variant="outline">Cancelar</Button>
				<Button type="submit" class="gap-2">
					<Save class="h-4 w-4" />
					Validar y guardar todo
				</Button>
			</Card.CardFooter>
		</Card.Card>
	</form>

	<Card.Card class="overflow-hidden">
		<div class="flex items-center justify-between border-b px-5 py-4">
			<div>
				<h2 class="font-semibold">Frecuencias definidas</h2>
				<p class="text-muted-foreground text-sm">
					{#if data.selectedDataSource}
						Todas las definiciones guardadas para {data.selectedDataSource.name}, incluidas las no
						publicadas.
					{:else}
						Selecciona una fuente de datos para ver sus definiciones.
					{/if}
				</p>
			</div>
		</div>

		{#if data.definitions.length > 0}
			<div class="overflow-x-auto">
				<table class="min-w-full text-sm">
					<thead class="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
						<tr>
							<th class="px-5 py-3 text-left font-medium">Indicador</th>
							<th class="px-5 py-3 text-left font-medium">Grupo</th>
							<th class="px-5 py-3 text-left font-medium">Frecuencia</th>
							<th class="px-5 py-3 text-left font-medium">Dimensiones</th>
							<th class="px-5 py-3 text-left font-medium">Formato</th>
						</tr>
					</thead>
					<tbody class="divide-y">
						{#each data.definitions as definition}
							<tr class="transition-colors hover:bg-muted/40">
								<td class="max-w-md px-5 py-4">
									<div class="font-medium">{definition.indicatorName}</div>
									<div class="text-muted-foreground mt-1 font-mono text-xs">
										{definition.indicatorCode}
									</div>
								</td>
								<td class="px-5 py-4">
									<div>{definition.groupName}</div>
									<div class="text-muted-foreground mt-1 font-mono text-xs">{definition.groupCode}</div>
								</td>
								<td class="px-5 py-4">
									<Badge variant="secondary">{frequencyLabel(definition.freq)}</Badge>
								</td>
								<td class="px-5 py-4 font-mono text-xs">{dimensionLabel(definition.dimensions)}</td>
								<td class="text-muted-foreground px-5 py-4">
									<div>{definition.unit || 'Sin unidad'}</div>
									<div class="mt-1 text-xs">
										mult: {definition.unitMult ?? '—'} · decimales: {definition.decimals ?? '—'}
									</div>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<div class="p-10 text-center">
				<p class="font-medium">No hay frecuencias definidas para esta fuente.</p>
				<p class="text-muted-foreground mt-1 text-sm">
					Guarda una tabla de definiciones para comenzar la preparación administrativa.
				</p>
			</div>
		{/if}
	</Card.Card>
</div>
