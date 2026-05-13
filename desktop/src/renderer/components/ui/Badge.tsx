import { clsx } from 'clsx'

const toneClasses = {
  success: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  warning: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  danger: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  purple: 'border-violet-400/30 bg-violet-400/10 text-violet-200',
  neutral: 'border-white/10 bg-white/[0.04] text-zinc-300'
}

export type BadgeProps = {
  children: React.ReactNode
  tone?: keyof typeof toneClasses
}

export const Badge = ({ children, tone = 'neutral' }: BadgeProps) => (
  <span className={clsx('inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium', toneClasses[tone])}>
    {children}
  </span>
)
