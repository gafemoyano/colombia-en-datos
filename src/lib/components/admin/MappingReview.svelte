<script lang="ts">
	import { AlertTriangle, ArrowRight, LockKeyhole, Map } from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import type { AcceptedBatchColumnMapping } from '$lib/server/batch-ingest/storage';
	import type {
		BatchMappingConfidence,
		BatchMappingTransform,
		BatchProfile,
		CanonicalBatchField
	} from '$lib/server/batch-ingest/types';

	interface Props {
		profile: BatchProfile;
		mappings?: AcceptedBatchColumnMapping[];
		accepted?: boolean;
		disabled?: boolean;
	}

	let { profile, mappings = $bindable([]), accepted = false, disabled = false }: Props = $props();

	const canonicalFields: CanonicalBatchField[] = [
		'indicator_code',
		'freq',
		'ref_area',
		'time_period',
		'obs_value',
		'geo_level',
		'dept_code',
		'muni_code',
		'urban_rural',
		'sex',
		'age',
		'adjustment',
		'ext_1',
		'ext_2',
		'ext_3',
		'unit',
		'unit_mult',
		'decimals',
		'obs_status',
		'source_period'
	];
	const transforms: Array<{ value: BatchMappingTransform; label: string }> = [
		{ value: 'identity', label: 'Sin cambio' },
		{ value: 'trim', label: 'Recortar espacios' },
		{ value: 'uppercase', label: 'Mayúsculas' },
		{ value: 'numeric', label: 'Numérico' },
		{ value: 'geih-month-year-to-iso-month', label: 'Mes/año GEIH → ISO' }
	];

	function proposal(sourceColumn: string) {
		return profile.mappings.mappings.find((mapping) => mapping.sourceColumn === sourceColumn);
	}

	function confidenceLabel(confidence: BatchMappingConfidence | undefined): string {
		if (confidence === 'canonical') return 'Canónico';
		if (confidence === 'source-alias') return 'Alias detectado';
		return 'Sin soporte';
	}

	function updateTarget(index: number, canonicalField: string) {
		mappings = mappings.map((mapping, mappingIndex) =>
			mappingIndex === index
				? { ...mapping, canonicalField: (canonicalField || null) as CanonicalBatchField | null }
				: mapping
		);
	}

	function updateTransform(index: number, transform: BatchMappingTransform, checked: boolean) {
		mappings = mappings.map((mapping, mappingIndex) => {
			if (mappingIndex !== index) return mapping;
			const next = checked
				? [...new Set([...mapping.transforms, transform])]
				: mapping.transforms.filter((value) => value !== transform);
			return { ...mapping, transforms: next };
		});
	}
</script>

<Card class="overflow-hidden">
	<div class="border-b border-slate-200 p-5">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<div class="flex items-center gap-2 font-semibold text-slate-950">
					<Map class="h-4 w-4" />
					Mapeo fuente → esquema canónico
				</div>
				<p class="mt-1 max-w-2xl text-sm text-slate-500">
					Revisa el destino y las transformaciones de cada columna. Preparar el lote acepta este
					contrato completo; no existe aceptación parcial por segmento.
				</p>
			</div>
			<Badge variant={accepted ? 'success' : 'secondary'}>
				{accepted ? 'Aceptado e inmutable' : 'Pendiente de aceptación'}
			</Badge>
		</div>
	</div>

	{#if accepted}
		<div class="border-b border-amber-200 bg-amber-50 p-4 text-sm text-amber-900" role="status">
			<div class="flex items-center gap-2 font-semibold">
				<LockKeyhole class="h-4 w-4" /> El mapeo aceptado es de solo lectura
			</div>
			<p class="mt-1">
				Un fallo transitorio puede reintentarse con este mismo contrato. Para corregir cualquier
				columna, destino o transformación debes cargar un lote nuevo.
			</p>
		</div>
	{/if}

	{#if profile.mappings.missingRequiredFields.length > 0 || profile.mappings.duplicateCanonicalFields.length > 0}
		<div class="border-b border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
			<div class="flex items-center gap-2 font-semibold">
				<AlertTriangle class="h-4 w-4" /> El mapeo propuesto requiere corrección
			</div>
			{#if profile.mappings.missingRequiredFields.length > 0}
				<p class="mt-2">
					Campos obligatorios ausentes:
					<code class="font-mono text-xs">{profile.mappings.missingRequiredFields.join(', ')}</code>
				</p>
			{/if}
			{#if profile.mappings.duplicateCanonicalFields.length > 0}
				<p class="mt-1">
					Destinos duplicados:
					<code class="font-mono text-xs"
						>{profile.mappings.duplicateCanonicalFields.join(', ')}</code
					>
				</p>
			{/if}
		</div>
	{/if}

	<div class="overflow-x-auto">
		<table class="min-w-full text-sm">
			<caption class="sr-only">Revisión del mapeo de columnas del lote</caption>
			<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
				<tr>
					<th class="px-5 py-3 text-left font-medium">Columna fuente</th>
					<th class="px-5 py-3 text-left font-medium"><span class="sr-only">hacia</span></th>
					<th class="px-5 py-3 text-left font-medium">Campo canónico</th>
					<th class="px-5 py-3 text-left font-medium">Transformaciones</th>
					<th class="px-5 py-3 text-left font-medium">Evidencia</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-200 bg-white">
				{#each mappings as mapping, index (mapping.sourceColumn)}
					<tr class="align-top">
						<td class="px-5 py-4">
							<code class="font-mono text-xs font-medium text-slate-950"
								>{mapping.sourceColumn}</code
							>
						</td>
						<td class="px-2 py-4 text-slate-400"><ArrowRight class="h-4 w-4" /></td>
						<td class="min-w-52 px-5 py-4">
							<label class="sr-only" for={`mapping-target-${index}`}>
								Campo canónico para {mapping.sourceColumn}
							</label>
							<select
								id={`mapping-target-${index}`}
								class="h-10 w-full rounded-md border border-slate-200 bg-white px-3 font-mono text-xs ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
								value={mapping.canonicalField ?? ''}
								disabled={accepted || disabled}
								onchange={(event) =>
									updateTarget(index, (event.currentTarget as HTMLSelectElement).value)}
							>
								<option value="">Ignorar columna</option>
								{#each canonicalFields as field}<option value={field}>{field}</option>{/each}
							</select>
						</td>
						<td class="min-w-64 px-5 py-4">
							<div class="grid gap-2">
								{#each transforms as transform}
									<label class="flex items-start gap-2 text-xs text-slate-700">
										<input
											type="checkbox"
											class="mt-0.5 h-4 w-4 rounded border-slate-300 accent-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
											checked={mapping.transforms.includes(transform.value)}
											disabled={accepted || disabled}
											onchange={(event) =>
												updateTransform(
													index,
													transform.value,
													(event.currentTarget as HTMLInputElement).checked
												)}
										/>
										<span>{transform.label}</span>
									</label>
								{/each}
							</div>
						</td>
						<td class="min-w-48 px-5 py-4 text-xs text-slate-600">
							<Badge
								variant={proposal(mapping.sourceColumn)?.confidence === 'unsupported'
									? 'warning'
									: 'outline'}
							>
								{confidenceLabel(proposal(mapping.sourceColumn)?.confidence)}
							</Badge>
							{#if proposal(mapping.sourceColumn)?.warning}
								<p class="mt-2 text-amber-800">{proposal(mapping.sourceColumn)?.warning}</p>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</Card>
