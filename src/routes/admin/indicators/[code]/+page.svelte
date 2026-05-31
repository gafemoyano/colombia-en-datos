<script lang="ts">
	import { ArrowLeft, Database, Layers3, Save } from 'lucide-svelte';
	import Alert from '$lib/components/ui/Alert.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Label from '$lib/components/ui/Label.svelte';
	import Separator from '$lib/components/ui/Separator.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Admin · {data.indicator.code}</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6">
	<div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
		<div class="space-y-3">
			<a href="/admin" class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
				<ArrowLeft class="h-4 w-4" />
				Volver a indicadores
			</a>
			<div>
				<div class="flex flex-wrap items-center gap-2">
					<h1 class="text-3xl font-bold tracking-tight text-slate-950">{data.indicator.name}</h1>
					<Badge variant="secondary">{data.indicator.frequency === 'M' ? 'Mensual' : 'Anual'}</Badge
					>
				</div>
				<p class="mt-2 font-mono text-sm text-slate-500">{data.indicator.code}</p>
			</div>
		</div>
	</div>

	{#if data.saved}
		<Alert variant="success">Indicador guardado.</Alert>
	{/if}

	{#if form?.error}
		<Alert variant="destructive">{form.error}</Alert>
	{/if}

	<div class="grid gap-6 lg:grid-cols-[280px_1fr]">
		<div class="space-y-6">
			<Card class="p-5">
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
					<Layers3 class="h-4 w-4" />
					Contexto de origen
				</div>
				<Separator class="my-4" />
				<dl class="space-y-4 text-sm">
					<div>
						<dt class="text-slate-500">Fuente de datos</dt>
						<dd class="mt-1 font-medium text-slate-950">{data.indicator.dataSource}</dd>
					</div>
					<div>
						<dt class="text-slate-500">Grupo</dt>
						<dd class="mt-1 font-medium text-slate-950">{data.indicator.group}</dd>
						<dd class="mt-1 font-mono text-xs text-slate-500">{data.indicator.groupCode}</dd>
					</div>
					<div>
						<dt class="text-slate-500">Dimensiones del grupo</dt>
						<dd class="mt-1 text-slate-700">
							{data.indicator.filterWhitelist?.join(', ') || 'Sin definir'}
						</dd>
					</div>
				</dl>
			</Card>

			<Card class="p-5">
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-950">
					<Database class="h-4 w-4" />
					Formato actual
				</div>
				<Separator class="my-4" />
				<div class="grid grid-cols-2 gap-3 text-sm">
					<div class="rounded-lg bg-slate-50 p-3">
						<div class="text-xs text-slate-500">Unidad</div>
						<div class="mt-1 font-medium">{data.indicator.unit || '—'}</div>
					</div>
					<div class="rounded-lg bg-slate-50 p-3">
						<div class="text-xs text-slate-500">Decimales</div>
						<div class="mt-1 font-medium">{data.indicator.decimals ?? '—'}</div>
					</div>
				</div>
			</Card>
		</div>

		<form method="POST" class="space-y-6">
			<Card class="p-6">
				<div>
					<h2 class="text-lg font-semibold text-slate-950">Anotación pública</h2>
					<p class="mt-1 text-sm text-slate-500">
						Estos campos alimentan el selector, la gráfica y el panel de información del indicador.
					</p>
				</div>
				<Separator class="my-6" />

				<div class="space-y-5">
					<div class="grid gap-5 md:grid-cols-2">
						<div class="space-y-2 md:col-span-2">
							<Label for="name">Nombre público</Label>
							<Input id="name" name="name" value={data.indicator.name} required />
						</div>

						<div class="space-y-2 md:col-span-2">
							<Label for="shortName">Nombre corto</Label>
							<Input
								id="shortName"
								name="shortName"
								value={data.indicator.shortName || ''}
								placeholder="Opcional para etiquetas de gráfica"
							/>
						</div>

						<div class="space-y-2 md:col-span-2">
							<Label for="description">Descripción</Label>
							<Textarea
								id="description"
								name="description"
								rows={4}
								value={data.indicator.description || ''}
								placeholder="Explicación breve para usuarios no técnicos"
							/>
						</div>

						<div class="space-y-2 md:col-span-2">
							<Label for="methodology">Metodología</Label>
							<Textarea
								id="methodology"
								name="methodology"
								rows={7}
								value={data.indicator.methodology || ''}
								placeholder="Definición formal, fórmula o nota metodológica"
							/>
						</div>
					</div>
				</div>
			</Card>

			<Card class="p-6">
				<h2 class="text-lg font-semibold text-slate-950">Citación y formato</h2>
				<Separator class="my-6" />

				<div class="grid gap-5 md:grid-cols-2">
					<div class="space-y-2">
						<Label for="sourceCitation">Citación de fuente</Label>
						<Input
							id="sourceCitation"
							name="sourceCitation"
							value={data.indicator.sourceCitation || ''}
						/>
					</div>
					<div class="space-y-2">
						<Label for="updated">Actualizado</Label>
						<Input
							id="updated"
							name="updated"
							value={data.indicator.updated || ''}
							placeholder="2025-06"
						/>
					</div>
					<div class="space-y-2">
						<Label for="unit">Unidad</Label>
						<Input id="unit" name="unit" value={data.indicator.unit || ''} />
					</div>
					<div class="space-y-2">
						<Label for="unitMult">Multiplicador</Label>
						<Input
							id="unitMult"
							name="unitMult"
							type="number"
							value={data.indicator.unitMult ?? ''}
						/>
					</div>
					<div class="space-y-2">
						<Label for="decimals">Decimales</Label>
						<Input
							id="decimals"
							name="decimals"
							type="number"
							value={data.indicator.decimals ?? ''}
						/>
					</div>
					<div class="space-y-2">
						<Label for="defaultViz">Visualización por defecto</Label>
						<Input
							id="defaultViz"
							name="defaultViz"
							value={data.indicator.defaultViz || 'time_series'}
						/>
					</div>
				</div>
			</Card>

			<div
				class="sticky bottom-4 z-10 flex justify-end gap-3 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-lg backdrop-blur"
			>
				<a href="/admin" class={cn(buttonVariants({ variant: 'outline' }))}>Cancelar</a>
				<Button type="submit" class="gap-2">
					<Save class="h-4 w-4" />
					Guardar cambios
				</Button>
			</div>
		</form>
	</div>
</div>
