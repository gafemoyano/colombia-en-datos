<script lang="ts">
	import Hero from '$lib/landing/components/Hero.svelte';
	import Icon from '$lib/landing/components/Icon.svelte';
	import IndicatorsCatalog from '$lib/landing/components/IndicatorsCatalog.svelte';
	import MasInfoSection from '$lib/landing/components/MasInfoSection.svelte';
	import NecesidadSection from '$lib/landing/components/NecesidadSection.svelte';
	import QueHacemosSection from '$lib/landing/components/QueHacemosSection.svelte';
	import QuienesSomosSection from '$lib/landing/components/QuienesSomosSection.svelte';

	const currentYear = new Date().getFullYear();
</script>

<div class="min-h-screen bg-gradient-to-b from-white to-slate-50 text-slate-900">
	<header class="sticky top-0 z-40 backdrop-blur bg-white/70 border-b border-slate-200/60">
		<div class="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
			<a href="#inicio" class="flex items-center gap-2 font-semibold">
				<Icon name="sparkles" className="h-5 w-5" ariaHidden="true" />
				<span>Colombia en Datos</span>
			</a>
			<nav class="hidden md:flex gap-6 text-sm">
				<a class="hover:opacity-70" href="#que-hacemos">¿Qué hacemos?</a>
				<a class="hover:opacity-70" href="#necesidad">¿Por qué lo hacemos?</a>
				<a class="hover:opacity-70" href="#quienes-somos">¿Quiénes somos?</a>
				<a class="hover:opacity-70" href="#mas-info">Contáctanos</a>
			</nav>
			<a
				href="/explore"
				class="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-2xl border border-slate-300 hover:bg-slate-100 transition"
			>
				Empezar
				<Icon name="arrow-right" className="h-4 w-4" ariaHidden="true" />
			</a>
		</div>
	</header>

	<main>
		<Hero />
		<QueHacemosSection />
		<IndicatorsCatalog />
		<NecesidadSection />
		<QuienesSomosSection />
		<MasInfoSection />
	</main>

	<footer class="py-10 border-t border-slate-200 bg-white">
		<div class="mx-auto max-w-6xl px-4 grid md:grid-cols-3 gap-6 items-center">
			<p class="text-sm text-slate-500">
				© {currentYear} ColombiaEnDatos. Todos los derechos reservados.
			</p>
			<div class="flex items-center gap-3 text-sm justify-center md:justify-center">
				<Icon name="mail" className="h-4 w-4" ariaHidden="true" /> jortiz.serranoc@gmail.com
				<Icon name="phone" className="h-4 w-4" ariaHidden="true" /> +57 301 143 7017
			</div>
			<div class="flex gap-3 justify-end">
				<a class="text-sm hover:underline" href="/privacidad">Privacidad</a>
				<a class="text-sm hover:underline" href="/terminos">Términos</a>
				<a class="text-sm hover:underline" href="#mas-info">Contacto</a>
			</div>
		</div>
	</footer>
</div>
