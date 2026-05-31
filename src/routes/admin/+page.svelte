<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import {
		AlertTriangle,
		CheckCircle2,
		ChevronsUpDown,
		Edit3,
		FileSpreadsheet,
		Sparkles,
		X
	} from 'lucide-svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Command from '$lib/components/ui/command';
	import { Label } from '$lib/components/ui/label';
	import * as Popover from '$lib/components/ui/popover';
	import * as Select from '$lib/components/ui/select';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const EMPTY_AREA = '__area_all__';

	let indicatorPopoverOpen = $state(false);
	let indicatorSearch = $state('');

	const attentionCount = $derived(
		data.indicators.filter((indicator) => indicator.attention.needsAttention).length
	);

	const selectedAreaLabel = $derived(
		data.filters.area
			? data.areas.find((area) => area.code === data.filters.area)?.name || data.filters.area
			: 'Todas'
	);

	const selectedSearchLabel = $derived.by(() => {
		if (!data.filters.search) return 'Todos los indicadores';
		const exactIndicator = data.catalog.find(
			(indicator) => indicator.code.toLowerCase() === data.filters.search.toLowerCase()
		);
		return exactIndicator
			? `${exactIndicator.code} · ${exactIndicator.name}`
			: `Búsqueda: ${data.filters.search}`;
	});

	const indicatorOptions = $derived(
		data.catalog.filter((indicator) => {
			if (data.filters.area && indicator.areaCode !== data.filters.area) return false;
			if (data.filters.attentionOnly && !indicator.attention.needsAttention) return false;
			return true;
		})
	);

	function frequencyLabel(freq: string): string {
		return freq === 'M' ? 'Mensual' : freq === 'A' ? 'Anual' : freq;
	}

	function setParamOrDelete(params: URLSearchParams, key: string, value: string | null) {
		if (value?.trim()) params.set(key, value.trim());
		else params.delete(key);
	}

	function adminHref(params: URLSearchParams): string {
		const canonical = new URLSearchParams();
		const q = params.get('q')?.trim();
		const area = params.get('area')?.trim();
		const attention = params.get('attention') === '1';

		if (q) canonical.set('q', q);
		if (area) canonical.set('area', area);
		if (attention) canonical.set('attention', '1');

		const search = canonical.toString();
		return search ? `/admin?${search}` : '/admin';
	}

	function navigateWith(mutator: (params: URLSearchParams) => void) {
		const params = new URLSearchParams(page.url.searchParams);
		mutator(params);
		const href = adminHref(params);
		const currentHref = page.url.pathname + (page.url.search ? page.url.search : '');

		if (href === currentHref) return;

		goto(href, {
			keepFocus: true,
			noScroll: true
		});
	}

	function handleAreaSelect(selectedValue: string) {
		const area = selectedValue === EMPTY_AREA ? '' : selectedValue;
		navigateWith((params) => {
			setParamOrDelete(params, 'area', area);
		});
	}

	function handleAttentionChange(event: Event) {
		const checked = (event.currentTarget as HTMLInputElement).checked;
		navigateWith((params) => {
			setParamOrDelete(params, 'attention', checked ? '1' : '');
		});
	}

	function applySearch(search: string) {
		indicatorPopoverOpen = false;
		indicatorSearch = '';
		navigateWith((params) => {
			setParamOrDelete(params, 'q', search);
		});
	}

	function selectIndicator(indicatorCode: string) {
		applySearch(indicatorCode);
	}

	function clearSearch() {
		indicatorPopoverOpen = false;
		indicatorSearch = '';
		navigateWith((params) => {
			params.delete('q');
		});
	}
</script>

<svelte:head>
	<title>Admin · Indicadores</title>
</svelte:head>

