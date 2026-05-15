<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Admin · Indicadores</title>
</svelte:head>

<div class="space-y-6">
	<div class="flex items-start justify-between gap-4">
		<div>
			<h2 class="text-2xl font-bold text-gray-900">Administrar indicadores</h2>
			<p class="text-gray-600">Edita nombres, descripciones y metodología de los indicadores.</p>
		</div>
		<a href="/app" class="text-sm text-blue-700 hover:underline">Volver a la app</a>
	</div>

	<form method="GET" class="bg-white rounded-lg shadow p-4 grid grid-cols-1 md:grid-cols-4 gap-4">
		<div class="md:col-span-2">
			<label for="q" class="block text-sm font-medium text-gray-700 mb-1">Buscar</label>
			<input
				id="q"
				name="q"
				value={data.filters.search}
				placeholder="Código, nombre, grupo..."
				class="w-full px-3 py-2 border border-gray-300 rounded-md"
			/>
		</div>

		<div>
			<label for="area" class="block text-sm font-medium text-gray-700 mb-1">Área</label>
			<select id="area" name="area" class="w-full px-3 py-2 border border-gray-300 rounded-md">
				<option value="">Todas</option>
				{#each data.areas as area}
					<option value={area.code} selected={data.filters.area === area.code}>{area.name}</option>
				{/each}
			</select>
		</div>

		<label class="flex items-end gap-2 text-sm text-gray-700 pb-2">
			<input type="checkbox" name="attention" value="1" checked={data.filters.attentionOnly} />
			Necesitan atención
		</label>

		<div class="md:col-span-4 flex gap-2">
			<button class="px-4 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-800">Filtrar</button>
			<a href="/admin" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
				>Limpiar</a
			>
		</div>
	</form>

	<div class="bg-white rounded-lg shadow overflow-hidden">
		<div class="px-4 py-3 border-b text-sm text-gray-600">
			{data.indicators.length} indicadores
		</div>
		<div class="overflow-x-auto">
			<table class="min-w-full divide-y divide-gray-200 text-sm">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left font-medium text-gray-500">Indicador</th>
						<th class="px-4 py-3 text-left font-medium text-gray-500">Contexto</th>
						<th class="px-4 py-3 text-left font-medium text-gray-500">Formato</th>
						<th class="px-4 py-3 text-left font-medium text-gray-500">Atención</th>
						<th class="px-4 py-3"></th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each data.indicators as indicator}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3">
								<div class="font-medium text-gray-900">{indicator.name}</div>
								<div class="text-xs text-gray-500">{indicator.code}</div>
							</td>
							<td class="px-4 py-3 text-gray-600">
								<div>{indicator.area}</div>
								<div class="text-xs text-gray-500">{indicator.group}</div>
							</td>
							<td class="px-4 py-3 text-gray-600">
								<div>{indicator.frequency === 'M' ? 'Mensual' : 'Anual'}</div>
								<div class="text-xs text-gray-500">{indicator.unit || 'Sin unidad'}</div>
							</td>
							<td class="px-4 py-3">
								<div class="flex flex-wrap gap-1">
									{#if indicator.attention.needsTitle}
										<span class="px-2 py-1 rounded bg-red-100 text-red-700 text-xs">Título</span>
									{/if}
									{#if indicator.attention.couldUseDescription}
										<span class="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs"
											>Descripción</span
										>
									{/if}
									{#if indicator.attention.couldUseMethodology}
										<span class="px-2 py-1 rounded bg-amber-100 text-amber-700 text-xs"
											>Metodología</span
										>
									{/if}
									{#if !indicator.attention.needsAttention}
										<span class="px-2 py-1 rounded bg-green-100 text-green-700 text-xs">OK</span>
									{/if}
								</div>
							</td>
							<td class="px-4 py-3 text-right">
								<a
									class="text-blue-700 hover:underline"
									href={`/admin/indicators/${encodeURIComponent(indicator.code)}`}>Editar</a
								>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
</div>
