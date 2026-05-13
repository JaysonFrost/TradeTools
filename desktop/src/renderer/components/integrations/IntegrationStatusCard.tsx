import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

export type IntegrationStatusCardProps = {
  name: string
  description: string
  status: string
  tone: 'success' | 'warning' | 'danger' | 'purple' | 'neutral'
}

export const IntegrationStatusCard = ({ name, description, status, tone }: IntegrationStatusCardProps) => (
  <Card className="relative min-h-[154px] overflow-hidden">
    <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-500/10 blur-2xl" />
    <div className="relative flex h-full flex-col items-start gap-3">
      <Badge tone={tone}>{status}</Badge>
      <div className="min-w-0">
        <h3 className="m-0 text-base font-semibold">{name}</h3>
        <p className="mt-2 max-w-[46rem] text-sm leading-6 text-zinc-400">{description}</p>
      </div>
    </div>
  </Card>
)
