import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

export type IntegrationStatusCardProps = {
  name: string
  description: string
  status: string
  tone: 'success' | 'warning' | 'danger' | 'purple' | 'neutral'
}

export const IntegrationStatusCard = ({ name, description, status, tone }: IntegrationStatusCardProps) => (
  <Card className="relative overflow-hidden">
    <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-violet-500/10 blur-2xl" />
    <div className="flex items-start justify-between gap-4">
      <div>
        <h3 className="m-0 text-base font-semibold">{name}</h3>
        <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  </Card>
)
