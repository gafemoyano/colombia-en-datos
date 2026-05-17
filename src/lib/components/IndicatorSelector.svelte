<script lang="ts">
	interface Indicator {
		code: string;
		name: string;
		shortName: string | null;
		frequency: string | null;
		availableFrequencies?: string[];
		area: string;
		group: string;
	}

	interface Props {
		available: Indicator[];
		selected: string[];
		onSelectionChange: (selected: string[]) => void;
		currentFrequency?: string;
		currentArea?: string;
	}

	let { available, selected, onSelectionChange, currentFrequency, currentArea }: Props = $props();

	let searchQuery = $state('');

	function frequencyLabel(freq: string): string {
		return freq === 'M' ? 'Mensual' : freq === 'A' ? 'Anual' : freq;
	}

	function frequenciesFor(indicator: Indicator): string[] {
		return indicator.availableFrequencies?.length
			? indicator.availableFrequencies
			: indicator.frequency
				? [indicator.frequency]
				: [];
	}

	const filteredIndicators = $derived.by(() => {
		let filtered = available;

		if (currentFrequency) {
			filtered = filtered.filter((i) => frequenciesFor(i).includes(currentFrequency));
		}

		if (currentArea) {
			filtered = filtered.filter((i) => i.area === currentArea);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(
				(i) =>
					i.code.toLowerCase().includes(query) ||
					i.name.toLowerCase().includes(query) ||
					i.group.toLowerCase().includes(query)
			);
		}

		return filtered;
	});

	function toggleIndicator(code: string) {
		const newSelection = selected.includes(code)
			? selected.filter((i) => i !== code)
			: [...selected, code];
		onSelectionChange(newSelection);
	}
</script>

<div class="bg-white rounded-lg shadow p-6">
	<h2 class="text-xl font-semibold mb-4">Seleccionar indicadores</h2>

	<div class="mb-4">
		<input
			type="text"
			bind:value={searchQuery}
			placeholder="Buscar indicadores..."
			class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
		/>
	</div>

	<div class="space-y-2 max-h-96 overflow-y-auto">
		{#each filteredIndicators as indicator}
			<label class="flex items-start space-x-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
				<input
					type="checkbox"
					checked={selected.includes(indicator.code)}
					onchange={() => toggleIndicator(indicator.code)}
					class="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 mt-1"
				/>
				<div class="flex-1">
					<div class="text-sm font-medium text-gray-900">{indicator.name}</div>
					<div class="text-xs text-gray-500">{indicator.code}</div>
					<div class="text-xs text-gray-500">
						{frequenciesFor(indicator).map(frequencyLabel).join(', ') || 'Sin datos'} · {indicator.group}
					</div>
				</div>
			</label>
		{/each}
	</div>

	<div class="mt-4 pt-4 border-t">
		<p class="text-sm text-gray-600">
			{selected.length} indicador{selected.length !== 1 ? 'es' : ''} seleccionado{selected.length !==
			1
				? 's'
				: ''}
		</p>
	</div>
</div>
