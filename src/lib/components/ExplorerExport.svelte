<script lang="ts">
	import { navigating } from '$app/state';
	import type { ExportModel } from '$lib/explorer-export';
	import { Button } from '$lib/components/ui/button';
	import * as Popover from '$lib/components/ui/popover';
	import Download from '@lucide/svelte/icons/download';

	let { model }: { model: ExportModel } = $props();
	let open = $state(false);
	let busy = $state(false);
	let error = $state('');
	const disabled = $derived(busy || !!navigating.to || model.chart.status !== 'chartable');

	async function download(format: 'csv' | 'xlsx') {
		if (disabled) return;
		// Capture the selection before loading code; navigation may change props meanwhile.
		const snapshot = model;
		busy = true;
		error = '';
		open = false;
		try {
			const { downloadExport } = await import('$lib/explorer-export');
			await downloadExport(snapshot, format, window.location.origin);
		} catch {
			error = 'No se pudo descargar el archivo. Inténtalo de nuevo.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-2">
	<Popover.Root bind:open>
		<Popover.Trigger>
			{#snippet child({ props })}
				<Button {...props} variant="outline" {disabled}>
					<Download class="size-4" />
					{busy ? 'Preparando descarga…' : 'Descargar datos'}
				</Button>
			{/snippet}
		</Popover.Trigger>
		<Popover.Content align="end" class="w-72 space-y-2">
			<p class="text-muted-foreground text-sm">
				Incluye toda la selección y el periodo elegido, incluso series ocultas. El zoom no modifica
				la descarga.
			</p>
			<Button
				variant="ghost"
				class="w-full justify-start"
				{disabled}
				onclick={() => download('csv')}>Descargar CSV</Button
			>
			<Button
				variant="ghost"
				class="w-full justify-start"
				{disabled}
				onclick={() => download('xlsx')}>Descargar Excel (.xlsx)</Button
			>
		</Popover.Content>
	</Popover.Root>
	{#if busy}<p role="status" class="text-muted-foreground text-sm">Preparando archivo…</p>{/if}
	{#if error}<p role="alert" class="text-destructive text-sm">{error}</p>{/if}
</div>
