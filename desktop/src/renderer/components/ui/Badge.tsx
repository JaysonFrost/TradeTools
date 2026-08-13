import { clsx } from 'clsx'

const toneClasses = {
  success: 'border-[#00ff9d]/40 bg-[#00ff9d]/[0.08] text-[#8fffd1]',
  warning: 'border-[#ff9f30]/45 bg-[#ff9f30]/10 text-[#ffc27a]',
  danger: 'border-[#ff667d]/40 bg-[#ff667d]/10 text-[#ff9aaa]',
  purple: 'border-[#56b5d5]/40 bg-[#56b5d5]/[0.08] text-[#9ae6ff]',
  neutral: 'border-[#41566b] bg-[#0b1623] text-[#b7c4d2]'
}

export type BadgeProps = {
  children: React.ReactNode
  tone?: keyof typeof toneClasses
}

export const Badge = ({ children, tone = 'neutral' }: BadgeProps) => (
  <span className={clsx('classic-control inline-flex items-center whitespace-nowrap border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em]', toneClasses[tone])}>
    {children}
  </span>
)
