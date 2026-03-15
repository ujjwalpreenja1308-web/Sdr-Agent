import { useState } from 'react'
import { AlertTriangle, CheckCircle2, Play, Rocket } from 'lucide-react'

import type {
  ConnectionTarget,
  LaunchReadiness,
  PipelineSnapshot,
} from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type LaunchControlRoomProps = {
  busyToolkit: string | null
  generating: boolean
  launching: boolean
  pipeline: PipelineSnapshot
  readiness: LaunchReadiness
  requiredConnections: ConnectionTarget[]
  onAuthorize: (toolkit: string) => Promise<void>
  onGenerate: () => Promise<void>
  onSaveApiKey: (toolkit: string, label: string, secretHint: string) => Promise<void>
  onStageLaunch: () => Promise<void>
}

export function LaunchControlRoom({
  busyToolkit,
  generating,
  launching,
  pipeline,
  readiness,
  requiredConnections,
  onAuthorize,
  onGenerate,
  onSaveApiKey,
  onStageLaunch,
}: LaunchControlRoomProps) {
  const batchReady = readiness.checklist.some(
    (item) => item.id === 'batch' && item.status === 'complete',
  )

  return (
    <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-4 overflow-hidden">
      <div className="grid h-full grid-rows-[0.92fr_1.08fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <Badge variant="outline" className="mb-2">
                Launch control
              </Badge>
              <CardTitle>Guide the first campaign into Instantly</CardTitle>
              <CardDescription>{readiness.next_action}</CardDescription>
            </div>
            <Badge
              variant={
                readiness.stage === 'staged'
                  ? 'success'
                  : readiness.ready_to_launch
                    ? 'success'
                    : 'warning'
              }
            >
              {readiness.stage === 'staged'
                ? 'Campaign staged'
                : readiness.ready_to_launch
                  ? 'Ready to launch'
                  : `${readiness.progress}% complete`}
            </Badge>
          </CardHeader>
          <CardContent className="grid h-[calc(100%-92px)] grid-cols-[0.95fr_1.05fr] gap-4">
            <div className="space-y-3">
              <MetricTile label="Launch progress" value={`${readiness.progress}%`} />
              <MetricTile label="Contacts ready" value={String(readiness.contacts_ready)} />
              <MetricTile label="Pending approvals" value={String(readiness.pending_approvals)} />
            </div>

            <div className="flex h-full flex-col justify-between rounded-2xl border border-border bg-secondary/30 p-4">
              <div className="space-y-3">
                {readiness.blockers.length > 0 ? (
                  readiness.blockers.map((blocker) => (
                    <div key={blocker} className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-700" />
                      <p className="text-sm text-amber-800">{blocker}</p>
                    </div>
                  ))
                ) : (
                  <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-700" />
                    <p className="text-sm text-emerald-800">
                      All blockers are cleared. The campaign can be staged now.
                    </p>
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={generating}
                  onClick={() => void onGenerate()}
                  type="button"
                >
                  <Play className="mr-2 h-4 w-4" />
                  {generating ? 'Generating...' : 'Generate batch'}
                </Button>
                <Button
                  disabled={!readiness.ready_to_launch || launching || readiness.stage === 'staged'}
                  onClick={() => void onStageLaunch()}
                  type="button"
                >
                  <Rocket className="mr-2 h-4 w-4" />
                  {readiness.stage === 'staged'
                    ? 'Staged'
                    : launching
                      ? 'Staging...'
                      : 'Stage campaign'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Checklist</CardTitle>
              <CardDescription>The minimum path from setup to first launch.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {readiness.checklist.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-xl border border-border p-4">
                <div
                  className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${
                    item.status === 'complete'
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-sm text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid h-full grid-rows-[1.08fr_0.92fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Connection sequence</CardTitle>
              <CardDescription>
                Apollo, Hunter, and Instantly are the hard launch dependencies. Gmail is recommended
                next for reply workflows.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid h-[calc(100%-92px)] grid-cols-2 gap-4">
            {requiredConnections.map((connection) => (
              <CompactConnectionCard
                key={connection.toolkit}
                busy={busyToolkit === connection.toolkit}
                connection={connection}
                onAuthorize={onAuthorize}
                onSaveApiKey={onSaveApiKey}
              />
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Generated contacts</CardTitle>
              <CardDescription>The first batch that will move into approval and launch.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {batchReady ? (
              pipeline.contacts.slice(0, 3).map((contact) => (
                <div key={contact.id} className="rounded-xl border border-border bg-secondary/30 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{contact.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {contact.title} at {contact.company}
                      </p>
                    </div>
                    <Badge
                      variant={
                        contact.status === 'approved_to_launch'
                          ? 'success'
                          : contact.status === 'revision_requested'
                            ? 'danger'
                            : 'outline'
                      }
                    >
                      {contact.status.replaceAll('_', ' ')}
                    </Badge>
                  </div>
                  <p className="text-sm font-medium">{contact.subject}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{contact.body_preview}</p>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-6">
                <p className="text-sm font-medium">No generated batch yet</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Run Apollo prospecting first, then generate the personalized batch to populate
                  this launch queue.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}

function CompactConnectionCard({
  busy,
  connection,
  onAuthorize,
  onSaveApiKey,
}: {
  busy: boolean
  connection: ConnectionTarget
  onAuthorize: (toolkit: string) => Promise<void>
  onSaveApiKey: (toolkit: string, label: string, secretHint: string) => Promise<void>
}) {
  const [secretHint, setSecretHint] = useState('')

  return (
    <div className="flex h-full flex-col rounded-2xl border border-border bg-secondary/25 p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{connection.label}</p>
          <p className="text-sm text-muted-foreground">{connection.required_for_phase}</p>
        </div>
        <Badge
          variant={
            connection.status === 'connected'
              ? 'success'
              : connection.status === 'pending'
                ? 'warning'
                : 'outline'
          }
        >
          {connection.status.replace('_', ' ')}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">{connection.description}</p>
      <div className="mt-auto pt-4">
        {connection.mode === 'oauth' ? (
          <Button
            className="w-full"
            disabled={busy}
            onClick={() => void onAuthorize(connection.toolkit)}
            type="button"
            variant="outline"
          >
            {busy ? 'Launching...' : connection.status === 'connected' ? 'Reconnect' : 'Authorize'}
          </Button>
        ) : (
          <div className="grid gap-2">
            <Input
              placeholder="Masked key or account note"
              value={secretHint}
              onChange={(event) => setSecretHint(event.target.value)}
            />
            <Button
              className="w-full"
              disabled={busy || (!secretHint.trim() && connection.status !== 'connected')}
              onClick={() =>
                void onSaveApiKey(
                  connection.toolkit,
                  connection.label,
                  secretHint.trim() || `${connection.label} connected`,
                )
              }
              type="button"
              variant={connection.status === 'connected' ? 'outline' : 'default'}
            >
              {busy ? 'Saving...' : connection.status === 'connected' ? 'Update note' : `Connect ${connection.label}`}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
