import { clsx } from 'clsx'

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost'
}

export const Button = ({ className, variant = 'primary', ...props }: ButtonProps) => (
  <button
    className={clsx(
      'inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-[14px] px-4 py-2.5 text-sm font-semibold transition duration-200 disabled:cursor-not-allowed disabled:opacity-50',
      variant === 'primary'
        ? 'bg-violet-600 text-white shadow-[0_0_32px_rgba(113,50,245,0.34)] hover:bg-violet-500'
        : 'border border-white/10 bg-white/[0.04] text-zinc-200 hover:bg-white/[0.08]',
      className
    )}
    {...props}
  />
)
