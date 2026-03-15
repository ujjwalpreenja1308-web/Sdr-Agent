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
    <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-4 overflow-hidden">
      <Card className="shadow-none">
        <CardHeader>
          <div>
            <Badge variant="outline" className="mb-2">
              Reply inbox
            </Badge>
            <CardTitle>Human-in-the-loop reply handling</CardTitle>
            <CardDescription>
              Interested and objection replies land here with a drafted response before anything is
              sent.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {replies.length > 0 ? (
            replies.map((reply) => (
              <div key={reply.id} className="rounded-2xl border border-border bg-secondary/25 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{reply.contact_name}</p>
                    <p className="text-sm text-muted-foreground">{reply.company}</p>
                  </div>
                  <div className="flex items-center gap-2">
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

                <p className="text-sm text-muted-foreground">{reply.summary}</p>
                <div className="mt-3 rounded-xl border border-border bg-background p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Draft reply
                  </p>
                  <p className="text-sm">{reply.draft_reply}</p>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={busyReplyId === reply.id}
                    onClick={() => void onDecision(reply.id, 'dismissed')}
                    type="button"
                    variant="outline"
                  >
                    {busyReplyId === reply.id ? 'Working...' : 'Dismiss'}
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={busyReplyId === reply.id}
                    onClick={() => void onDecision(reply.id, 'approved')}
                    type="button"
                  >
                    {busyReplyId === reply.id ? 'Working...' : 'Approve + send'}
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
              Replies appear only after Instantly sends webhook events into PipeIQ.
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid h-full grid-rows-[0.9fr_1.1fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Webhook status</CardTitle>
              <CardDescription>
                This route receives live reply events from Instantly and replaces the old seeded reply loop.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-xl border border-border bg-secondary/20 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Target URL
              </p>
              <p className="text-sm">{webhook.target_url || webhookTargetUrl}</p>
            </div>
            <div className="flex items-center justify-between">
              <Badge variant={webhook.configured ? 'success' : 'warning'}>
                {webhook.configured ? 'Registered' : 'Not registered'}
              </Badge>
              <Button disabled={registeringWebhook} onClick={() => void onRegisterWebhook()} type="button" variant="outline">
                {registeringWebhook ? 'Registering...' : 'Register webhook'}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {webhook.secret_configured
                ? 'Inbound webhook requests are protected with a custom header secret.'
                : 'Set PIPEIQ_INSTANTLY_WEBHOOK_SECRET before exposing this route publicly.'}
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Reply metrics</CardTitle>
              <CardDescription>Fast triage matters more than volume once replies start.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <MetricTile label="Queue size" value={String(replies.length)} />
            <MetricTile
              label="Interested"
              value={String(replies.filter((reply) => reply.classification === 'INTERESTED').length)}
            />
            <MetricTile
              label="Pending"
              value={String(replies.filter((reply) => reply.status === 'pending').length)}
            />
            <MetricTile
              label="Sent"
              value={String(replies.filter((reply) => reply.status === 'sent').length)}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}