<div class="space-y-8">
	<section class="relative overflow-hidden rounded-2xl border bg-card p-6 shadow-sm">
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
					<h1 class="text-3xl font-bold tracking-tight">Administrar indicadores</h1>
					<p class="text-muted-foreground mt-2">
						Mejora nombres, descripciones y metodología para que el explorador sea más claro.
					</p>
					<Button href="/admin/ingest" variant="outline" class="mt-4">
						<FileSpreadsheet class="h-4 w-4" />
						Ingestar definiciones
					</Button>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Card.Card class="p-4 shadow-none">
					<div class="text-2xl font-semibold">{data.indicators.length}</div>
					<div class="text-muted-foreground text-xs">Resultados</div>
				</Card.Card>
				<Card.Card class="p-4 shadow-none">
					<div class="text-2xl font-semibold">{attentionCount}</div>
					<div class="text-muted-foreground text-xs">Con atención</div>
				</Card.Card>
				<Card.Card class="col-span-2 p-4 shadow-none sm:col-span-1">
					<div class="text-2xl font-semibold">{data.areas.length}</div>
					<div class="text-muted-foreground text-xs">Áreas</div>
				</Card.Card>
			</div>
		</div>
	</section>

	<Card.Card>
		<Card.CardContent class="px-5 py-5">
			<div class="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-end">
				<div class="space-y-2">
					<Label id="indicator-search-label">Indicador</Label>
					<Popover.Root bind:open={indicatorPopoverOpen}>
						<Popover.Trigger aria-labelledby="indicator-search-label">
							{#snippet child({ props })}
								<Button
									{...props}
									variant="outline"
									size="lg"
									class="w-full justify-between px-3 text-left font-normal"
								>
									<span class="truncate">{selectedSearchLabel}</span>
									<ChevronsUpDown class="text-muted-foreground ml-2 size-4 shrink-0" />
								</Button>
							{/snippet}
						</Popover.Trigger>
						<Popover.Content class="w-[min(760px,calc(100vw-2rem))] p-0" align="start">
							<Command.Root>
								<Command.Input
									bind:value={indicatorSearch}
									placeholder="Busca por código, nombre, grupo o área..."
								/>
								<Command.List class="max-h-96">
									<Command.Empty>No hay indicadores para esa búsqueda.</Command.Empty>
									{#if indicatorSearch.trim()}
										<Command.Group heading="Buscar texto">
											<Command.Item
												value={`buscar ${indicatorSearch.trim()}`}
												onSelect={() => applySearch(indicatorSearch.trim())}
											>
												<div class="py-1">
													<div class="font-medium">Buscar “{indicatorSearch.trim()}”</div>
													<div class="text-muted-foreground text-xs">
														Filtra por código, nombre, grupo o área
													</div>
												</div>
											</Command.Item>
										</Command.Group>
									{/if}
									<Command.Group heading="Indicadores">
										<Command.Item value="todos los indicadores" onSelect={clearSearch}>
											<div class="py-1">
												<div class="font-medium">Todos los indicadores</div>
												<div class="text-muted-foreground text-xs">Limpia la búsqueda actual</div>
											</div>
										</Command.Item>
										{#each indicatorOptions as indicator}
											<Command.Item
												value={`${indicator.code} ${indicator.name}`}
												keywords={[indicator.code, indicator.name, indicator.group, indicator.area]}
												onSelect={() => selectIndicator(indicator.code)}
											>
												<div class="min-w-0 flex-1 py-1">
													<div class="truncate font-medium">{indicator.name}</div>
													<div class="text-muted-foreground truncate text-xs">
														{indicator.code} · {indicator.area} · {indicator.group}
													</div>
												</div>
											</Command.Item>
										{/each}
									</Command.Group>
								</Command.List>
							</Command.Root>
						</Popover.Content>
					</Popover.Root>
				</div>

				<div class="space-y-2">
					<Label id="area-label">Área</Label>
					<Select.Root
						type="single"
						value={data.filters.area || EMPTY_AREA}
						onValueChange={handleAreaSelect}
					>
						<Select.Trigger aria-labelledby="area-label" class="h-9 w-full">
							<span class="truncate">{selectedAreaLabel}</span>
						</Select.Trigger>
						<Select.Content>
							<Select.Item value={EMPTY_AREA} label="Todas">Todas</Select.Item>
							{#each data.areas as area}
								<Select.Item value={area.code} label={area.name}>{area.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-3 sm:flex-row lg:justify-end">
					<label class="border-input flex h-9 items-center gap-2 rounded-lg border px-3 text-sm">
						<input
							type="checkbox"
							checked={data.filters.attentionOnly}
							onchange={handleAttentionChange}
						/>
						Necesitan atención
					</label>
					<Button href="/admin" variant="outline" size="lg">
						<X class="h-4 w-4" />
						Limpiar
					</Button>
				</div>
			</div>
		</Card.CardContent>
	</Card.Card>

	<Card.Card class="overflow-hidden">
		<div class="flex items-center justify-between border-b px-5 py-4">
			<div>
				<h2 class="font-semibold">Indicadores</h2>
				<p class="text-muted-foreground text-sm">
					Edita una fila para ajustar su contexto público.
				</p>
			</div>
		</div>

		<div class="overflow-x-auto">
			<table class="min-w-full text-sm">
				<thead class="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
					<tr>
						<th class="px-5 py-3 text-left font-medium">Indicador</th>
						<th class="px-5 py-3 text-left font-medium">Contexto</th>
						<th class="px-5 py-3 text-left font-medium">Formato</th>
						<th class="px-5 py-3 text-left font-medium">Atención</th>
						<th class="px-5 py-3 text-right font-medium">Acción</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each data.indicators as indicator}
						<tr class="transition-colors hover:bg-muted/40">
							<td class="max-w-md px-5 py-4">
								<div class="font-medium">{indicator.name}</div>
								<div class="text-muted-foreground mt-1 font-mono text-xs">{indicator.code}</div>
							</td>
							<td class="text-muted-foreground px-5 py-4">
								<div>{indicator.area}</div>
								<div class="mt-1 text-xs">{indicator.group}</div>
							</td>
							<td class="text-muted-foreground px-5 py-4">
								<div class="flex flex-wrap gap-1.5">
									{#if indicator.availableFrequencies.length > 0}
										{#each indicator.availableFrequencies as freq}
											<Badge variant="secondary">{frequencyLabel(freq)}</Badge>
										{/each}
									{:else}
										<Badge variant="outline">Sin datos</Badge>
									{/if}
								</div>
								<div class="mt-1 text-xs">{indicator.unit || 'Sin unidad'}</div>
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
										<Badge variant="secondary">Descripción</Badge>
									{/if}
									{#if indicator.attention.couldUseMethodology}
										<Badge variant="secondary">Metodología</Badge>
									{/if}
									{#if !indicator.attention.needsAttention}
										<Badge variant="outline" class="gap-1 text-emerald-700">
											<CheckCircle2 class="h-3 w-3" />
											OK
										</Badge>
									{/if}
								</div>
							</td>
							<td class="px-5 py-4 text-right">
								<Button
									href={`/admin/indicators/${encodeURIComponent(indicator.code)}`}
									variant="outline"
								>
									<Edit3 class="h-4 w-4" />
									Editar
								</Button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if data.indicators.length === 0}
			<div class="p-10 text-center">
				<p class="font-medium">No hay indicadores para estos filtros.</p>
				<p class="text-muted-foreground mt-1 text-sm">Limpia la búsqueda o cambia el área.</p>
				<Button href="/admin" variant="outline" class="mt-4">Limpiar filtros</Button>
			</div>
		{/if}
	</Card.Card>
</div>
