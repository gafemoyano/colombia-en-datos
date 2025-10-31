<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		availableDimensions: string[];
		selectedBy?: string;
		dimensionValues: Record<string, string>;
		onByChange: (by: string) => void;
		onDimensionValueChange: (dimension: string, value: string) => void;
	}

	let {
		availableDimensions,
		selectedBy,
		dimensionValues,
		onByChange,
		onDimensionValueChange
	}: Props = $props();

	interface Departamento {
		id: number;
		code: string;
		name: string;
	}

	let departamentos: Departamento[] = $state([]);
	let loadingDepartamentos = $state(true);

	onMount(async () => {
		try {
			const response = await fetch('/api/departamentos');
			const data = await response.json();
			departamentos = data.departamentos || [];
		} catch (error) {
			console.error('Failed to load departamentos:', error);
		} finally {
			loadingDepartamentos = false;
		}
	});

	const dimensionOptions: Record<string, Array<{ value: string; label: string }>> = {
		URBAN_RURAL: [
			{ value: '', label: 'All (T/U/R)' },
			{ value: 'T', label: 'Total' },
			{ value: 'U', label: 'Urban' },
			{ value: 'R', label: 'Rural' }
		],
		SEX: [
			{ value: '', label: 'All' },
			{ value: 'M', label: 'Male' },
			{ value: 'F', label: 'Female' }
		],
		AGE: [{ value: '', label: 'All ages' }]
	};
</script>

<div class="bg-white rounded-lg shadow p-6">
	<h3 class="text-lg font-semibold mb-4">Dimensions</h3>

	<div class="space-y-4">
		<div>
			<label for="by-dimension" class="block text-sm font-medium text-gray-700 mb-2">
				Split by (shows separate lines)
			</label>
			<select
				id="by-dimension"
				value={selectedBy || ''}
				onchange={(e) => onByChange(e.currentTarget.value)}
				class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
				disabled={availableDimensions.length === 0}
			>
				<option value="">No split</option>
				{#each availableDimensions as dim}
					<option value={dim}>{dim.replace(/_/g, ' ')}</option>
				{/each}
			</select>
		</div>

		<!-- Department filter -->
		<div>
			<label for="filter-dept" class="block text-sm font-medium text-gray-700 mb-2">
				Department
			</label>
			<select
				id="filter-dept"
				value={dimensionValues['DEPT_CODE'] || ''}
				onchange={(e) => onDimensionValueChange('DEPT_CODE', e.currentTarget.value)}
				class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
				disabled={loadingDepartamentos}
			>
				<option value="">All departments</option>
				{#each departamentos as dept}
					<option value={dept.code}>{dept.name}</option>
				{/each}
			</select>
			{#if loadingDepartamentos}
				<p class="text-xs text-gray-500 mt-1">Loading departments...</p>
			{/if}
		</div>

		{#each availableDimensions as dim}
			{#if dim !== selectedBy && dim !== 'DEPT_CODE' && dimensionOptions[dim]}
				<div>
					<label for={`filter-${dim}`} class="block text-sm font-medium text-gray-700 mb-2">
						{dim.replace(/_/g, ' ')}
					</label>
					<select
						id={`filter-${dim}`}
						value={dimensionValues[dim] || ''}
						onchange={(e) => onDimensionValueChange(dim, e.currentTarget.value)}
						class="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
					>
						{#each dimensionOptions[dim] || [] as option}
							<option value={option.value}>{option.label}</option>
						{/each}
					</select>
				</div>
			{/if}
		{/each}

		{#if availableDimensions.length === 0}
			<p class="text-sm text-gray-500 italic">No dimensions available for selected indicators</p>
		{/if}
	</div>
</div>
