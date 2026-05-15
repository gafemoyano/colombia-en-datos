<script lang="ts">
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

	interface Props {
		metadata: IndicatorMetadata[];
	}

	let { metadata }: Props = $props();

	function formatUnitMult(unitMult: number | null): string {
		if (unitMult === null || unitMult === 0) return '';
		return ` (×10^${unitMult})`;
	}

	function formatDimensions(dims: string[]): string {
		if (dims.length === 0) return 'Ninguna';
		return dims.map((dim) => dim.replace(/_/g, ' ')).join(', ');
	}
</script>

{#if metadata.length > 0}
	<div class="bg-white rounded-lg shadow p-6">
		<h3 class="text-lg font-semibold mb-4">Información del indicador</h3>

		<div class="space-y-4">
			{#each metadata as meta}
				<div class="border-l-4 border-blue-500 pl-4">
					<div class="font-medium text-gray-900">{meta.name}</div>
					<div class="text-xs text-gray-500">{meta.code}</div>

					{#if meta.description}
						<p class="text-sm text-gray-600 mt-2">{meta.description}</p>
					{/if}

					<dl class="mt-3 text-sm grid grid-cols-2 gap-x-4 gap-y-1">
						{#if meta.unit}
							<dt class="text-gray-500">Unidad:</dt>
							<dd class="text-gray-900">{meta.unit}{formatUnitMult(meta.unitMult)}</dd>
						{/if}

						{#if meta.source}
							<dt class="text-gray-500">Fuente:</dt>
							<dd class="text-gray-900">{meta.source}</dd>
						{/if}

						<dt class="text-gray-500">Frecuencia:</dt>
						<dd class="text-gray-900">{meta.frequency === 'M' ? 'Mensual' : 'Anual'}</dd>

						{#if meta.decimals !== null}
							<dt class="text-gray-500">Decimales:</dt>
							<dd class="text-gray-900">{meta.decimals}</dd>
						{/if}

						{#if meta.updated}
							<dt class="text-gray-500">Actualizado:</dt>
							<dd class="text-gray-900">{meta.updated}</dd>
						{/if}

						<dt class="text-gray-500">Dimensiones:</dt>
						<dd class="text-gray-900 col-span-1">{formatDimensions(meta.availableDimensions)}</dd>
					</dl>

					{#if meta.methodology}
						<div class="mt-3">
							<div class="text-sm font-medium text-gray-700">Metodología</div>
							<p class="text-sm text-gray-600 mt-1">{meta.methodology}</p>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
