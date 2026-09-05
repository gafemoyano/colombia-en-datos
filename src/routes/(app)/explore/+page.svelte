<script lang="ts">
	import type * as PlotlyTypes from 'plotly.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import X from '@lucide/svelte/icons/x';
	import PlotlyChart from '$lib/components/PlotlyChart.svelte';
	import { Alert, AlertDescription, AlertTitle } from '$lib/components/ui/alert';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Command from '$lib/components/ui/command';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const EMPTY_DATA_SOURCE = '__data_source_all__';
	const EMPTY_THEME = '__theme_all__';
	const EMPTY_FREQ = '__freq_empty__';
	const EMPTY_BY = '__by_empty__';
	const EMPTY_FILTER = '__filter_all__';
	const EMPTY_START = '__start_open__';
	const EMPTY_END = '__end_open__';
	const GEO_LEVEL_LABELS: Record<string, string> = {
		NAT: 'Nacional',
		DEP: 'Departamental',
		CLASS: 'Cabecera / resto',
		DEP_CLASS: 'Departamental por clase',
		AREA: 'Área metropolitana',
		MUN: 'Municipal'
	};

	type IndicatorMetadata = NonNullable<PageData['metadata']>;
	type MethodologyNoteGroup = { geoLevel: string | null; notes: string[] };

	let indicatorPopoverOpen = $state(false);
	let indicatorSearch = $state('');

	const indicatorsForDiscovery = $derived(
		data.indicators.filter(
			(indicator) =>
				(!data.state.dataSource || indicator.dataSourceCode === data.state.dataSource) &&
				(!data.state.theme || indicator.theme === data.state.theme)
		)
	);

	const themesForDataSource = $derived(
		data.state.dataSource
			? [
					...new Set(
						data.indicators
							.filter((indicator) => indicator.dataSourceCode === data.state.dataSource)
							.map((indicator) => indicator.theme)
					)
				].sort((a, b) => a.localeCompare(b))
			: data.themes
	);

	const selectedDataSourceLabel = $derived(
		data.state.dataSource
			? data.dataSources.find((dataSource) => dataSource.code === data.state.dataSource)?.name ||
				data.state.dataSource
			: 'Todas las fuentes de datos'
	);

	const selectedThemeLabel = $derived(data.state.theme || 'Todos los temas');

	const selectedFrequencyLabel = $derived(
		data.state.freq ? frequencyLabel(data.state.freq) : 'Selecciona'
	);

	const selectedSplitLabel = $derived(
		data.state.by
			? data.dimensions.find((dimension) => dimension.code === data.state.by)?.name || data.state.by
			: 'Sin desagregación'
	);

	const selectedIndicatorTitle = $derived(
		data.selectedIndicators.length > 0
			? `${data.selectedIndicators.length} indicador${data.selectedIndicators.length === 1 ? '' : 'es'} seleccionado${data.selectedIndicators.length === 1 ? '' : 's'}`
			: 'Busca por código o nombre...'
	);

	const selectedStartLabel = $derived(
		data.timeAxis.start
			? data.timeAxis.periods.find((period) => period.value === data.timeAxis.start)?.label ||
				data.timeAxis.start
			: 'Desde el inicio'
	);

	const selectedEndLabel = $derived(
		data.timeAxis.end
			? data.timeAxis.periods.find((period) => period.value === data.timeAxis.end)?.label ||
				data.timeAxis.end
			: 'Hasta el final'
	);

	const plotlyData = $derived<PlotlyTypes.Data[]>(
		data.chart.series.map((series) => ({
			x: series.points.map((point) => point.time),
			y: series.points.map((point) => point.value),
			type: 'scatter',
			mode: 'lines',
			name: series.name
		}))
	);

	const chartLayout = $derived<Partial<PlotlyTypes.Layout>>({
		title: {
			text:
				data.selectedIndicators.length > 1
					? 'Comparación de indicadores'
					: data.selectedIndicator?.name || data.selectedIndicator?.shortName || 'Explorador'
		},
		xaxis: { title: { text: 'Periodo' } },
		yaxis: { title: { text: data.measurementCompatibility.unit || 'Valor' } },
		legend: { orientation: 'h' },
		margin: { l: 60, r: 30, t: 60, b: 60 }
	});

	function frequencyLabel(freq: string): string {
		if (freq === 'M') return 'Mensual';
		if (freq === 'A') return 'Anual';
		if (freq === 'Q') return 'Trimestral';
		if (freq === 'D') return 'Diaria';
		return freq;
	}

	function setParamOrDelete(params: URLSearchParams, key: string, value: string | null) {
		if (value?.trim()) params.set(key, value.trim());
		else params.delete(key);
	}

	function deleteFilterParams(params: URLSearchParams) {
		for (const key of Array.from(params.keys())) {
			if (key.startsWith('filter.')) params.delete(key);
		}
	}

	function deleteIndicatorParams(params: URLSearchParams) {
		params.delete('indicator');
	}

	function deleteVisualizationParams(params: URLSearchParams) {
		params.delete('by');
		deleteFilterParams(params);
	}

	function canonicalizeParams(params: URLSearchParams): URLSearchParams {
		const canonical = new URLSearchParams();
		const dataSource = params.get('data_source')?.trim();
		const theme = params.get('theme')?.trim();
		const indicators = params
			.getAll('indicator')
			.map((indicator) => indicator.trim())
			.filter(Boolean);
		const freq = params.get('freq')?.trim().toUpperCase();
		const by = params.get('by')?.trim().toUpperCase();
		const start = params.get('start')?.trim();
		const end = params.get('end')?.trim();
		const filters = Array.from(params.entries())
			.filter(([key, value]) => key.startsWith('filter.') && value.trim())
			.map(([key, value]) => [key.slice('filter.'.length).toUpperCase(), value.trim()] as const)
			.sort(([a], [b]) => a.localeCompare(b));

		if (dataSource) canonical.set('data_source', dataSource);
		if (theme) canonical.set('theme', theme);
		for (const indicator of indicators) canonical.append('indicator', indicator);
		if (freq) canonical.set('freq', freq);
		if (by) canonical.set('by', by);
		for (const [code, value] of filters) canonical.set(`filter.${code}`, value);
		if (start) canonical.set('start', start);
		if (end) canonical.set('end', end);
		return canonical;
	}

	function exploreHref(params: URLSearchParams): string {
		const search = canonicalizeParams(params).toString();
		return search ? `/explore?${search}` : '/explore';
	}

	function navigateWith(
		mutator: (params: URLSearchParams) => void,
		options: { replaceState?: boolean } = {}
	) {
		const params = new URLSearchParams(page.url.searchParams);
		mutator(params);
		const href = exploreHref(params);
		const currentHref = page.url.pathname + (page.url.search ? page.url.search : '');

		if (href === currentHref) return;

		goto(href, {
			keepFocus: true,
			noScroll: true,
			replaceState: options.replaceState ?? false,
			invalidateAll: true
		});
	}

	function keepMatchingIndicators(params: URLSearchParams, dataSource: string, theme: string) {
		const selectedIndicators = params.getAll('indicator');
		const keptIndicators = selectedIndicators.filter((code) => {
			const indicator = data.indicators.find((candidate) => candidate.code === code);
			return (
				indicator &&
				(!dataSource || indicator.dataSourceCode === dataSource) &&
				(!theme || indicator.theme === theme)
			);
		});

		deleteIndicatorParams(params);
		for (const code of keptIndicators) params.append('indicator', code);
		if (keptIndicators.length !== selectedIndicators.length) {
			params.delete('freq');
			deleteVisualizationParams(params);
		}
	}

	function handleDataSourceSelect(selectedValue: string) {
		const dataSource = selectedValue === EMPTY_DATA_SOURCE ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'data_source', dataSource);
			let theme = params.get('theme')?.trim() || '';
			if (
				dataSource &&
				theme &&
				!data.indicators.some(
					(indicator) => indicator.dataSourceCode === dataSource && indicator.theme === theme
				)
			) {
				params.delete('theme');
				theme = '';
			}
			keepMatchingIndicators(params, dataSource, theme);
		});
	}

	function handleThemeSelect(selectedValue: string) {
		const theme = selectedValue === EMPTY_THEME ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'theme', theme);
			keepMatchingIndicators(params, params.get('data_source')?.trim() || '', theme);
		});
	}

	function selectIndicator(indicator: (typeof data.indicators)[number]) {
		indicatorPopoverOpen = false;
		indicatorSearch = '';
		navigateWith((params) => {
			const selected = params.getAll('indicator');
			if (!selected.includes(indicator.code)) {
				params.append('indicator', indicator.code);
				// Only reset controls if the new indicator doesn't share the current frequency.
				// The server will validate dimension compatibility and prune incompatible filters/by.
				const currentFreq = params.get('freq');
				if (currentFreq && !indicator.availableFrequencies?.includes(currentFreq)) {
					params.delete('freq');
					deleteVisualizationParams(params);
				}
			}
		});
	}

	function removeIndicator(indicatorCode: string) {
		navigateWith((params) => {
			const selected = params.getAll('indicator').filter((code) => code !== indicatorCode);
			deleteIndicatorParams(params);
			for (const code of selected) params.append('indicator', code);
			params.delete('freq');
			deleteVisualizationParams(params);
		});
	}

	function handleFrequencySelect(selectedValue: string) {
		const freq = selectedValue === EMPTY_FREQ ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'freq', freq);
			deleteVisualizationParams(params);
		});
	}

	function handleSplitSelect(selectedValue: string) {
		const by = selectedValue === EMPTY_BY ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'by', by);
			if (by) params.delete(`filter.${by}`);
		});
	}

	function handleFilterSelect(dimensionCode: string, selectedValue: string) {
		const value = selectedValue === EMPTY_FILTER ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, `filter.${dimensionCode}`, value);
			if (value && params.get('by') === dimensionCode) params.delete('by');
		});
	}

	function handleStartSelect(selectedValue: string) {
		const start = selectedValue === EMPTY_START ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'start', start);
		});
	}

	function handleEndSelect(selectedValue: string) {
		const end = selectedValue === EMPTY_END ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'end', end);
		});
	}

	function clearVisualizationHref(): string {
		const params = new URLSearchParams();
		if (data.state.dataSource) params.set('data_source', data.state.dataSource);
		if (data.state.theme) params.set('theme', data.state.theme);
		for (const indicator of data.state.selectedIndicators) params.append('indicator', indicator);
		if (data.state.freq) params.set('freq', data.state.freq);
		return exploreHref(params);
	}

	function badgeVariant(state: string): 'default' | 'secondary' | 'outline' | 'destructive' {
		if (state === 'filtered' || state === 'split') return 'default';
		if (state === 'fixed') return 'secondary';
		if (state === 'unresolved') return 'destructive';
		return 'outline';
	}

	function stateLabel(state: string): string {
		if (state === 'filtered') return 'Filtrada';
		if (state === 'split') return 'Desagregación';
		if (state === 'fixed') return 'Fija';
		if (state === 'empty') return 'Sin valores';
		return 'Pendiente';
	}

	function technicalFormula(formula: string): string | null {
		const prefix = 'RULE_JSON:';
		if (!formula.startsWith(prefix)) return null;

		try {
			return JSON.stringify(JSON.parse(formula.slice(prefix.length)), null, 2);
		} catch {
			return formula;
		}
	}

	function notesFrom(value: unknown): string[] {
		if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
		if (!Array.isArray(value)) return [];
		return value
			.filter((note): note is string => typeof note === 'string')
			.map((note) => note.trim())
			.filter(Boolean);
	}

	function methodologyNoteGroups(metadata: IndicatorMetadata): MethodologyNoteGroup[] {
		const methodology = metadata.methodology?.trim();
		if (!methodology) return [];

		try {
			const parsed: unknown = JSON.parse(methodology);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				return [{ geoLevel: null, notes: notesFrom(parsed) }].filter(
					(group) => group.notes.length > 0
				);
			}

			let entries = Object.entries(parsed as Record<string, unknown>);
			const selectedGeoLevel = data.state.filters.GEO_LEVEL;
			if (selectedGeoLevel) {
				entries = entries.filter(([geoLevel]) => geoLevel === selectedGeoLevel);
			} else if (data.state.by === 'GEO_LEVEL') {
				const visibleGeoLevels = new Set(
					data.dimensions
						.find((dimension) => dimension.code === 'GEO_LEVEL')
						?.values.map((value) => value.code) || []
				);
				entries = entries.filter(([geoLevel]) => visibleGeoLevels.has(geoLevel));
			}

			return entries
				.map(([geoLevel, value]) => ({ geoLevel, notes: notesFrom(value) }))
				.filter((group) => group.notes.length > 0);
		} catch {
			return [{ geoLevel: null, notes: [methodology] }];
		}
	}
