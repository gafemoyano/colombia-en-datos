<script lang="ts">
	interface IndicatorMetadata {
		code: string;
		name: string;
		description: string | null;
		source: string | null;
		frequency: string;
		unit: string | null;
		unitMult: number | null;
		decimals: number | null;
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
		if (dims.length === 0) return 'None';
		return dims.map(d => d.replace(/_/g, ' ')).join(', ');
	}
</script>

{#if metadata.length > 0}
	<div class="bg-white rounded-lg shadow p-6">
		<h3 class="text-lg font-semibold mb-4">Indicator Information</h3>
		
		<div class="space-y-4">
			{#each metadata as meta}
				<div class="border-l-4 border-blue-500 pl-4">
					<div class="font-medium text-gray-900">{meta.code}</div>
					
					{#if meta.description}
						<p class="text-sm text-gray-600 mt-1">{meta.description}</p>
					{/if}
					
					<dl class="mt-2 text-sm grid grid-cols-2 gap-x-4 gap-y-1">
						{#if meta.unit}
							<dt class="text-gray-500">Unit:</dt>
							<dd class="text-gray-900">{meta.unit}{formatUnitMult(meta.unitMult)}</dd>
						{/if}
						
						{#if meta.source}
							<dt class="text-gray-500">Source:</dt>
							<dd class="text-gray-900">{meta.source}</dd>
						{/if}
						
						<dt class="text-gray-500">Frequency:</dt>
						<dd class="text-gray-900">{meta.frequency === 'M' ? 'Monthly' : 'Annual'}</dd>
						
						{#if meta.decimals !== null}
							<dt class="text-gray-500">Decimals:</dt>
							<dd class="text-gray-900">{meta.decimals}</dd>
						{/if}
						
						<dt class="text-gray-500">Dimensions:</dt>
						<dd class="text-gray-900 col-span-1">{formatDimensions(meta.availableDimensions)}</dd>
					</dl>
				</div>
			{/each}
		</div>
	</div>
{/if}
