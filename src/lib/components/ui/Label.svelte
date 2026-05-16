<script lang="ts">
	import { Label as LabelPrimitive } from 'bits-ui';
	import type { Label as LabelPrimitiveType } from 'bits-ui';
	import { cn } from '$lib/utils';

	interface Props extends LabelPrimitiveType.RootProps {}

	let { class: className = '', children, ...rest }: Props = $props();
</script>

<LabelPrimitive.Root
	class={cn(
		'text-sm font-medium leading-none text-slate-700 peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
		className
	)}
	{...rest}
>
	{@render children?.()}
</LabelPrimitive.Root>