</script>

<svelte:head>
	<title>Explorar datos · Colombia en Datos</title>
</svelte:head>

{#snippet contextDetails(metadata: IndicatorMetadata, showUnit: boolean)}
	{@const formattedFormula = metadata.formula ? technicalFormula(metadata.formula) : null}
	{@const noteGroups = methodologyNoteGroups(metadata)}
	<div class="space-y-3">
		{#if showUnit}
			<div>
				<div class="text-muted-foreground text-xs uppercase">Unidad</div>
				<div>{metadata.unit || 'Sin unidad registrada'}</div>
			</div>
		{/if}
		{#if metadata.description}
			<div>
				<div class="text-muted-foreground text-xs uppercase">Descripción</div>
				<p class="text-muted-foreground whitespace-pre-line">{metadata.description}</p>
			</div>
		{/if}
		{#if metadata.formula}
			<div>
				<div class="text-muted-foreground text-xs uppercase">Fórmula</div>
				{#if formattedFormula}
					<details class="mt-1 rounded-md border px-3 py-2">
						<summary class="cursor-pointer font-medium">Ver regla técnica de cálculo</summary>
						<pre
							class="bg-muted mt-2 max-h-48 overflow-auto rounded p-3 text-xs whitespace-pre-wrap break-words">{formattedFormula}</pre>
					</details>
				{:else}
					<div class="whitespace-pre-wrap break-words">{metadata.formula}</div>
				{/if}
			</div>
		{/if}
		{#if metadata.sourceVariables}
			<div>
				<div class="text-muted-foreground text-xs uppercase">Variables fuente</div>
				<div class="font-mono text-xs whitespace-pre-wrap break-words">
					{metadata.sourceVariables}
				</div>
			</div>
		{/if}
		<div>
			<div class="text-muted-foreground text-xs uppercase">Citación de fuente</div>
			<div class="whitespace-pre-wrap break-words">
				{metadata.sourceCitation || 'Sin citación registrada'}
			</div>
		</div>
		{#if noteGroups.length > 0}
			<div>
				<div class="text-muted-foreground text-xs uppercase">
					{noteGroups.reduce((total, group) => total + group.notes.length, 0) === 1
						? 'Nota metodológica'
						: 'Notas metodológicas'}
				</div>
				<div class="mt-1 space-y-2">
					{#each noteGroups as group}
						<div>
							{#if group.geoLevel}
								<div class="font-medium">
									{GEO_LEVEL_LABELS[group.geoLevel] || group.geoLevel}
								</div>
							{/if}
							<ul class="text-muted-foreground list-disc space-y-1 pl-5">
								{#each group.notes as note}
									<li>{note}</li>
								{/each}
							</ul>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<div class="space-y-6">
	<Card.Card>
		<Card.CardHeader class="px-5">
			<div class="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
				<div>
					<Card.CardTitle class="text-2xl">Explorador</Card.CardTitle>
					<Card.CardDescription>
						Elige un indicador y decide explícitamente cómo filtrar o desagregar sus observaciones.
					</Card.CardDescription>
				</div>
				<Badge variant="outline">Prototipo paralelo</Badge>
			</div>
		</Card.CardHeader>
		<Card.CardContent class="px-5 pb-5">
			<div class="grid gap-5 lg:grid-cols-[200px_200px_minmax(0,1fr)_160px] lg:items-end">
				<div class="space-y-2">
					<Label id="data-source-label">Fuente de datos</Label>
					<Select.Root
						type="single"
						value={data.state.dataSource || EMPTY_DATA_SOURCE}
						onValueChange={handleDataSourceSelect}
					>
						<Select.Trigger aria-labelledby="data-source-label" class="h-9 w-full">
							<span class="truncate">{selectedDataSourceLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={EMPTY_DATA_SOURCE} label="Todas las fuentes de datos">Todas las fuentes de datos</Select.Item>
							{#each data.dataSources as dataSource}
								<Select.Item value={dataSource.code} label={dataSource.name}>{dataSource.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-2">
					<Label id="theme-label">Tema</Label>
					<Select.Root
						type="single"
						value={data.state.theme || EMPTY_THEME}
						onValueChange={handleThemeSelect}
					>
						<Select.Trigger aria-labelledby="theme-label" class="h-9 w-full">
							<span class="truncate">{selectedThemeLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={EMPTY_THEME} label="Todos los temas">Todos los temas</Select.Item>
							{#each themesForDataSource as theme}
								<Select.Item value={theme} label={theme}>{theme}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-2">
					<Label id="indicator-label">Indicadores</Label>
					<Popover.Root bind:open={indicatorPopoverOpen}>
						<Popover.Trigger aria-labelledby="indicator-label">
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="lg"
									class="w-full justify-between px-3 text-left font-normal"
								>
									<span class="truncate">{selectedIndicatorTitle}</span>
									<ChevronsUpDown class="text-muted-foreground ml-2 size-4 shrink-0" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[min(760px,calc(100vw-2rem))] p-0" align="start">
							<Command.Root>
								<Command.Input
									bind:value={indicatorSearch}
									placeholder="Busca por código, nombre, grupo, tema o fuente de datos..."
								/>
								<Command.List class="max-h-[368px]">
									<Command.Empty>No hay indicadores para esa búsqueda.</Command.Empty>
									<Command.Group
										heading={data.state.dataSource || data.state.theme
											? 'Indicadores filtrados'
											: 'Indicadores'}
									>
										{#each indicatorsForDiscovery as indicator}
											<Command.Item
												value={`${indicator.code} ${indicator.name}`}
												keywords={[
													indicator.code,
													indicator.name,
													indicator.group,
													indicator.theme,
													indicator.dataSource
												]}
												onSelect={() => selectIndicator(indicator)}
											>
												<div class="min-w-0 flex-1 py-1">
													<div class="truncate font-medium">{indicator.name}</div>
													<div class="text-muted-foreground truncate text-xs">
														{indicator.code} · {indicator.dataSource} · {indicator.theme}{indicator.group ===
														indicator.theme
															? ''
															: ` · ${indicator.group}`}
													</div>
												</div>
											</Command.Item>
										{/each}
									</Command.Group>
								</Command.List>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
					{#if data.selectedIndicators.length > 0}
						<div class="flex flex-wrap gap-2">
							{#each data.selectedIndicators as indicator}
								<Badge variant="secondary" class="h-7 gap-1 pr-1">
									<span class="max-w-56 truncate">{indicator.name}</span>
									<button
										type="button"
										class="hover:bg-muted-foreground/10 rounded-full p-0.5"
										aria-label={`Quitar ${indicator.name}`}
										onclick={() => removeIndicator(indicator.code)}
									>
										<X class="size-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
				</div>

				<div class="space-y-2">
					<Label id="freq-label">Frecuencia</Label>
					<Select.Root
						type="single"
						value={data.state.freq || EMPTY_FREQ}
						disabled={data.selectedIndicators.length === 0 || data.commonFrequencies.length === 0}
						onValueChange={handleFrequencySelect}
					>
						<Select.Trigger aria-labelledby="freq-label" class="h-9 w-full">
							<span class="truncate">{selectedFrequencyLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={EMPTY_FREQ} label="Selecciona">Selecciona</Select.Item>
							{#each data.commonFrequencies as freq}
								<Select.Item value={freq} label={frequencyLabel(freq)}>{frequencyLabel(freq)}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
		</Card.CardContent>
	</Card.Card>

	{#if data.warnings.length > 0}
		<Alert>
			<AlertCircle class="size-4" />
			<AlertTitle>Estado de URL ajustado</AlertTitle>
			<AlertDescription>{data.warnings.join(' ')}</AlertDescription>
		</Alert>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[340px_1fr]">
		<Card.Card class="h-fit">
			<Card.CardHeader class="px-5">
				<Card.CardTitle class="flex items-center gap-2 text-base">
					<SlidersHorizontal class="size-4" />
					Controles de visualización
				</Card.CardTitle>
				<Card.CardDescription>Filtra o desagrega cada dimensión multi-valor.</Card.CardDescription>
			</Card.CardHeader>
			<Card.CardContent class="space-y-6 px-5 pb-5">
				{#if data.selectedIndicators.length === 0 || !data.state.freq}
					<p class="text-muted-foreground text-sm">
						Selecciona uno o más indicadores y una frecuencia común para ver sus dimensiones.
					</p>
				{:else if data.dimensions.length === 0}
					<p class="text-muted-foreground text-sm">
						{data.selectedIndicators.length > 1
							? 'Estos indicadores no tienen dimensiones comunes para esta frecuencia.'
							: 'Este indicador no tiene dimensiones registradas para esta frecuencia.'}
					</p>
				{:else}
					<div class="space-y-2">
						<Label id="by-label">Desagregar por</Label>
						<Select.Root
							type="single"
							value={data.state.by || EMPTY_BY}
							onValueChange={handleSplitSelect}
						>
							<Select.Trigger aria-labelledby="by-label" class="h-9 w-full">
								<span class="truncate">{selectedSplitLabel}</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value={EMPTY_BY} label="Sin desagregación">Sin desagregación</Select.Item>
								{#each data.dimensions as dimension}
									<Select.Item
										value={dimension.code}
										label={`${dimension.name} (${stateLabel(dimension.state)})`}
										disabled={!dimension.isSplitable ||
											dimension.state === 'filtered' ||
											dimension.state === 'fixed' ||
											dimension.state === 'empty'}
									>
										{dimension.name} ({stateLabel(dimension.state)})
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>

					<div class="space-y-5">
						{#each data.dimensions as dimension}
							<div class="space-y-2">
								<div class="flex items-center justify-between gap-2">
									<Label id={`filter-${dimension.code}-label`}>{dimension.name}</Label>
									<Badge variant={badgeVariant(dimension.state)}>{stateLabel(dimension.state)}</Badge>
								</div>
								<Select.Root
									type="single"
									value={dimension.selectedValue || EMPTY_FILTER}
									disabled={!dimension.isFilterable ||
										dimension.state === 'split' ||
										dimension.state === 'empty'}
									onValueChange={(value) => handleFilterSelect(dimension.code, value)}
								>
									<Select.Trigger aria-labelledby={`filter-${dimension.code}-label`} class="h-9 w-full">
										<span class="truncate">
											{dimension.values.find((value) => value.code === dimension.selectedValue)
												?.label || 'Todos los valores'}
										</span>
									</Select.Trigger>
									<Select.Content>
										<Select.Item value={EMPTY_FILTER} label="Todos los valores">
											Todos los valores
										</Select.Item>
										{#each dimension.values as value}
											<Select.Item value={value.code} label={value.label}>{value.label}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{/each}
					</div>
				{/if}

				<div class="flex flex-wrap gap-2 border-t pt-4">
					<Button href={clearVisualizationHref()} variant="outline">Limpiar visualización</Button>
				</div>
			</Card.CardContent>
		</Card.Card>

		<div class="space-y-6">
			<Card.Card>
				<Card.CardHeader>
					<div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
						<div>
							<Card.CardTitle>
								{#if data.selectedIndicators.length > 1}
									Comparación de {data.selectedIndicators.length} indicadores
								{:else}
									{data.selectedIndicator?.name || 'Selecciona un indicador'}
								{/if}
							</Card.CardTitle>
							<Card.CardDescription>
								{#if data.selectedIndicators.length > 1}
									{data.selectedIndicators.map((indicator) => indicator.code).join(' · ')}
								{:else if data.selectedIndicator}
									{data.selectedIndicator.code} · {data.selectedIndicator.dataSource} · {data
										.selectedIndicator.group}
								{:else}
									Comienza con los controles de descubrimiento.
								{/if}
							</Card.CardDescription>
						</div>
						<div class="grid gap-3 sm:grid-cols-[170px_170px] sm:items-end">
							<div class="space-y-2">
								<Label id="start-label">Inicio</Label>
								<Select.Root
									type="single"
									value={data.timeAxis.start || EMPTY_START}
									disabled={data.timeAxis.periods.length === 0}
									onValueChange={handleStartSelect}
								>
									<Select.Trigger aria-labelledby="start-label" class="h-9 w-full">
										<span class="truncate">{selectedStartLabel}</span>
									</Select.Trigger>
									<Select.Content>
										<Select.Item
											value={EMPTY_START}
											label="Desde el inicio"
											onclick={() => handleStartSelect(EMPTY_START)}
										>
											Desde el inicio
										</Select.Item>
										{#each data.timeAxis.periods as period}
											<Select.Item
												value={period.value}
												label={period.label}
												disabled={Boolean(data.timeAxis.end && period.value > data.timeAxis.end)}
												onclick={() => handleStartSelect(period.value)}
											>
												{period.label}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
							<div class="space-y-2">
								<Label id="end-label">Fin</Label>
								<Select.Root
									type="single"
									value={data.timeAxis.end || EMPTY_END}
									disabled={data.timeAxis.periods.length === 0}
									onValueChange={handleEndSelect}
								>
									<Select.Trigger aria-labelledby="end-label" class="h-9 w-full">
										<span class="truncate">{selectedEndLabel}</span>
									</Select.Trigger>
									<Select.Content>
										<Select.Item
											value={EMPTY_END}
											label="Hasta el final"
											onclick={() => handleEndSelect(EMPTY_END)}
										>
											Hasta el final
										</Select.Item>
										{#each data.timeAxis.periods as period}
											<Select.Item
												value={period.value}
												label={period.label}
												disabled={Boolean(data.timeAxis.start && period.value < data.timeAxis.start)}
												onclick={() => handleEndSelect(period.value)}
											>
												{period.label}
											</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						</div>
					</div>
				</Card.CardHeader>
				<Card.CardContent>
					{#if data.chart.status === 'chartable'}
						<div class="h-[520px]">
							{#key data.canonicalSearch}
								<PlotlyChart data={plotlyData} layout={chartLayout} />
							{/key}
						</div>
					{:else}
						<div
							class="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed p-8 text-center"
						>
							<div class="max-w-xl space-y-4">
								<AlertCircle class="text-muted-foreground mx-auto size-10" />
								<div>
									<h2 class="text-lg font-semibold">La selección todavía no es graficable</h2>
									<p class="text-muted-foreground mt-2 text-sm">
										{data.chart.messages.join(' ')}
									</p>
								</div>
								{#if data.unresolvedDimensions.length > 0}
									<div class="flex flex-wrap justify-center gap-2">
										{#each data.unresolvedDimensions as dimension}
											<Badge variant="destructive">{dimension.name}</Badge>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</Card.CardContent>
			</Card.Card>

			<div class="grid gap-6 xl:grid-cols-2">
				<Card.Card>
					<Card.CardHeader>
						<Card.CardTitle class="text-base">Dimensiones fijas</Card.CardTitle>
						<Card.CardDescription>
							Valores con una sola opción para la selección actual.
						</Card.CardDescription>
					</Card.CardHeader>
					<Card.CardContent>
						{#if data.fixedDimensions.length === 0}
							<p class="text-muted-foreground text-sm">No hay dimensiones fijas.</p>
						{:else}
							<div class="space-y-2">
								{#each data.fixedDimensions as dimension}
									<div class="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
										<span>{dimension.name}</span>
										<Badge variant="secondary">{dimension.values[0]?.label}</Badge>
									</div>
								{/each}
							</div>
						{/if}
					</Card.CardContent>
				</Card.Card>

				<Card.Card>
					<Card.CardHeader>
						<Card.CardTitle class="flex items-center gap-2 text-base">
							<CheckCircle2 class="size-4" />
							Contexto del indicador
						</Card.CardTitle>
					</Card.CardHeader>
					<Card.CardContent class="space-y-3 text-sm">
						{#if data.metadatas.length > 1}
							<div>
								<div class="text-muted-foreground text-xs uppercase">Unidad compartida</div>
								<div>
									{#if data.measurementCompatibility.compatible}
										{data.measurementCompatibility.unit || 'Sin unidad registrada'}
									{:else}
										<span class="text-destructive">Unidades incompatibles</span>
									{/if}
								</div>
							</div>
							<div class="space-y-3">
								{#each data.metadatas as metadata}
									<div class="space-y-3 rounded-lg border px-3 py-3">
										<div class="font-medium">{metadata.name || metadata.shortName}</div>
										<div class="text-muted-foreground text-xs">
											{metadata.code} · {metadata.unit || 'Sin unidad'}
										</div>
										{@render contextDetails(metadata, false)}
									</div>
								{/each}
							</div>
						{:else if data.metadata}
							{@render contextDetails(data.metadata, true)}
						{:else}
							<p class="text-muted-foreground">Selecciona un indicador para ver su contexto.</p>
						{/if}
					</Card.CardContent>
				</Card.Card>
			</div>
		</div>
	</div>
</div>
