<script lang="ts">
	import {
		AlertTriangle,
		CalendarRange,
		CheckCircle2,
		CircleAlert,
		Columns3,
		CopyCheck,
		Layers3,
		Ruler
	} from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import type {
		BatchDiagnostic,
		BatchMeasurementSummary,
		BatchProfile,
		BatchValueSample
	} from '$lib/server/batch-ingest/types';

	interface Props {
		profile: BatchProfile;
	}

	let { profile }: Props = $props();

	const reviewDiagnostics = $derived(
		profile.diagnostics.filter((diagnostic) => diagnostic.severity !== 'info')
	);

	function integer(value: number): string {
		return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
	}

	function decimal(value: number | null): string {
		if (value === null) return '—';
		return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 }).format(value);
	}

	function periodRange(start: string | null, end: string | null): string {
		if (!start && !end) return 'Sin períodos válidos';
		if (start === end) return start ?? end ?? '—';
		return `${start ?? '—'} – ${end ?? '—'}`;
	}

	function sampleLabel(samples: BatchValueSample[]): string {
		if (samples.length === 0) return 'Sin valores';
		return samples
			.slice(0, 4)
			.map((sample) => `${sample.value ?? 'NULL'} (${integer(sample.rowCount)})`)
			.join(', ');
	}

	function measurementVariation(measurement: BatchMeasurementSummary): string[] {
		return [
			`Unidad: ${sampleLabel(measurement.unitValues)}`,
			`Multiplicador: ${sampleLabel(measurement.unitMultValues)}`,
			`Decimales: ${sampleLabel(measurement.decimalValues)}`
		];
	}

	function diagnosticVariant(
		severity: BatchDiagnostic['severity']
	): 'destructive' | 'warning' | 'secondary' {
		if (severity === 'error') return 'destructive';
		if (severity === 'warning') return 'warning';
		return 'secondary';
	}

	function diagnosticLabel(severity: BatchDiagnostic['severity']): string {
		if (severity === 'error') return 'Error';
		if (severity === 'warning') return 'Advertencia';
		return 'Información';
	}
</script>

