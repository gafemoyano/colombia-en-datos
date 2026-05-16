import { cva, type VariantProps } from 'class-variance-authority';

export const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-950 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				default: 'bg-slate-950 text-white hover:bg-slate-900',
				destructive: 'bg-red-600 text-white hover:bg-red-700',
				outline: 'border border-slate-200 bg-white hover:bg-slate-100 hover:text-slate-900',
				secondary: 'bg-slate-100 text-slate-900 hover:bg-slate-200',
				ghost: 'hover:bg-slate-100 hover:text-slate-900',
				link: 'text-slate-950 underline-offset-4 hover:underline'
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-9 rounded-md px-3',
				lg: 'h-11 rounded-md px-8',
				icon: 'h-10 w-10'
			}
		},
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	}
);

export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
export type ButtonSize = VariantProps<typeof buttonVariants>['size'];
