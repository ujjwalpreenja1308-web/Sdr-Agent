import type { InstantlyWebhookSubscription, ReplyQueueItem } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type RepliesPanelProps = {
  busyReplyId: string | null
  registeringWebhook: boolean
  replies: ReplyQueueItem[]
  webhook: InstantlyWebhookSubscription
  webhookTargetUrl: string
  onDecision: (replyId: string, decision: 'approved' | 'dismissed') => Promise<void>
  onRegisterWebhook: () => Promise<void>
}

export function RepliesPanel({
  busyReplyId,
  registeringWebhook,
  replies,
  webhook,
  webhookTargetUrl,
  onDecision,
  onRegisterWebhook,
}: RepliesPanelProps) {
  return (
    <div className="grid h-full grid-cols-[1fr_260px] gap-4 overflow-hidden">
      {/* Reply list */}
      <Card className="flex h-full flex-col overflow-hidden">
        <CardHeader>
          <CardTitle>Reply inbox</CardTitle>
          <CardDescription>Approve or dismiss before anything is sent.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pt-0">
          {replies.length > 0 ? (
            replies.map((reply) => (
              <div key={reply.id} className="rounded-lg border border-border bg-secondary/10 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{reply.contact_name}</p>
                    <p className="text-xs text-muted-foreground">{reply.company}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline">{reply.classification.replace('_', ' ')}</Badge>
                    <Badge
                      variant={
                        reply.status === 'sent'
                          ? 'success'
                          : reply.status === 'dismissed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {reply.status}
                    </Badge>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">{reply.summary}</p>
                <div className="mt-2 rounded-md border border-border bg-background px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Draft reply
                  </p>
                  <p className="text-xs">{reply.draft_reply}</p>
                </div>

                <div className="mt-3 flex gap-2">
                  <Button
                    className="flex-1"
                    size="sm"
                    disabled={busyReplyId === reply.id}
                    onClick={() => void onDecision(reply.id, 'dismissed')}
                    type="button"
                    variant="outline"
                  >
                    {busyReplyId === reply.id ? 'Working…' : 'Dismiss'}
                  </Button>
                  <Button
                    className="flex-1"
                    size="sm"
                    disabled={busyReplyId === reply.id}
                    onClick={() => void onDecision(reply.id, 'approved')}
                    type="button"
                  >
                    {busyReplyId === reply.id ? 'Working…' : 'Approve + send'}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-xs text-muted-foreground">
              Replies appear after Instantly sends webhook events into PipeIQ.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right panel */}
      <div className="flex flex-col gap-4 overflow-y-auto">
        {/* Webhook */}
        <Card>
          <CardHeader>
            <CardTitle>Webhook</CardTitle>
            <CardDescription>Receives live reply events from Instantly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Target URL</p>
              <p className="text-xs font-mono break-all">{webhook.target_url || webhookTargetUrl}</p>
            </div>
            <div className="flex items-center justify-between">
              <Badge variant={webhook.configured ? 'success' : 'warning'}>
                {webhook.configured ? 'Registered' : 'Not registered'}
              </Badge>
              <Button size="sm" disabled={registeringWebhook} onClick={() => void onRegisterWebhook()} type="button" variant="outline">
                {registeringWebhook ? 'Registering…' : 'Register'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {webhook.secret_configured
                ? 'Protected with a custom header secret.'
                : 'Set PIPEIQ_INSTANTLY_WEBHOOK_SECRET before exposing publicly.'}
            </p>
          </CardContent>
        </Card>

        {/* Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>Reply metrics</CardTitle>
            <CardDescription>Queue snapshot.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-0">
            <MetricTile label="Queue" value={String(replies.length)} />
            <MetricTile
              label="Interested"
              value={String(replies.filter((r) => r.classification === 'INTERESTED').length)}
            />
            <MetricTile
              label="Pending"
              value={String(replies.filter((r) => r.status === 'pending').length)}
            />
            <MetricTile
              label="Sent"
              value={String(replies.filter((r) => r.status === 'sent').length)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}
