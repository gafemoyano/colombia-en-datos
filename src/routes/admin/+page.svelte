<script lang="ts">
	import { AlertTriangle, CheckCircle2, Edit3, Filter, Search, Sparkles } from 'lucide-svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Label from '$lib/components/ui/Label.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const attentionCount = $derived(
		data.indicators.filter((indicator) => indicator.attention.needsAttention).length
	);
</script>

<svelte:head>
	<title>Admin · Indicadores</title>
</svelte:head>

<div class="space-y-8">
	<section
		class="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
	>
		<div
			class="absolute right-0 top-0 h-40 w-40 translate-x-10 -translate-y-10 rounded-full bg-blue-100 blur-3xl"
		></div>
		<div
			class="absolute bottom-0 right-28 h-32 w-32 translate-y-14 rounded-full bg-amber-100 blur-3xl"
		></div>
		<div class="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
			<div class="max-w-2xl space-y-3">
				<Badge variant="secondary" class="gap-1">
					<Sparkles class="h-3.5 w-3.5" />
					Anotaciones de indicadores
				</Badge>
				<div>
					<h1 class="text-3xl font-bold tracking-tight text-slate-950">Administrar indicadores</h1>
					<p class="mt-2 text-slate-600">
						Mejora nombres, descripciones y metodología para que el explorador sea más claro.
					</p>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Card class="p-4 shadow-none">
					<div class="text-2xl font-semibold">{data.indicators.length}</div>
					<div class="text-xs text-slate-500">Resultados</div>
				</Card>
				<Card class="p-4 shadow-none">
					<div class="text-2xl font-semibold">{attentionCount}</div>
					<div class="text-xs text-slate-500">Con atención</div>
				</Card>
				<Card class="col-span-2 p-4 shadow-none sm:col-span-1">
					<div class="text-2xl font-semibold">{data.areas.length}</div>
					<div class="text-xs text-slate-500">Áreas</div>
				</Card>
			</div>
		</div>
	</section>

	<Card class="p-5">
		<form method="GET" class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_220px_auto] lg:items-end">
			<div class="space-y-2">
				<Label for="q">Buscar</Label>
				<div class="relative">
					<Search
						class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
					/>
					<Input
						id="q"
						name="q"
						value={data.filters.search}
						placeholder="Código, nombre, grupo..."
						class="pl-9"
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label for="area">Área</Label>
				<Select id="area" name="area">
					<option value="">Todas</option>
					{#each data.areas as area}
						<option value={area.code} selected={data.filters.area === area.code}>{area.name}</option
						>
					{/each}
				</Select>
			</div>

			<div class="flex flex-col gap-3 sm:flex-row lg:justify-end">
				<label
					class="flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm text-slate-700"
				>
					<input type="checkbox" name="attention" value="1" checked={data.filters.attentionOnly} />
					Necesitan atención
				</label>
				<Button type="submit" class="gap-2">
					<Filter class="h-4 w-4" />
					Filtrar
				</Button>
				<a href="/admin" class={cn(buttonVariants({ variant: 'outline' }))}>Limpiar</a>
			</div>
		</form>
	</Card>

	<Card class="overflow-hidden">
		<div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
			<div>
				<h2 class="font-semibold text-slate-950">Indicadores</h2>
				<p class="text-sm text-slate-500">Edita una fila para ajustar su contexto público.</p>
			</div>
		</div>

		<div class="overflow-x-auto">
			<table class="min-w-full text-sm">
				<thead class="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
					<tr>
						<th class="px-5 py-3 text-left font-medium">Indicador</th>
						<th class="px-5 py-3 text-left font-medium">Contexto</th>
						<th class="px-5 py-3 text-left font-medium">Formato</th>
						<th class="px-5 py-3 text-left font-medium">Atención</th>
						<th class="px-5 py-3 text-right font-medium">Acción</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-slate-100">
					{#each data.indicators as indicator}
						<tr class="transition-colors hover:bg-slate-50/80">
							<td class="max-w-md px-5 py-4">
								<div class="font-medium text-slate-950">{indicator.name}</div>
								<div class="mt-1 font-mono text-xs text-slate-500">{indicator.code}</div>
							</td>
							<td class="px-5 py-4 text-slate-600">
								<div>{indicator.area}</div>
								<div class="mt-1 text-xs text-slate-500">{indicator.group}</div>
							</td>
							<td class="px-5 py-4 text-slate-600">
								<div>{indicator.frequency === 'M' ? 'Mensual' : 'Anual'}</div>
								<div class="mt-1 text-xs text-slate-500">{indicator.unit || 'Sin unidad'}</div>
							</td>
							<td class="px-5 py-4">
								<div class="flex flex-wrap gap-1.5">
									{#if indicator.attention.needsTitle}
										<Badge variant="destructive" class="gap-1">
											<AlertTriangle class="h-3 w-3" />
											Título
										</Badge>
									{/if}
									{#if indicator.attention.couldUseDescription}
										<Badge variant="warning">Descripción</Badge>
									{/if}
									{#if indicator.attention.couldUseMethodology}
										<Badge variant="warning">Metodología</Badge>
									{/if}
									{#if !indicator.attention.needsAttention}
										<Badge variant="success" class="gap-1">
											<CheckCircle2 class="h-3 w-3" />
											OK
										</Badge>
									{/if}
								</div>
							</td>
							<td class="px-5 py-4 text-right">
								<a
									class={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
									href={`/admin/indicators/${encodeURIComponent(indicator.code)}`}
								>
									<Edit3 class="h-4 w-4" />
									Editar
								</a>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</Card>
</div>
