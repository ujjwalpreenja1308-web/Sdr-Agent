import type { ApprovalItem } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type ApprovalCardProps = {
  approval: ApprovalItem
  busy: boolean
  onDecision: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>
}

export function ApprovalCard({ approval, busy, onDecision }: ApprovalCardProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <Badge variant={approval.priority === 'high' ? 'warning' : 'outline'} className="mb-1.5">
            {approval.type.replace('_', ' ')}
          </Badge>
          <CardTitle>{approval.title}</CardTitle>
          <CardDescription>{approval.summary}</CardDescription>
        </div>
        <Badge
          variant={
            approval.status === 'approved'
              ? 'success'
              : approval.status === 'rejected'
                ? 'danger'
                : 'outline'
          }
        >
          {approval.status}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="grid gap-2">
          {approval.samples.slice(0, 2).map((sample) => (
            <div key={sample.contact_id} className="rounded-lg border border-border bg-secondary/40 p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <strong className="text-xs font-semibold">{sample.contact_name}</strong>
                <span className="text-[11px] text-muted-foreground">{sample.company}</span>
              </div>
              <p className="mb-0.5 text-xs font-medium">{sample.subject}</p>
              <p className="line-clamp-3 text-xs text-muted-foreground">{sample.body}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            className="flex-1"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onDecision(approval.id, 'rejected')}
            type="button"
          >
            {busy ? 'Working…' : 'Revise'}
          </Button>
          <Button
            className="flex-1"
            size="sm"
            disabled={busy}
            onClick={() => onDecision(approval.id, 'approved')}
            type="button"
          >
            {busy ? 'Working…' : 'Approve'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
