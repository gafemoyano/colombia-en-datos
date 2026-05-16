<script lang="ts">
	import { Separator as SeparatorPrimitive } from 'bits-ui';
	import type { Separator as SeparatorPrimitiveType } from 'bits-ui';
	import { cn } from '$lib/utils';

	interface Props extends SeparatorPrimitiveType.RootProps {}

	let { class: className = '', orientation = 'horizontal', ...rest }: Props = $props();
</script>

<SeparatorPrimitive.Root
	class={cn(
		'shrink-0 bg-slate-200',
		orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px',
		className
	)}
	{orientation}
	{...rest}
/>
