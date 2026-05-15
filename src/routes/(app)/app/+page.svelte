<script lang="ts">
	import PlotlyChart from '$lib/components/PlotlyChart.svelte';
	import IndicatorSelector from '$lib/components/IndicatorSelector.svelte';
	import DimensionSelector from '$lib/components/DimensionSelector.svelte';
	import MetadataDisplay from '$lib/components/MetadataDisplay.svelte';
	import type { PageData } from './$types';
	import type * as PlotlyTypes from 'plotly.js';

	interface IndicatorMetadata {
		code: string;
		name: string;
		shortName: string | null;
		description: string | null;
		methodology: string | null;
		source: string | null;
		frequency: string;
		unit: string | null;
		unitMult: number | null;
		decimals: number | null;
		defaultViz: string | null;
		updated: string | null;
		availableDimensions: string[];
	}

	let { data }: { data: PageData } = $props();

	type IndicatorSummary = PageData['indicators'][number];

	let selectedArea = $state<string>('');
	let selectedIndicators = $state<string[]>([]);
	let startDate = $state<string>('');
	let endDate = $state<string>('');
	let frequency = $state<string>('M');
	let selectedBy = $state<string>('');
	let dimensionValues = $state<Record<string, string>>({});
	let availableDimensions = $state<string[]>([]);
	let chartData = $state<PlotlyTypes.Data[]>([]);
	let isLoading = $state(false);
	let metadata = $state<IndicatorMetadata[]>([]);

	const uniqueAreas = $derived(
		[...new Set(data.indicators.map((indicator: IndicatorSummary) => indicator.area))].sort()
	);

	function indicatorLabel(code: string): string {
		const meta = metadata.find((item) => item.code === code);
		if (meta) return meta.shortName || meta.name || code;
		const summary = data.indicators.find((item: IndicatorSummary) => item.code === code);
		return summary?.shortName || summary?.name || code;
	}

	async function loadMetadata() {
		if (selectedIndicators.length === 0) {
			metadata = [];
			availableDimensions = [];
			return;
		}

		try {
			const metadataPromises = selectedIndicators.map((indicator) =>
				fetch(`/api/meta/${encodeURIComponent(indicator)}?freq=${frequency}`).then((r) => r.json())
			);

			metadata = await Promise.all(metadataPromises);

			if (metadata.length > 0 && metadata[0].availableDimensions) {
				availableDimensions = metadata[0].availableDimensions;
			} else {
				availableDimensions = [];
			}
		} catch (error) {
			console.error('Error loading metadata:', error);
			metadata = [];
			availableDimensions = [];
		}
	}

	async function loadChartData() {
		if (selectedIndicators.length === 0) {
			chartData = [];
			return;
		}

		isLoading = true;
		try {
			const params = new URLSearchParams();
			selectedIndicators.forEach((ind) => params.append('indicator', ind));

			// Use selected department as ref_area if available, otherwise use national 'CO'
			const refArea = dimensionValues['DEPT_CODE'] || 'CO';
			params.set('ref_area', refArea);
			params.set('freq', frequency);

			if (startDate) params.set('start', startDate);
			if (endDate) params.set('end', endDate);
			if (selectedBy) params.set('by', selectedBy);

			for (const [dim, value] of Object.entries(dimensionValues)) {
				if (value) {
					params.set(dim.toLowerCase(), value);
				}
			}

			const response = await fetch(`/api/data?${params.toString()}`);
			const result = await response.json();

			if (selectedBy && result.meta.by) {
				const dataByKey = new Map<string, any[]>();
				for (const d of result.data) {
					const dimValue = d[selectedBy.toLowerCase()];
					const key = `${d.indicator}|${dimValue || ''}`;
					if (!dataByKey.has(key)) {
						dataByKey.set(key, []);
					}
					dataByKey.get(key)!.push(d);
				}

				chartData = Array.from(dataByKey.entries()).map(([key, points]) => {
					const [indicator, dimValue] = key.split('|');
					const labelMap: Record<string, string> = { T: 'Total', U: 'Urbano', R: 'Rural' };
					const dimLabel = labelMap[dimValue] || dimValue;
					return {
						x: points.map((p) => p.time),
						y: points.map((p) => p.value),
						type: 'scatter',
						mode: 'lines+markers',
						name: `${indicatorLabel(indicator)} · ${dimLabel}`,
						connectgaps: false
					};
				});
			} else {
				chartData = selectedIndicators.map((indicator) => ({
					x: result.data.filter((d: any) => d.indicator === indicator).map((d: any) => d.time),
					y: result.data.filter((d: any) => d.indicator === indicator).map((d: any) => d.value),
					type: 'scatter',
					mode: 'lines+markers',
					name: indicatorLabel(indicator),
					connectgaps: false
				}));
			}
		} catch (error) {
			console.error('Error loading chart data:', error);
			chartData = [];
		} finally {
			isLoading = false;
		}
	}

	function handleSelectionChange(newSelection: string[]) {
		selectedIndicators = newSelection;
		loadMetadata();
		loadChartData();
	}

	function handleFrequencyChange() {
		selectedIndicators = [];
		selectedBy = '';
		dimensionValues = {};
		startDate = '';
		endDate = '';
		metadata = [];
		availableDimensions = [];
		chartData = [];
	}

	function handleByChange(by: string) {
		selectedBy = by;
		loadChartData();
	}

	function handleDimensionValueChange(dimension: string, value: string) {
		dimensionValues = { ...dimensionValues, [dimension]: value };
		loadChartData();
	}

	$effect(() => {
		if (selectedIndicators.length > 0) {
			loadMetadata();
			loadChartData();
		}
	});
