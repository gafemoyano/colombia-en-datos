<script lang="ts">
	import { BarChart3, Database, FileSpreadsheet, Home, Shield } from 'lucide-svelte';
	import { buttonVariants } from '$lib/components/ui/button';
	import { cn } from '$lib/utils';

	let { children } = $props();
</script>

<div class="min-h-screen bg-slate-50 text-slate-950">
	<div class="border-b bg-white/80 backdrop-blur">
		<div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
			<a href="/admin" class="flex items-center gap-3">
				<div
					class="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm"
				>
					<Shield class="h-4 w-4" />
				</div>
				<div>
					<div class="text-sm font-semibold leading-none">Colombia en Datos</div>
					<div class="text-xs text-slate-500">Administración</div>
				</div>
			</a>

			<nav class="flex items-center gap-2">
				<a
					href="/admin"
					class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
				>
					<Database class="h-4 w-4" />
					Indicadores
				</a>
				<a
					href="/admin/ingest"
					class={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'hidden sm:inline-flex')}
				>
					<FileSpreadsheet class="h-4 w-4" />
					Ingesta
				</a>
				<a href="/explore" class={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
					<BarChart3 class="h-4 w-4" />
					<span class="hidden sm:inline">Ver explorador</span>
				</a>
				<a
					href="/"
					class={cn(buttonVariants({ variant: 'ghost', size: 'icon' }))}
					aria-label="Inicio"
				>
					<Home class="h-4 w-4" />
				</a>
			</nav>
		</div>
	</div>

	<main class="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
		{@render children?.()}
	</main>
</div>
