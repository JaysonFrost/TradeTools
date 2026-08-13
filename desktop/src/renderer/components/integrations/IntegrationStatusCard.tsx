import { Badge } from '../ui/Badge'
import { Card } from '../ui/Card'

export type IntegrationStatusCardProps = {
  name: string
  description: string
  status: string
  tone: 'success' | 'warning' | 'danger' | 'purple' | 'neutral'
}

export const IntegrationStatusCard = ({ name, description, status, tone }: IntegrationStatusCardProps) => (
  <Card className="min-h-[154px] rounded-none border-[#1c2b3a] bg-[#0b1623] p-0 shadow-none backdrop-blur-none">
    <div className="flex h-full min-h-[152px] border-l-2 border-cyan-400/50">
      <div className="flex min-w-0 flex-1 flex-col items-start gap-3 p-4 font-mono sm:p-5">
        <Badge tone={tone}>{status}</Badge>
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-[0.08em] text-[#f0f0f0]">{name}</h3>
          <p className="mt-2 max-w-[46rem] text-sm leading-6 text-[#8b9bb4]">{description}</p>
        </div>
      </div>
    </div>
  </Card>
)
