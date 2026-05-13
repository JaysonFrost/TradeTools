import { clsx } from 'clsx'

export type CardProps = React.HTMLAttributes<HTMLDivElement>

export const Card = ({ className, ...props }: CardProps) => (
  <div className={clsx('glass-panel rounded-[24px] p-5', className)} {...props} />
)
