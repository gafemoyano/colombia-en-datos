<script lang="ts">
	import Hero from '$lib/landing/components/Hero.svelte';
	import Icon from '$lib/landing/components/Icon.svelte';
	import MasInfoSection from '$lib/landing/components/MasInfoSection.svelte';
	import NecesidadSection from '$lib/landing/components/NecesidadSection.svelte';
	import QueHacemosSection from '$lib/landing/components/QueHacemosSection.svelte';
	import QuienesSomosSection from '$lib/landing/components/QuienesSomosSection.svelte';

	const currentYear = new Date().getFullYear();
</script>

<svelte:head>
	<title>Colombian Datos</title>
	<meta
		name="description"
		content="Indicadores públicos de Colombia calculados, explicados y listos para visualizar, descargar o integrar."
	/>
</svelte:head>

<div class="min-h-screen bg-[var(--c-page)] text-[var(--c-ink)]">
	<header class="sticky top-0 z-40 backdrop-blur bg-white/85 border-b border-[var(--c-border)]">
		<div class="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
			<a
				href="#inicio"
				class="shrink-0 rounded focus-visible:outline-2 focus-visible:outline-offset-4"
			>
				<img
					src="/brand/primary-light.svg"
					alt="Colombian Datos — Inicio"
					width="330"
					height="64"
					class="h-auto w-[180px] lg:w-[206px]"
				/>
			</a>
			<nav class="hidden lg:flex gap-6 text-sm">
				<a class="hover:opacity-70" href="#que-hacemos">¿Qué hacemos?</a>
				<a class="hover:opacity-70" href="#necesidad">¿Por qué lo hacemos?</a>
				<a class="hover:opacity-70" href="#quienes-somos">¿Quiénes somos?</a>
				<a class="hover:opacity-70" href="#mas-info">Contáctanos</a>
			</nav>
			<a
				href="/explore"
				class="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-2xl border border-[var(--c-border)] text-[var(--c-primary)] hover:bg-[var(--c-soft)] transition"
			>
				Empezar
				<Icon name="arrow-right" className="h-4 w-4" ariaHidden="true" />
			</a>
		</div>
	</header>

	<main>
		<Hero />
		<QueHacemosSection />
		<NecesidadSection />
		<QuienesSomosSection />
		<MasInfoSection />
	</main>

	<footer class="py-10 border-t border-slate-200 bg-white">
		<div class="mx-auto max-w-6xl px-4 grid md:grid-cols-3 gap-6 items-center">
			<div>
				<img
					src="/brand/mono-navy.svg"
					alt="Colombian Datos"
					width="330"
					height="64"
					class="mb-3 h-auto w-[180px]"
					loading="lazy"
				/>
				<p class="text-sm text-slate-500">
					© {currentYear} Colombian Datos. Todos los derechos reservados.
				</p>
			</div>
			<div class="flex items-center gap-3 text-sm justify-center md:justify-center">
				<Icon name="mail" className="h-4 w-4" ariaHidden="true" />
				<span>jortiz.serranoc@gmail.com</span>
				<Icon name="message-circle" className="h-4 w-4" ariaHidden="true" />
				<a
					href="https://wa.me/573011437017"
					target="_blank"
					rel="noopener noreferrer"
					class="hover:underline"
				>
					WhatsApp: +57 301 143 7017
				</a>
			</div>
			<div class="flex gap-3 justify-end">
				<a class="text-sm hover:underline" href="/privacidad">Privacidad</a>
				<a class="text-sm hover:underline" href="/terminos">Términos</a>
				<a class="text-sm hover:underline" href="#mas-info">Contacto</a>
			</div>
		</div>
	</footer>
</div>
