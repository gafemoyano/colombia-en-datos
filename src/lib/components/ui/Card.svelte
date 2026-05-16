<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cn } from '$lib/utils';

	interface Props extends HTMLAttributes<HTMLDivElement> {}

	let { class: className = '', children, ...rest }: Props = $props();
</script>

<div
	class={cn('rounded-xl border border-slate-200 bg-white text-slate-950 shadow-sm', className)}
	{...rest}
>
	{@render children?.()}
</div>
