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
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div>
          <Badge variant={approval.priority === 'high' ? 'warning' : 'outline'} className="mb-2">
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
      <CardContent className="flex h-[calc(100%-92px)] flex-col gap-4">
        <div className="grid gap-3">
          {approval.samples.slice(0, 2).map((sample) => (
            <div key={sample.contact_id} className="rounded-xl border border-border bg-secondary/60 p-3">
              <div className="mb-1 flex items-center justify-between gap-3">
                <strong className="text-sm">{sample.contact_name}</strong>
                <span className="text-xs text-muted-foreground">{sample.company}</span>
              </div>
              <p className="mb-1 text-sm font-medium">{sample.subject}</p>
              <p className="line-clamp-3 text-sm text-muted-foreground">{sample.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-auto flex gap-2">
          <Button
            className="flex-1"
            variant="outline"
            disabled={busy}
            onClick={() => onDecision(approval.id, 'rejected')}
            type="button"
          >
            {busy ? 'Working...' : 'Request revision'}
          </Button>
          <Button
            className="flex-1"
            disabled={busy}
            onClick={() => onDecision(approval.id, 'approved')}
            type="button"
          >
            {busy ? 'Working...' : 'Approve'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
