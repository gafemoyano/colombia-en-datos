<script lang="ts">
	import { AlertTriangle, CheckCircle2, FilePenLine, LockKeyhole } from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import type { AdminDefinitionDraftEdit } from '$lib/server/batch-ingest/admin-workflow';
	import type {
		DefinitionDraftHeader,
		DefinitionDraftRow
	} from '$lib/server/batch-ingest/definition-drafts';

	interface Props {
		drafts: DefinitionDraftRow[];
		edits?: AdminDefinitionDraftEdit[];
		disabled?: boolean;
	}

	let { drafts, edits = $bindable([]), disabled = false }: Props = $props();

	const compactFields: Array<{ field: DefinitionDraftHeader; label: string; mono?: boolean }> = [
		{ field: 'name', label: 'Nombre' },
		{ field: 'short_name', label: 'Nombre corto' },
		{ field: 'dimensions', label: 'Dimensiones', mono: true },
		{ field: 'group_code', label: 'Código de grupo', mono: true },
		{ field: 'group_name', label: 'Nombre de grupo' },
		{ field: 'unit', label: 'Unidad' },
		{ field: 'unit_mult', label: 'Multiplicador', mono: true },
		{ field: 'decimals', label: 'Decimales', mono: true },
		{ field: 'default_viz', label: 'Visualización predeterminada', mono: true },
		{ field: 'updated', label: 'Actualizado', mono: true }
	];
	const longFields: Array<{ field: DefinitionDraftHeader; label: string }> = [
		{ field: 'description', label: 'Descripción' },
		{ field: 'methodology', label: 'Metodología' },
		{ field: 'source_citation', label: 'Citación de fuente' }
	];

	function value(draft: DefinitionDraftRow, field: DefinitionDraftHeader): string {
		return edits.find((edit) => edit.id === draft.id)?.values[field] ?? draft.values[field];
	}

	function update(draft: DefinitionDraftRow, field: DefinitionDraftHeader, nextValue: string) {
		const current = edits.find((edit) => edit.id === draft.id);
		if (current) {
			edits = edits.map((edit) =>
				edit.id === draft.id ? { ...edit, values: { ...edit.values, [field]: nextValue } } : edit
			);
			return;
		}
		edits = [...edits, { id: draft.id, values: { ...draft.values, [field]: nextValue } }];
	}

	function required(draft: DefinitionDraftRow, field: DefinitionDraftHeader): boolean {
		return draft.adminRequiredFields.includes(field);
	}
</script>

<Card class="overflow-hidden">
	<div class="border-b border-slate-200 p-5">
		<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
			<div>
				<div class="flex items-center gap-2 font-semibold text-slate-950">
					<FilePenLine class="h-4 w-4" />
					Definiciones propuestas
				</div>
				<p class="mt-1 max-w-2xl text-sm text-slate-500">
					Completa los metadatos de cada segmento. El código de indicador y la frecuencia provienen
					del archivo y permanecen vinculados a la evidencia analizada.
				</p>
			</div>
			<Badge
				variant={drafts.some((draft) => draft.errors.length > 0) ? 'destructive' : 'secondary'}
			>
				{drafts.length} definiciones
			</Badge>
		</div>
	</div>

	<div class="divide-y divide-slate-200">
		{#each drafts as draft, draftIndex (draft.id)}
			<fieldset class="space-y-5 p-5" {disabled}>
				<legend class="sr-only">Definición de {draft.id}</legend>
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div>
						<div class="flex flex-wrap items-center gap-2">
							<code class="font-mono text-sm font-semibold text-slate-950">
								{draft.values.indicator_code} / {draft.values.freq}
							</code>
							<Badge variant="outline">Segmento derivado</Badge>
						</div>
						<p class="mt-1 text-xs text-slate-500">
							{draft.provenance.rowCount} filas · {draft.provenance.periodStart ?? '—'} a
							{draft.provenance.periodEnd ?? '—'}
						</p>
					</div>
					<div class="flex items-center gap-2 text-xs text-slate-500">
						<LockKeyhole class="h-3.5 w-3.5" /> Identidad de solo lectura
					</div>
				</div>

				{#if draft.errors.length > 0}
					<div
						class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
						role="alert"
					>
						<div class="flex items-center gap-2 font-semibold">
							<AlertTriangle class="h-4 w-4" /> Errores de la propuesta
						</div>
						<ul class="mt-2 list-disc space-y-1 pl-5">
							{#each draft.errors as error}<li>
									<code class="font-mono text-xs">{error.field}</code>: {error.message}
								</li>{/each}
						</ul>
					</div>
				{/if}

				<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
					{#each compactFields as item}
						<div class="space-y-2">
							<label
								for={`definition-${draftIndex}-${item.field}`}
								class="text-sm font-medium text-slate-800"
							>
								{item.label}{#if required(draft, item.field)}
									<span class="text-red-700">(obligatorio)</span>{/if}
							</label>
							<Input
								id={`definition-${draftIndex}-${item.field}`}
								class={item.mono ? 'font-mono text-xs' : ''}
								value={value(draft, item.field)}
								required={required(draft, item.field)}
								oninput={(event) =>
									update(draft, item.field, (event.currentTarget as HTMLInputElement).value)}
							/>
						</div>
					{/each}
				</div>

				<div class="grid gap-4 lg:grid-cols-3">
					{#each longFields as item}
						<div class="space-y-2">
							<label
								for={`definition-${draftIndex}-${item.field}`}
								class="text-sm font-medium text-slate-800"
							>
								{item.label}{#if required(draft, item.field)}
									<span class="text-red-700">(obligatorio)</span>{/if}
							</label>
							<Textarea
								id={`definition-${draftIndex}-${item.field}`}
								class="min-h-24"
								value={value(draft, item.field)}
								required={required(draft, item.field)}
								oninput={(event) =>
									update(draft, item.field, (event.currentTarget as HTMLTextAreaElement).value)}
							/>
						</div>
					{/each}
				</div>

				{#if draft.provenance.collapsedDimensions.length > 0}
					<div class="rounded-lg border border-amber-200 bg-amber-50 p-4">
						<div class="flex items-center gap-2 text-sm font-semibold text-amber-900">
							<CheckCircle2 class="h-4 w-4" /> Colapso de totales fijos aplicado
						</div>
						<p class="mt-1 text-xs text-amber-800">
							Estos valores son evidencia de auditoría de solo lectura. No se registran como
							dimensiones variables de la definición.
						</p>
						<div class="mt-3 overflow-x-auto">
							<table class="min-w-full text-xs">
								<caption class="sr-only">Valores fijos colapsados de {draft.id}</caption>
								<thead class="text-amber-900">
									<tr>
										<th class="pb-2 pr-4 text-left font-medium">Columna fuente</th>
										<th class="pb-2 pr-4 text-left font-medium">Dimensión</th>
										<th class="pb-2 pr-4 text-left font-medium">Valor fijo</th>
										<th class="pb-2 text-right font-medium">Filas</th>
									</tr>
								</thead>
								<tbody>
									{#each draft.provenance.collapsedDimensions as dimension}
										<tr class="border-t border-amber-200">
											<td class="py-2 pr-4 font-mono">{dimension.sourceColumn}</td>
											<td class="py-2 pr-4 font-mono">{dimension.dimensionCode}</td>
											<td class="py-2 pr-4 font-mono">{dimension.value}</td>
											<td class="py-2 text-right tabular-nums">{dimension.rowCount}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{/if}
			</fieldset>
		{/each}
	</div>
</Card>