<div class="space-y-6">
	<Card class="overflow-hidden">
		<div class="border-b border-slate-200 p-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<div class="flex items-center gap-2">
						<Layers3 class="h-4 w-4 text-slate-600" />
						<h2 class="font-semibold text-slate-950">Perfil del lote</h2>
					</div>
					<p class="mt-1 max-w-2xl text-sm text-slate-500">
						La evidencia corresponde al archivo completo. Cada fila de la tabla es un segmento
						<code class="font-mono text-xs">indicator_code + freq</code> derivado del contenido.
					</p>
				</div>
				<div class="flex flex-wrap gap-2">
					<Badge variant={profile.totals.errorCount > 0 ? 'destructive' : 'success'}>
						{profile.totals.errorCount} errores
					</Badge>
					<Badge variant={profile.totals.warningCount > 0 ? 'warning' : 'secondary'}>
						{profile.totals.warningCount} advertencias
					</Badge>
				</div>
			</div>
		</div>

		<div class="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">Filas</div>
				<div class="mt-1 text-lg font-semibold text-slate-950">
					{integer(profile.source.rowCount)}
				</div>
			</div>
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">Segmentos</div>
				<div class="mt-1 text-lg font-semibold text-slate-950">{profile.totals.sliceCount}</div>
			</div>
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					Columnas fuente
				</div>
				<div class="mt-1 text-lg font-semibold text-slate-950">{profile.columns.length}</div>
			</div>
			<div class="bg-white p-4">
				<div class="text-xs font-medium uppercase tracking-wide text-slate-500">
					Dimensionalidad
				</div>
				<div class="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-950">
					{#if profile.uniformDimensionality.compatible}
						<CheckCircle2 class="h-4 w-4 text-emerald-700" /> Compatible
					{:else}
						<CircleAlert class="h-4 w-4 text-red-700" /> Incompatible
					{/if}
				</div>
			</div>
		</div>
	</Card>

	{#if reviewDiagnostics.length > 0 || profile.adminReviewQuestions.length > 0}
		<Card class="overflow-hidden">
			<div class="border-b border-slate-200 p-5">
				<div class="flex items-center gap-2 font-semibold text-slate-950">
					<AlertTriangle class="h-4 w-4" />
					Hallazgos para revisión
				</div>
				<p class="mt-1 text-sm text-slate-500">
					Los errores bloquean las operaciones posteriores. Las advertencias requieren revisión
					antes de aceptar el contrato del lote.
				</p>
			</div>
			<ul class="divide-y divide-slate-200" aria-label="Hallazgos del análisis">
				{#each reviewDiagnostics as diagnostic}
					<li class="flex items-start gap-3 p-4 text-sm">
						<Badge variant={diagnosticVariant(diagnostic.severity)} class="mt-0.5 shrink-0">
							{diagnosticLabel(diagnostic.severity)}
						</Badge>
						<div class="min-w-0">
							<p class="text-slate-800">{diagnostic.message}</p>
							<div class="mt-1 flex flex-wrap gap-2 font-mono text-xs text-slate-500">
								<span>{diagnostic.code}</span>
								{#if diagnostic.sliceKey}<span>· {diagnostic.sliceKey}</span>{/if}
							</div>
						</div>
					</li>
				{/each}
				{#each profile.adminReviewQuestions as question}
					<li class="flex items-start gap-3 p-4 text-sm">
						<Badge
							variant={question.severity === 'warning' ? 'warning' : 'secondary'}
							class="mt-0.5 shrink-0"
						>
							Revisión
						</Badge>
						<div class="min-w-0">
							<p class="text-slate-800">{question.message}</p>
							<p class="mt-1 font-mono text-xs text-slate-500">{question.id}</p>
						</div>
					</li>
				{/each}
			</ul>
		</Card>
	{/if}

	<Card class="overflow-hidden">
		<div class="border-b border-slate-200 p-5">
			<div class="flex items-center gap-2 font-semibold text-slate-950">
				<CopyCheck class="h-4 w-4" />
				Segmentos derivados
			</div>
			<p class="mt-1 text-sm text-slate-500">
				Revisa cobertura, medición, dimensiones y llaves duplicadas por segmento. Abre una fila para
				inspeccionar sus valores candidatos.
			</p>
		</div>

		<div class="overflow-x-auto">
			<table class="min-w-full text-sm">
				<caption class="sr-only"
					>Perfil de segmentos de indicador y frecuencia derivados del lote</caption
				>
				<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th class="px-5 py-3 text-left font-medium">Segmento</th>
						<th class="px-5 py-3 text-left font-medium">Filas</th>
						<th class="px-5 py-3 text-left font-medium">Períodos</th>
						<th class="px-5 py-3 text-left font-medium">Medición</th>
						<th class="px-5 py-3 text-left font-medium">Dimensiones</th>
						<th class="px-5 py-3 text-left font-medium">Duplicados</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-200 bg-white">
					{#each profile.slices as slice}
						<tr class="align-top hover:bg-slate-50/70">
							<td class="px-5 py-4">
								<div class="font-mono font-medium text-slate-950">{slice.indicatorCode}</div>
								<div class="mt-1 flex items-center gap-2">
									<Badge variant="secondary">{slice.freq}</Badge>
									{#if slice.diagnostics.length > 0}
										<span class="text-xs text-slate-500">{slice.diagnostics.length} hallazgos</span>
									{/if}
								</div>
							</td>
							<td class="px-5 py-4 tabular-nums text-slate-700">{integer(slice.rowCount)}</td>
							<td class="min-w-44 px-5 py-4">
								<div class="flex items-center gap-2 text-slate-700">
									<CalendarRange class="h-4 w-4 text-slate-400" />
									<span class="font-mono text-xs"
										>{periodRange(slice.periodStart, slice.periodEnd)}</span
									>
								</div>
								{#if slice.sourcePeriodStart || slice.sourcePeriodEnd}
									<div class="mt-1 text-xs text-slate-500">
										Fuente: {periodRange(slice.sourcePeriodStart, slice.sourcePeriodEnd)}
									</div>
								{/if}
							</td>
							<td class="min-w-44 px-5 py-4 text-xs text-slate-600">
								<div>
									Rango: {decimal(slice.measurement.min)} – {decimal(slice.measurement.max)}
								</div>
								<div class="mt-1">Nulos: {integer(slice.measurement.nullCount)}</div>
							</td>
							<td class="min-w-44 px-5 py-4">
								{#if slice.dimensions.length > 0}
									<div class="flex flex-wrap gap-1.5">
										{#each slice.dimensions as dimension}
											<Badge
												variant={dimension.fixedTotalCandidate ? 'warning' : 'outline'}
												class="font-mono"
											>
												{dimension.field}
											</Badge>
										{/each}
									</div>
								{:else}
									<span class="text-slate-500">Sin dimensiones</span>
								{/if}
							</td>
							<td class="px-5 py-4">
								{#if slice.duplicateKeys.duplicateKeyCount === 0}
									<div class="flex items-center gap-2 text-emerald-800">
										<CheckCircle2 class="h-4 w-4" /> Ninguno
									</div>
								{:else}
									<div class="flex items-center gap-2 font-medium text-red-800">
										<CircleAlert class="h-4 w-4" />
										{integer(slice.duplicateKeys.duplicateKeyCount)} llaves
									</div>
									<div class="mt-1 text-xs text-red-700">
										{integer(slice.duplicateKeys.duplicateRowCount)} filas afectadas
									</div>
								{/if}
							</td>
						</tr>
						<tr>
							<td colspan="6" class="px-5 pb-4 pt-0">
								<details class="rounded-lg border border-slate-200 bg-slate-50">
									<summary
										class="cursor-pointer px-4 py-3 text-xs font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2"
									>
										Inspeccionar medición, dimensiones y diagnósticos
									</summary>
									<div class="grid gap-5 border-t border-slate-200 p-4 lg:grid-cols-2">
										<section aria-label={`Medición de ${slice.key}`}>
											<div
												class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600"
											>
												<Ruler class="h-4 w-4" /> Medición
											</div>
											<dl class="mt-3 grid grid-cols-2 gap-2 text-xs">
												<div>
													<dt class="text-slate-500">No nulos</dt>
													<dd class="mt-0.5 tabular-nums text-slate-900">
														{integer(slice.measurement.nonNullCount)}
													</dd>
												</div>
												<div>
													<dt class="text-slate-500">Valores distintos</dt>
													<dd class="mt-0.5 tabular-nums text-slate-900">
														{integer(slice.measurement.distinctValueCount)}
													</dd>
												</div>
												<div>
													<dt class="text-slate-500">Promedio</dt>
													<dd class="mt-0.5 tabular-nums text-slate-900">
														{decimal(slice.measurement.average)}
													</dd>
												</div>
												<div>
													<dt class="text-slate-500">Nulos</dt>
													<dd class="mt-0.5 tabular-nums text-slate-900">
														{integer(slice.measurement.nullCount)}
													</dd>
												</div>
											</dl>
											<ul class="mt-3 space-y-1 text-xs text-slate-600">
												{#each measurementVariation(slice.measurement) as line}<li>
														{line}
													</li>{/each}
											</ul>
										</section>

										<section aria-label={`Dimensiones de ${slice.key}`}>
											<div
												class="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600"
											>
												<Columns3 class="h-4 w-4" /> Dimensiones candidatas
											</div>
											{#if slice.dimensions.length > 0}
												<ul class="mt-3 space-y-3">
													{#each slice.dimensions as dimension}
														<li class="text-xs">
															<div class="flex flex-wrap items-center gap-2">
																<code class="font-mono text-slate-950">{dimension.field}</code>
																<span class="text-slate-500"
																	>{integer(dimension.distinctValueCount)} valores · {integer(
																		dimension.nullCount
																	)} nulos</span
																>
																{#if dimension.fixedTotalCandidate}<Badge variant="warning"
																		>Total fijo</Badge
																	>{/if}
															</div>
															<p class="mt-1 break-words text-slate-600">
																{sampleLabel(dimension.values)}
															</p>
														</li>
													{/each}
												</ul>
											{:else}
												<p class="mt-3 text-xs text-slate-500">
													El análisis no detectó dimensiones observables.
												</p>
											{/if}
										</section>

										{#if slice.diagnostics.length > 0}
											<section class="lg:col-span-2" aria-label={`Diagnósticos de ${slice.key}`}>
												<div class="text-xs font-semibold uppercase tracking-wide text-slate-600">
													Diagnósticos del segmento
												</div>
												<ul class="mt-2 space-y-2">
													{#each slice.diagnostics as diagnostic}
														<li class="flex items-start gap-2 text-xs text-slate-700">
															<Badge variant={diagnosticVariant(diagnostic.severity)}
																>{diagnosticLabel(diagnostic.severity)}</Badge
															>
															<span>{diagnostic.message}</span>
														</li>
													{/each}
												</ul>
											</section>
										{/if}
									</div>
								</details>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>
</div>
