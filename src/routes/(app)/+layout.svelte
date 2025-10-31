<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import '../../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<div class="min-h-screen bg-gray-50">
	<header class="bg-white shadow">
		<div class="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
			<h1 class="text-3xl font-bold text-gray-900">Colombia en Datos</h1>
		</div>
	</header>
	<main class="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
		{@render children?.()}
	</main>
</div>
