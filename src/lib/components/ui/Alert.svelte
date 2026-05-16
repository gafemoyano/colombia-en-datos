<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	interface Props extends HTMLAttributes<HTMLDivElement> {
		variant?: 'default' | 'success' | 'destructive';
	}

	let { class: className = '', variant = 'default', children, ...rest }: Props = $props();

	const variants = {
		default: 'border-slate-200 bg-white text-slate-950',
		success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
		destructive: 'border-red-200 bg-red-50 text-red-900'
	};
</script>

<div
	class={cn('relative w-full rounded-lg border p-4 text-sm', variants[variant], className)}
	{...rest}
>
	{@render children?.()}
</div>
