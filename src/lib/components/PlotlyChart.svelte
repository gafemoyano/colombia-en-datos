<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import type * as PlotlyTypes from 'plotly.js';
	import {
		performanceMark,
		performanceMeasure,
		type ExplorerPerformanceContext
	} from '$lib/explorer-performance';

	interface Props {
		data: PlotlyTypes.Data[];
		layout?: Partial<PlotlyTypes.Layout>;
		config?: Partial<PlotlyTypes.Config>;
		class?: string;
		performanceRequestId?: string | null;
		performanceNavigationId?: string | null;
	}

	let {
		data,
		layout = {},
		config = {},
		class: className = '',
		performanceRequestId = null,
		performanceNavigationId = null
	}: Props = $props();

	let container: HTMLDivElement;
	let plotlyModule = $state<typeof PlotlyTypes | null>(null);
	let renderGeneration = 0;
	let destroyed = false;

	function performanceContext(): ExplorerPerformanceContext | null {
		return performanceRequestId && performanceNavigationId
			? { requestId: performanceRequestId, navigationId: performanceNavigationId }
			: null;
	}

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
		const context = performanceContext();
		const importStart = context && performanceMark(context, 'plotly', 'import-start');
		const imported = await import('plotly.js-dist-min');
		if (context && importStart) {
			const importEnd = performanceMark(context, 'plotly', 'import-complete');
			performanceMeasure(context, 'plotly', 'import', importStart, importEnd);
		}
		if (!destroyed) plotlyModule = imported;
	});

	$effect(() => {
		if (container && plotlyModule && data) {
			const generation = ++renderGeneration;
			const context = untrack(performanceContext);
			const renderStart = context && performanceMark(context, 'plotly', 'render-start');
			void plotlyModule.react(container, data, defaultLayout, defaultConfig).then(() => {
				if (destroyed || generation !== renderGeneration || !context || !renderStart) return;
				if (
					context.requestId !== performanceRequestId ||
					context.navigationId !== performanceNavigationId
				)
					return;
				const renderEnd = performanceMark(context, 'plotly', 'render-complete');
				performanceMeasure(context, 'plotly', 'render', renderStart, renderEnd);
				requestAnimationFrame(() => {
					if (destroyed || generation !== renderGeneration) return;
					if (
						context.requestId !== performanceRequestId ||
						context.navigationId !== performanceNavigationId
					)
						return;
					const frame = performanceMark(context, 'plotly', 'frame-opportunity');
					performanceMeasure(context, 'plotly', 'render-to-frame-opportunity', renderEnd, frame);
				});
			});
		}
	});

	onDestroy(() => {
		destroyed = true;
		renderGeneration += 1;
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
