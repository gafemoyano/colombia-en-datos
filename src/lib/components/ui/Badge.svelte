<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { cva, type VariantProps } from 'class-variance-authority';
	import { cn } from '$lib/utils';

	const badgeVariants = cva(
		'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors',
		{
			variants: {
				variant: {
					default: 'border-transparent bg-slate-950 text-white',
					secondary: 'border-transparent bg-slate-100 text-slate-900',
					destructive: 'border-transparent bg-red-100 text-red-700',
					warning: 'border-transparent bg-amber-100 text-amber-800',
					success: 'border-transparent bg-emerald-100 text-emerald-700',
					outline: 'text-slate-950'
				}
			},
			defaultVariants: {
				variant: 'default'
			}
		}
	);

	interface Props extends HTMLAttributes<HTMLSpanElement> {
		variant?: VariantProps<typeof badgeVariants>['variant'];
	}

	let { class: className = '', variant = 'default', children, ...rest }: Props = $props();
</script>

<span class={cn(badgeVariants({ variant }), className)} {...rest}>
	{@render children?.()}
</span>
