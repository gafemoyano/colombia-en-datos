<script lang="ts">
	import type * as PlotlyTypes from 'plotly.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
	import X from '@lucide/svelte/icons/x';
	import Info from '@lucide/svelte/icons/info';
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
	// Brand-derived categorical palette (see --c-* tokens in app.css). Distinct hues so
	// split series stay tellable apart; the shadcn --chart-* ramp is monochrome blue.
	const CHART_COLORS = [
		'#1f4e79',
		'#d89a2b',
		'#2a9d8f',
		'#c0504d',
		'#6b4c9a',
		'#4f81bd',
		'#7f8c5a',
		'#8c6d4f'
	];
	const UNIT_LABELS: Record<string, string> = {
		PERCENT: 'Porcentaje (%)',
		NUMBER: 'Número',
		COP: 'Pesos (COP)',
		USD: 'Dólares (USD)',
		HOUR: 'Horas',
		WEEK: 'Semanas',
		YEAR: 'Años',
		TONNE: 'Toneladas',
		RATIO: 'Razón',
		INDEX: 'Índice',
		COP_PER_HOUR: 'Pesos por hora (COP)'
	};
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
			line: { width: 1.75 },
			name: seriesLabel(series.name)
		}))
	);

	// With a single indicator the card header already says which one it is, so the
	// legend only needs the split value ("Clase: Cabecera"), not the full series name.
	function seriesLabel(name: string): string {
		if (data.selectedIndicators.length !== 1) return name;
		const indicator = data.selectedIndicators[0];
		for (const prefix of [indicator.name, indicator.shortName]) {
			if (prefix && name.startsWith(`${prefix} · `)) return name.slice(prefix.length + 3);
		}
		return name;
	}

	const chartLayout = $derived<Partial<PlotlyTypes.Layout>>({
		// The card header already names the indicator; a second title inside the plot
		// wastes ~50px of vertical space and duplicates information.
		font: { family: "'Inter Variable', Inter, system-ui, sans-serif", size: 12, color: '#52616b' },
		colorway: CHART_COLORS,
		paper_bgcolor: 'rgba(0,0,0,0)',
		plot_bgcolor: 'rgba(0,0,0,0)',
		xaxis: {
			gridcolor: '#eef1f4',
			linecolor: '#d7e3ec',
			zeroline: false,
			ticks: 'outside',
			tickcolor: '#d7e3ec',
			automargin: true
		},
		yaxis: {
			title: {
				text: unitLabel(data.measurementCompatibility.unit),
				font: { size: 11 },
				standoff: 12
			},
			gridcolor: '#eef1f4',
			zeroline: false,
			showline: false,
			tickformat: ',~r',
			automargin: true
		},
		// Colombian convention: comma for decimals, period for thousands.
		separators: ',.',
		hovermode: 'x unified',
		hoverlabel: {
			font: { family: "'Inter Variable', Inter, system-ui, sans-serif", size: 12 },
			bgcolor: '#ffffff',
			bordercolor: '#d7e3ec'
		},
		legend: {
			orientation: 'h',
			x: 0,
			xanchor: 'left',
			y: 1,
			yanchor: 'bottom',
			font: { size: 11 },
			itemwidth: 30
		},
		showlegend: data.chart.series.length > 1,
		margin: { l: 48, r: 12, t: data.chart.series.length > 1 ? 40 : 20, b: 36 }
	});

	const chartConfig: Partial<PlotlyTypes.Config> = {
		responsive: true,
		displayModeBar: 'hover',
		displaylogo: false,
		modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines'],
		toImageButtonOptions: { format: 'png', scale: 2 }
	};

	const seriesPointCount = $derived(
		data.chart.series.reduce((total, series) => total + series.points.length, 0)
	);

	// The server writes default filter values back into the URL, so comparing hrefs
	// would always report something to clear. Only an explicit split or a non-default
	// filter is worth a reset.
	const canClearVisualization = $derived(
		Boolean(data.state.by) ||
			data.dimensions.some(
				(dimension) =>
					dimension.selectedValue !== null && dimension.selectedValue !== dimension.defaultValue
			)
	);

	function unitLabel(unit: string | null | undefined): string {
		if (!unit) return 'Valor';
		return UNIT_LABELS[unit] || unit;
	}

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

	// Emphasis follows what needs the user's attention: an unresolved dimension blocks
	// the chart (destructive), a split is the active choice (primary), a filter is the
	// normal resting state (quiet), and fixed/empty are informational.
	function badgeVariant(state: string): 'default' | 'secondary' | 'outline' | 'destructive' {
		if (state === 'split') return 'default';
		if (state === 'unresolved') return 'destructive';
		if (state === 'filtered') return 'secondary';
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

{#snippet eyebrow(text: string)}
	<div class="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">{text}</div>
{/snippet}

{#snippet contextDetails(metadata: IndicatorMetadata, showUnit: boolean)}
	{@const formattedFormula = metadata.formula ? technicalFormula(metadata.formula) : null}
	{@const noteGroups = methodologyNoteGroups(metadata)}
	<dl class="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
		{#if showUnit}
			<div class="space-y-0.5">
				<dt>{@render eyebrow('Unidad')}</dt>
				<dd>{unitLabel(metadata.unit)}{metadata.unit ? ` · ${metadata.unit}` : ''}</dd>
			</div>
		{/if}
		{#if metadata.sourceVariables}
			<div class="min-w-0 space-y-0.5">
				<dt>{@render eyebrow('Variables fuente')}</dt>
				<dd class="font-mono text-xs leading-5 break-words whitespace-pre-wrap">
					{metadata.sourceVariables}
				</dd>
			</div>
		{/if}
		<div class="min-w-0 space-y-0.5">
			<dt>{@render eyebrow('Citación de fuente')}</dt>
			<dd class="break-words whitespace-pre-wrap">
				{metadata.sourceCitation || 'Sin citación registrada'}
			</dd>
		</div>
		{#if metadata.description}
			<div class="space-y-0.5 sm:col-span-full">
				<dt>{@render eyebrow('Descripción')}</dt>
				<dd class="text-muted-foreground max-w-prose whitespace-pre-line">
					{metadata.description}
				</dd>
			</div>
		{/if}
		{#if metadata.formula}
			<div class="min-w-0 space-y-0.5 sm:col-span-full">
				<dt>{@render eyebrow('Fórmula')}</dt>
				<dd>
					{#if formattedFormula}
						<details class="rounded-md border">
							<summary class="cursor-pointer px-3 py-1.5 text-xs font-medium select-none">
								Ver regla técnica de cálculo
							</summary>
							<pre
								class="bg-muted/60 max-h-56 overflow-auto border-t px-3 py-2 font-mono text-xs leading-5 break-words whitespace-pre-wrap">{formattedFormula}</pre>
						</details>
					{:else}
						<code
							class="bg-muted/60 block rounded-md px-2.5 py-1.5 font-mono text-xs leading-5 break-words whitespace-pre-wrap"
							>{metadata.formula}</code
						>
					{/if}
				</dd>
			</div>
		{/if}
		{#if noteGroups.length > 0}
			<div class="space-y-1 sm:col-span-full">
				<dt>
					{@render eyebrow(
						noteGroups.reduce((total, group) => total + group.notes.length, 0) === 1
							? 'Nota metodológica'
							: 'Notas metodológicas'
					)}
				</dt>
				<dd class="grid gap-x-8 gap-y-2 sm:grid-cols-2">
					{#each noteGroups as group}
						<div class="space-y-0.5">
							{#if group.geoLevel}
								<div class="text-xs font-medium">
									{GEO_LEVEL_LABELS[group.geoLevel] || group.geoLevel}
								</div>
							{/if}
							<ul
								class="text-muted-foreground max-w-prose list-disc space-y-0.5 pl-4 text-[13px] leading-5"
							>
								{#each group.notes as note}
									<li>{note}</li>
								{/each}
							</ul>
						</div>
					{/each}
				</dd>
			</div>
		{/if}
	</dl>
{/snippet}

<div class="space-y-3">
	<!-- Page title row: one compact line instead of a full card header. -->
	<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-0.5">
		<h1 class="text-lg font-semibold tracking-tight">Explorador</h1>
		<p class="text-muted-foreground text-sm">
			Elige indicadores y decide explícitamente cómo filtrar o desagregar sus observaciones.
		</p>
		<Badge variant="outline" class="ml-auto text-[11px]">Prototipo paralelo</Badge>
	</div>

	<!-- Discovery toolbar -->
	<Card.Card size="sm" class="gap-0 py-0">
		<Card.CardContent class="px-3 py-3">
			<div
				class="grid items-start gap-x-3 gap-y-2 md:grid-cols-2 lg:grid-cols-[minmax(160px,220px)_minmax(160px,220px)_minmax(0,1fr)_140px]"
			>
				<div class="space-y-1">
					<Label id="data-source-label" class="text-muted-foreground text-xs">Fuente de datos</Label
					>
					<Select.Root
						type="single"
						value={data.state.dataSource || EMPTY_DATA_SOURCE}
						onValueChange={handleDataSourceSelect}
					>
						<Select.Trigger aria-labelledby="data-source-label" class="w-full">
							<span class="truncate">{selectedDataSourceLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={EMPTY_DATA_SOURCE} label="Todas las fuentes de datos">
								Todas las fuentes de datos
							</Select.Item>
							{#each data.dataSources as dataSource}
								<Select.Item value={dataSource.code} label={dataSource.name}>
									{dataSource.name}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="space-y-1">
					<Label id="theme-label" class="text-muted-foreground text-xs">Tema</Label>
					<Select.Root
						type="single"
						value={data.state.theme || EMPTY_THEME}
						onValueChange={handleThemeSelect}
					>
						<Select.Trigger aria-labelledby="theme-label" class="w-full">
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

				<div class="space-y-1 md:col-span-2 lg:col-span-1">
					<Label id="indicator-label" class="text-muted-foreground text-xs">
						Indicadores
						<span class="text-muted-foreground/70 font-normal tabular-nums">
							· {indicatorsForDiscovery.length} disponibles
						</span>
					</Label>
					<Popover.Root bind:open={indicatorPopoverOpen}>
						<Popover.Trigger aria-labelledby="indicator-label">
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									class="w-full justify-between px-2.5 text-left font-normal"
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
												<div class="min-w-0 flex-1 py-0.5">
													<div class="truncate text-sm font-medium">{indicator.name}</div>
													<div class="text-muted-foreground truncate text-xs">
														<span class="font-mono">{indicator.code}</span> · {indicator.dataSource} ·
														{indicator.theme}{indicator.group === indicator.theme
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
				</div>

				<div class="space-y-1">
					<Label id="freq-label" class="text-muted-foreground text-xs">Frecuencia</Label>
					<Select.Root
						type="single"
						value={data.state.freq || EMPTY_FREQ}
						disabled={data.selectedIndicators.length === 0 || data.commonFrequencies.length === 0}
						onValueChange={handleFrequencySelect}
					>
						<Select.Trigger aria-labelledby="freq-label" class="w-full">
							<span class="truncate">{selectedFrequencyLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={EMPTY_FREQ} label="Selecciona">Selecciona</Select.Item>
							{#each data.commonFrequencies as freq}
								<Select.Item value={freq} label={frequencyLabel(freq)}>
									{frequencyLabel(freq)}
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				{#if data.selectedIndicators.length > 0}
					<!-- Chips live on their own row so they never push the field row out of alignment. -->
					<div class="flex flex-wrap items-center gap-1.5 md:col-span-full">
						{#each data.selectedIndicators as indicator}
							<Badge variant="secondary" class="h-6 gap-1 pr-0.5 pl-2 text-xs font-normal">
								<span class="text-muted-foreground font-mono text-[11px]">{indicator.code}</span>
								<span class="max-w-72 truncate">{indicator.name}</span>
								<button
									type="button"
									class="hover:bg-foreground/10 rounded-full p-0.5"
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
		</Card.CardContent>
	</Card.Card>

	{#if data.warnings.length > 0}
		<Alert class="py-2.5">
			<AlertCircle class="size-4" />
			<AlertTitle>Estado de URL ajustado</AlertTitle>
			<AlertDescription>{data.warnings.join(' ')}</AlertDescription>
		</Alert>
	{/if}

	<div class="grid gap-3 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
		<!-- Visualization controls -->
		<Card.Card size="sm" class="h-fit gap-0 py-0 lg:sticky lg:top-14">
			<Card.CardHeader
				class="flex flex-row items-center justify-between gap-2 border-b px-3 py-2.5"
			>
				<Card.CardTitle class="flex items-center gap-1.5 text-sm">
					<SlidersHorizontal class="text-muted-foreground size-3.5" />
					Visualización
				</Card.CardTitle>
				{#if canClearVisualization}
					<Button href={clearVisualizationHref()} variant="ghost" size="xs" class="-mr-1">
						Limpiar
					</Button>
				{/if}
			</Card.CardHeader>
			<Card.CardContent class="space-y-4 px-3 py-3">
				{#if data.selectedIndicators.length === 0 || !data.state.freq}
					<p class="text-muted-foreground text-[13px] leading-5">
						Selecciona uno o más indicadores y una frecuencia común para ver sus dimensiones.
					</p>
				{:else if data.dimensions.length === 0}
					<p class="text-muted-foreground text-[13px] leading-5">
						{data.selectedIndicators.length > 1
							? 'Estos indicadores no tienen dimensiones comunes para esta frecuencia.'
							: 'Este indicador no tiene dimensiones registradas para esta frecuencia.'}
					</p>
				{:else}
					<div class="space-y-1">
						<Label id="by-label" class="text-xs">Desagregar por</Label>
						<Select.Root
							type="single"
							value={data.state.by || EMPTY_BY}
							onValueChange={handleSplitSelect}
						>
							<Select.Trigger aria-labelledby="by-label" class="w-full">
								<span class="truncate">{selectedSplitLabel}</span>
							</Select.Trigger>
							<Select.Content>
								<Select.Item value={EMPTY_BY} label="Sin desagregación"
									>Sin desagregación</Select.Item
								>
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

					<div class="space-y-2.5 border-t pt-3">
						{@render eyebrow('Filtros por dimensión')}
						{#each data.dimensions as dimension}
							<div class="space-y-1">
								<div class="flex items-center justify-between gap-2">
									<Label id={`filter-${dimension.code}-label`} class="truncate text-xs">
										{dimension.name}
									</Label>
									<Badge
										variant={badgeVariant(dimension.state)}
										class="h-[18px] px-1.5 text-[10px] tracking-wide uppercase"
									>
										{stateLabel(dimension.state)}
									</Badge>
								</div>
								<Select.Root
									type="single"
									value={dimension.selectedValue || EMPTY_FILTER}
									disabled={!dimension.isFilterable ||
										dimension.state === 'split' ||
										dimension.state === 'empty'}
									onValueChange={(value) => handleFilterSelect(dimension.code, value)}
								>
									<Select.Trigger aria-labelledby={`filter-${dimension.code}-label`} class="w-full">
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
											<Select.Item value={value.code} label={value.label}>{value.label}</Select.Item
											>
										{/each}
									</Select.Content>
								</Select.Root>
							</div>
						{/each}
					</div>
				{/if}

				{#if data.fixedDimensions.length > 0}
					<!-- Fixed dimensions are read-only state of the same list; they belong with the
					     controls, not in a separate card that is usually empty. -->
					<div class="space-y-1.5 border-t pt-3">
						{@render eyebrow('Dimensiones fijas')}
						<dl class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs">
							{#each data.fixedDimensions as dimension}
								<dt class="text-muted-foreground truncate">{dimension.name}</dt>
								<dd class="max-w-40 truncate text-right font-medium">
									{dimension.values[0]?.label}
								</dd>
							{/each}
						</dl>
					</div>
				{/if}
			</Card.CardContent>
		</Card.Card>

		<div class="min-w-0 space-y-3">
			<!-- Chart -->
			<Card.Card size="sm" class="gap-0 py-0">
				<Card.CardHeader
					class="flex flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-2.5"
				>
					<div class="min-w-0 flex-1">
						<Card.CardTitle class="truncate text-base leading-6">
							{#if data.selectedIndicators.length > 1}
								Comparación de {data.selectedIndicators.length} indicadores
							{:else}
								{data.selectedIndicator?.name || 'Selecciona un indicador'}
							{/if}
						</Card.CardTitle>
						<Card.CardDescription class="truncate text-xs leading-4">
							{#if data.selectedIndicators.length > 1}
								<span class="font-mono">
									{data.selectedIndicators.map((indicator) => indicator.code).join(' · ')}
								</span>
							{:else if data.selectedIndicator}
								<span class="font-mono">{data.selectedIndicator.code}</span>
								· {data.selectedIndicator.dataSource} · {data.selectedIndicator.group}
							{:else}
								Comienza con la barra de descubrimiento.
							{/if}
							{#if data.chart.status === 'chartable'}
								<span class="text-muted-foreground/70 tabular-nums">
									· {data.chart.series.length}
									{data.chart.series.length === 1 ? 'serie' : 'series'} · {seriesPointCount.toLocaleString(
										'es-CO'
									)} puntos
								</span>
							{/if}
						</Card.CardDescription>
					</div>

					<div class="flex items-center gap-1.5">
						<span id="range-label" class="text-muted-foreground mr-1 text-xs">Periodo</span>
						<Select.Root
							type="single"
							value={data.timeAxis.start || EMPTY_START}
							disabled={data.timeAxis.periods.length === 0}
							onValueChange={handleStartSelect}
						>
							<Select.Trigger aria-label="Inicio del periodo" class="w-[150px]">
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
						<span class="text-muted-foreground text-xs" aria-hidden="true">–</span>
						<Select.Root
							type="single"
							value={data.timeAxis.end || EMPTY_END}
							disabled={data.timeAxis.periods.length === 0}
							onValueChange={handleEndSelect}
						>
							<Select.Trigger aria-label="Fin del periodo" class="w-[150px]">
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
				</Card.CardHeader>
				<Card.CardContent class="px-2 pt-2 pb-1">
					{#if data.chart.status === 'chartable'}
						<div class="h-[clamp(360px,58vh,640px)]">
							{#key data.canonicalSearch}
								<PlotlyChart data={plotlyData} layout={chartLayout} config={chartConfig} />
							{/key}
						</div>
					{:else}
						<div
							class="m-1 flex h-[clamp(240px,36vh,400px)] items-center justify-center rounded-lg border border-dashed p-6 text-center"
						>
							<div class="max-w-lg space-y-3">
								<AlertCircle class="text-muted-foreground mx-auto size-7" />
								<div>
									<h2 class="text-sm font-semibold">La selección todavía no es graficable</h2>
									<p class="text-muted-foreground mt-1 text-[13px] leading-5">
										{data.chart.messages.join(' ')}
									</p>
								</div>
								{#if data.unresolvedDimensions.length > 0}
									<div class="flex flex-wrap justify-center gap-1.5">
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

			<!-- Indicator context -->
			<Card.Card size="sm" class="gap-0 py-0">
				<Card.CardHeader
					class="flex flex-row items-center justify-between gap-2 border-b px-4 py-2.5"
				>
					<Card.CardTitle class="flex items-center gap-1.5 text-sm">
						<Info class="text-muted-foreground size-3.5" />
						Contexto del indicador
					</Card.CardTitle>
					{#if data.metadatas.length > 1}
						<div class="flex items-center gap-2 text-xs">
							{@render eyebrow('Unidad compartida')}
							{#if data.measurementCompatibility.compatible}
								<span class="font-medium">{unitLabel(data.measurementCompatibility.unit)}</span>
							{:else}
								<span class="text-destructive font-medium">Unidades incompatibles</span>
							{/if}
						</div>
					{/if}
				</Card.CardHeader>
				<Card.CardContent class="px-4 py-3">
					{#if data.metadatas.length > 1}
						<div class="grid gap-3 2xl:grid-cols-2">
							{#each data.metadatas as metadata}
								<div class="space-y-3 rounded-lg border px-3 py-3">
									<div class="flex flex-wrap items-baseline gap-x-2">
										<div class="text-sm font-medium">{metadata.name || metadata.shortName}</div>
										<div class="text-muted-foreground font-mono text-xs">
											{metadata.code} · {metadata.unit || 'Sin unidad'}
										</div>
									</div>
									{@render contextDetails(metadata, false)}
								</div>
							{/each}
						</div>
					{:else if data.metadata}
						{@render contextDetails(data.metadata, true)}
					{:else}
						<p class="text-muted-foreground text-[13px]">
							Selecciona un indicador para ver su contexto.
						</p>
					{/if}
				</Card.CardContent>
			</Card.Card>
		</div>
	</div>
</div>
