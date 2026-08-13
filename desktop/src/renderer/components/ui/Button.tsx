import { clsx } from 'clsx'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
}

export const Button = ({ className, variant = 'primary', style, ...props }: ButtonProps) => (
  <button
    className={clsx(
      'classic-control inline-flex min-h-10 min-w-0 cursor-pointer items-center justify-center border px-4 py-2.5 text-center text-sm font-semibold leading-tight transition-[color,background-color,border-color,box-shadow,transform] duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ff9f30] active:-translate-y-px motion-reduce:transition-none disabled:cursor-not-allowed disabled:opacity-50 disabled:active:translate-y-0',
      variant === 'primary'
        ? 'border-[#ff9f30] bg-[#ff9f30] text-[#0b1623] shadow-[0_2px_12px_rgba(0,0,0,0.16)] hover:border-[#e88f27] hover:bg-[#e88f27] hover:shadow-[0_4px_14px_rgba(0,0,0,0.24)]'
        : 'border-[#41566b] bg-[#0d1b2a] text-[#f0f0f0] hover:border-[#56b5d5]/60 hover:bg-[#142739]',
      className
    )}
    style={style}
    {...props}
  />
)
