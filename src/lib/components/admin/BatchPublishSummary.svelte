<script lang="ts">
	import { AlertTriangle, CheckCircle2, DatabaseZap, GitBranch, Rows3 } from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import type { PublishBatchResult } from '$lib/server/batch-ingest/publish';
	import type { StagedBatchManifest } from '$lib/server/batch-ingest/storage';

	interface Props {
		staged: StagedBatchManifest | null;
		published: PublishBatchResult | null;
	}

	let { staged, published }: Props = $props();

	function integer(value: number): string {
		return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
	}

	function lineageFor(sliceId: number) {
		return published?.slices.find((slice) => slice.sliceId === sliceId) ?? null;
	}
</script>

{#if staged}
	<Card class="overflow-hidden">
		<div class="border-b border-slate-200 p-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div class="flex items-center gap-2 font-semibold text-slate-950">
						<DatabaseZap class="h-4 w-4" />
						Resultado de preparación
					</div>
					<p class="mt-1 max-w-2xl text-sm text-slate-500">
						Cada artefacto Parquet es inmutable y corresponde a un solo segmento validado contra su
						definición registrada.
					</p>
				</div>
				<Badge variant={staged.validation.valid ? 'success' : 'destructive'}>
					{staged.validation.valid ? 'Todos los segmentos válidos' : 'Preparación bloqueada'}
				</Badge>
			</div>
		</div>

		<div class="grid gap-px bg-slate-200 sm:grid-cols-3">
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">Segmentos</div>
				<div class="mt-1 text-lg font-semibold text-slate-950">{staged.totals.sliceCount}</div>
			</div>
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">Filas</div>
				<div class="mt-1 text-lg font-semibold text-slate-950">
					{integer(staged.totals.rowCount)}
				</div>
			</div>
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">Validación</div>
				<div class="mt-1 text-sm font-semibold text-slate-950">
					{staged.validation.errorCount} errores · {staged.validation.warningCount} advertencias
				</div>
			</div>
		</div>

		{#if staged.validation.diagnostics.length > 0}
			<div
				class="border-t p-4 text-sm {staged.validation.valid
					? 'border-amber-200 bg-amber-50 text-amber-900'
					: 'border-red-200 bg-red-50 text-red-800'}"
				role={staged.validation.valid ? 'status' : 'alert'}
			>
				<div class="flex items-center gap-2 font-semibold">
					<AlertTriangle class="h-4 w-4" /> Diagnósticos de preparación
				</div>
				<ul class="mt-2 list-disc space-y-1 pl-5">
					{#each staged.validation.diagnostics as diagnostic}
						<li>
							{diagnostic.message}{#if diagnostic.sliceKey}
								(<code class="font-mono text-xs">{diagnostic.sliceKey}</code>){/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="overflow-x-auto">
			<table class="min-w-full text-sm">
				<caption class="sr-only">Validación y trazabilidad de segmentos preparados</caption>
				<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th class="px-5 py-3 text-left font-medium">Segmento</th>
						<th class="px-5 py-3 text-left font-medium">Cobertura</th>
						<th class="px-5 py-3 text-right font-medium">Filas</th>
						<th class="px-5 py-3 text-left font-medium">Preparación</th>
						<th class="px-5 py-3 text-left font-medium">Linaje publicado</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200 bg-white">
					{#each staged.slices as slice}
						{@const lineage = lineageFor(slice.sliceId)}
						<tr class="align-top">
							<td class="px-5 py-4">
								<div class="font-mono text-xs font-semibold text-slate-950">
									{slice.indicatorCode} / {slice.freq}
								</div>
								<div class="mt-1 text-xs text-slate-500">Segmento #{slice.sliceId}</div>
							</td>
							<td class="px-5 py-4 font-mono text-xs text-slate-600">
								{slice.periodStart ?? '—'} – {slice.periodEnd ?? '—'}
							</td>
							<td class="px-5 py-4 text-right tabular-nums text-slate-700">
								{integer(slice.rowCount)}
							</td>
							<td class="px-5 py-4">
								<div
									class="flex items-center gap-2 {slice.validation.valid
										? 'text-emerald-800'
										: 'text-red-800'}"
								>
									{#if slice.validation.valid}<CheckCircle2 class="h-4 w-4" /> Válido{:else}<AlertTriangle
											class="h-4 w-4"
										/> Fallido{/if}
								</div>
								<div class="mt-1 text-xs text-slate-500">
									{slice.validation.errorCount} errores · {slice.validation.warningCount}
									advertencias
								</div>
							</td>
							<td class="px-5 py-4">
								{#if lineage}
									<div class="flex items-center gap-2 text-emerald-800">
										<GitBranch class="h-4 w-4" /> Liberación #{lineage.releaseId}
									</div>
									<div class="mt-1 flex items-center gap-1 text-xs text-slate-500">
										<Rows3 class="h-3.5 w-3.5" />
										{integer(lineage.rowCount)} filas
									</div>
								{:else}
									<span class="text-xs text-slate-500">Aún no publicado</span>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>
{/if}

{#if published}
	<div
		class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"
		role="status"
		aria-live="polite"
	>
		<div class="flex items-center gap-2 font-semibold">
			<CheckCircle2 class="h-4 w-4" /> Publicación completa
		</div>
		<p class="mt-1">
			Se publicaron {published.slices.length} segmentos de forma conjunta el {published.publishedAt}.
			La tabla anterior muestra la liberación de linaje creada para cada segmento.
		</p>
	</div>
{/if}