</script>

<div class="space-y-6">
	<div>
		<h2 class="text-2xl font-bold text-gray-900 mb-2">Indicadores de Colombia</h2>
		<p class="text-gray-600">
			Visualiza indicadores demográficos, económicos y estadísticos de Colombia
		</p>
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-4 gap-6">
		<div class="lg:col-span-1 space-y-6">
			<div class="bg-white rounded-lg shadow p-6">
				<h3 class="text-lg font-semibold mb-4">Filtros</h3>

				<div class="space-y-4">
					<div>
						<label for="area" class="block text-sm font-medium text-gray-700 mb-2"> Área </label>
						<select
							id="area"
							bind:value={selectedArea}
							class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
						>
							<option value="">Todas las áreas</option>
							{#each uniqueAreas as area}
								<option value={area}>{area}</option>
							{/each}
						</select>
					</div>

					<div>
						<label for="frequency" class="block text-sm font-medium text-gray-700 mb-2">
							Frecuencia
						</label>
						<select
							id="frequency"
							bind:value={frequency}
							onchange={handleFrequencyChange}
							class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
						>
							<option value="M">Mensual (M)</option>
							<option value="A">Anual (A)</option>
						</select>
					</div>

					<div>
						<label for="start-date" class="block text-sm font-medium text-gray-700 mb-2">
							Fecha inicial (AAAA o AAAA-MM)
						</label>
						<input
							id="start-date"
							type="text"
							bind:value={startDate}
							placeholder="2019-01"
							pattern="^\d{4}(-\d{2})?$"
							class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
						/>
					</div>

					<div>
						<label for="end-date" class="block text-sm font-medium text-gray-700 mb-2">
							Fecha final (AAAA o AAAA-MM)
						</label>
						<input
							id="end-date"
							type="text"
							bind:value={endDate}
							placeholder="2024-12"
							pattern="^\d{4}(-\d{2})?$"
							class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
						/>
					</div>
				</div>
			</div>

			<IndicatorSelector
				available={data.indicators}
				selected={selectedIndicators}
				onSelectionChange={handleSelectionChange}
				currentFrequency={frequency}
				currentArea={selectedArea}
			/>

			<DimensionSelector
				{availableDimensions}
				{selectedBy}
				{dimensionValues}
				onByChange={handleByChange}
				onDimensionValueChange={handleDimensionValueChange}
			/>
		</div>

		<div class="lg:col-span-3 space-y-6">
			<div class="bg-white rounded-lg shadow p-6">
				{#if isLoading}
					<div class="flex items-center justify-center h-96">
						<div class="text-gray-500">Cargando datos...</div>
					</div>
				{:else if chartData.length > 0}
					<PlotlyChart
						data={chartData}
						layout={{
							title: { text: 'Serie de tiempo' },
							xaxis: { title: { text: 'Fecha' } },
							yaxis: { title: { text: metadata[0]?.unit || 'Valor' } }
						}}
					/>
				{:else}
					<div class="flex items-center justify-center h-96">
						<div class="text-gray-500">Selecciona indicadores para visualizar</div>
					</div>
				{/if}
			</div>

			<MetadataDisplay {metadata} />
		</div>
	</div>
</div>
