<script lang="ts">
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Admin · {data.indicator.code}</title>
</svelte:head>

<div class="max-w-4xl space-y-6">
	<div>
		<a href="/admin" class="text-sm text-blue-700 hover:underline">← Volver a indicadores</a>
		<h2 class="text-2xl font-bold text-gray-900 mt-2">Editar indicador</h2>
		<p class="text-gray-600">{data.indicator.code}</p>
	</div>

	{#if data.saved}
		<div class="bg-green-50 border border-green-200 text-green-700 rounded-md p-3 text-sm">
			Indicador guardado.
		</div>
	{/if}

	{#if form?.error}
		<div class="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 text-sm">
			{form.error}
		</div>
	{/if}

	<div class="bg-white rounded-lg shadow p-6">
		<h3 class="text-lg font-semibold mb-4">Contexto de origen</h3>
		<dl class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
			<div>
				<dt class="text-gray-500">Área</dt>
				<dd class="text-gray-900">{data.indicator.area}</dd>
			</div>
			<div>
				<dt class="text-gray-500">Grupo</dt>
				<dd class="text-gray-900">{data.indicator.group}</dd>
				<dd class="text-xs text-gray-500">{data.indicator.groupCode}</dd>
			</div>
			<div>
				<dt class="text-gray-500">Frecuencia</dt>
				<dd class="text-gray-900">{data.indicator.frequency === 'M' ? 'Mensual' : 'Anual'}</dd>
			</div>
			<div>
				<dt class="text-gray-500">Dimensiones permitidas del grupo</dt>
				<dd class="text-gray-900">{data.indicator.filterWhitelist?.join(', ') || 'Sin definir'}</dd>
			</div>
		</dl>
	</div>

	<form method="POST" class="bg-white rounded-lg shadow p-6 space-y-5">
		<div>
			<label for="name" class="block text-sm font-medium text-gray-700 mb-1">Nombre público</label>
			<input
				id="name"
				name="name"
				value={data.indicator.name}
				required
				class="w-full px-3 py-2 border border-gray-300 rounded-md"
			/>
		</div>

		<div>
			<label for="shortName" class="block text-sm font-medium text-gray-700 mb-1"
				>Nombre corto</label
			>
			<input
				id="shortName"
				name="shortName"
				value={data.indicator.shortName || ''}
				class="w-full px-3 py-2 border border-gray-300 rounded-md"
			/>
		</div>

		<div>
			<label for="description" class="block text-sm font-medium text-gray-700 mb-1"
				>Descripción</label
			>
			<textarea
				id="description"
				name="description"
				rows="4"
				class="w-full px-3 py-2 border border-gray-300 rounded-md"
				>{data.indicator.description || ''}</textarea
			>
		</div>

		<div>
			<label for="methodology" class="block text-sm font-medium text-gray-700 mb-1"
				>Metodología</label
			>
			<textarea
				id="methodology"
				name="methodology"
				rows="6"
				class="w-full px-3 py-2 border border-gray-300 rounded-md"
				>{data.indicator.methodology || ''}</textarea
			>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<div>
				<label for="source" class="block text-sm font-medium text-gray-700 mb-1">Fuente</label>
				<input
					id="source"
					name="source"
					value={data.indicator.source || ''}
					class="w-full px-3 py-2 border border-gray-300 rounded-md"
				/>
			</div>
			<div>
				<label for="updated" class="block text-sm font-medium text-gray-700 mb-1">Actualizado</label
				>
				<input
					id="updated"
					name="updated"
					value={data.indicator.updated || ''}
					placeholder="2025-06"
					class="w-full px-3 py-2 border border-gray-300 rounded-md"
				/>
			</div>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-4 gap-4">
			<div>
				<label for="unit" class="block text-sm font-medium text-gray-700 mb-1">Unidad</label>
				<input
					id="unit"
					name="unit"
					value={data.indicator.unit || ''}
					class="w-full px-3 py-2 border border-gray-300 rounded-md"
				/>
			</div>
			<div>
				<label for="unitMult" class="block text-sm font-medium text-gray-700 mb-1"
					>Multiplicador</label
				>
				<input
					id="unitMult"
					name="unitMult"
					type="number"
					value={data.indicator.unitMult ?? ''}
					class="w-full px-3 py-2 border border-gray-300 rounded-md"
				/>
			</div>
			<div>
				<label for="decimals" class="block text-sm font-medium text-gray-700 mb-1">Decimales</label>
				<input
					id="decimals"
					name="decimals"
					type="number"
					value={data.indicator.decimals ?? ''}
					class="w-full px-3 py-2 border border-gray-300 rounded-md"
				/>
			</div>
			<div>
				<label for="defaultViz" class="block text-sm font-medium text-gray-700 mb-1"
					>Visualización</label
				>
				<input
					id="defaultViz"
					name="defaultViz"
					value={data.indicator.defaultViz || 'time_series'}
					class="w-full px-3 py-2 border border-gray-300 rounded-md"
				/>
			</div>
		</div>

		<div class="flex gap-3 pt-2">
			<button class="px-4 py-2 bg-blue-700 text-white rounded-md hover:bg-blue-800">Guardar</button>
			<a href="/admin" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
				>Cancelar</a
			>
		</div>
	</form>
</div>
