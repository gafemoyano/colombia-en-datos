<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type * as PlotlyTypes from 'plotly.js';

	interface Props {
		data: PlotlyTypes.Data[];
		layout?: Partial<PlotlyTypes.Layout>;
		config?: Partial<PlotlyTypes.Config>;
		class?: string;
	}

	let { data, layout = {}, config = {}, class: className = '' }: Props = $props();

	let container: HTMLDivElement;
	let plotlyModule = $state<typeof PlotlyTypes | null>(null);

	const defaultLayout = $derived<Partial<PlotlyTypes.Layout>>({
		autosize: true,
		margin: { l: 50, r: 50, t: 50, b: 50 },
		...layout
	});

	const defaultConfig = $derived<Partial<PlotlyTypes.Config>>({
		responsive: true,
		displayModeBar: true,
		...config
	});

	onMount(async () => {
		plotlyModule = await import('plotly.js-dist-min');
	});

	$effect(() => {
		if (container && plotlyModule && data) {
			void plotlyModule.react(container, data, defaultLayout, defaultConfig);
		}
	});

	onDestroy(() => {
		if (container && plotlyModule) {
			plotlyModule.purge(container);
		}
	});
</script>

<div bind:this={container} class={`plotly-chart ${className}`}></div>

<style>
	.plotly-chart {
		width: 100%;
		height: 100%;
		min-height: 400px;
	}
</style>
