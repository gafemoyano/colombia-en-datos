import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	server: {
		allowedHosts: [
			'felipe-b550.tail28212a.ts.net',
			'.tail28212a.ts.net',
			't-03gt4l98t76dxh5n70zm5j40f-p26097.onamp.dev'
		]
	}
});
