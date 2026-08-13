import { clsx } from 'clsx'

export type CardProps = React.HTMLAttributes<HTMLDivElement>

export const Card = ({ className, style, ...props }: CardProps) => (
  <div
    className={clsx('classic-rounded border border-[#294155] bg-[#102131] p-5 shadow-[0_2px_12px_rgba(0,0,0,0.18)]', className)}
    style={style}
    {...props}
  />
)
