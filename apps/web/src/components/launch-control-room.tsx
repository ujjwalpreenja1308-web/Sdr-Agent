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
  onSaveApiKey: (toolkit: string, label: string, apiKey: string) => Promise<void>
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
    <div className="grid h-full grid-cols-[1fr_260px] gap-4 overflow-hidden">
      {/* Left: main controls */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {/* Launch card */}
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Launch campaign</CardTitle>
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
                ? 'Staged'
                : readiness.ready_to_launch
                  ? 'Ready'
                  : `${readiness.progress}%`}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid grid-cols-3 gap-3">
              <MetricTile label="Progress" value={`${readiness.progress}%`} />
              <MetricTile label="Contacts ready" value={String(readiness.contacts_ready)} />
              <MetricTile label="Pending approvals" value={String(readiness.pending_approvals)} />
            </div>

            <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
              {readiness.blockers.length > 0 ? (
                readiness.blockers.map((blocker) => (
                  <div key={blocker} className="flex gap-2 rounded-md border border-warning-text/20 bg-warning-subtle px-3 py-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text" />
                    <p className="text-xs text-warning-text">{blocker}</p>
                  </div>
                ))
              ) : (
                <div className="flex gap-2 rounded-md border border-success-text/20 bg-success-subtle px-3 py-2">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-text" />
                  <p className="text-xs text-success-text">All blockers cleared. Campaign is ready to stage.</p>
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={generating}
                onClick={() => void onGenerate()}
                type="button"
              >
                <Play className="h-3.5 w-3.5" />
                {generating ? 'Generating…' : 'Generate batch'}
              </Button>
              <Button
                size="sm"
                disabled={!readiness.ready_to_launch || launching || readiness.stage === 'staged'}
                onClick={() => void onStageLaunch()}
                type="button"
              >
                <Rocket className="h-3.5 w-3.5" />
                {readiness.stage === 'staged' ? 'Staged' : launching ? 'Staging…' : 'Stage campaign'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Checklist */}
        <Card>
          <CardHeader>
            <CardTitle>Launch checklist</CardTitle>
            <CardDescription>Minimum path from setup to first send.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {readiness.checklist.map((item) => (
              <div key={item.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-secondary/10 p-3">
                <div
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    item.status === 'complete'
                      ? 'bg-success-subtle text-success-text'
                      : 'bg-secondary text-muted-foreground'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-xs font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.detail}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Generated contacts */}
        <Card>
          <CardHeader>
            <CardTitle>Generated contacts</CardTitle>
            <CardDescription>First batch for approval and launch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {batchReady ? (
              pipeline.contacts.slice(0, 4).map((contact) => (
                <div key={contact.id} className="rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{contact.full_name}</p>
                      <p className="text-xs text-muted-foreground">{contact.title} · {contact.company}</p>
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
                  <p className="text-xs font-medium">{contact.subject}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{contact.body_preview}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4">
                <p className="text-sm font-medium">No batch yet</p>
                <p className="mt-0.5 text-xs text-muted-foreground">Run Apollo prospecting first, then generate the personalized batch.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Right: connections */}
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <Card>
          <CardHeader>
            <CardTitle>Required tools</CardTitle>
            <CardDescription>Hard dependencies for launch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
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
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
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
  onSaveApiKey: (toolkit: string, label: string, apiKey: string) => Promise<void>
}) {
  const [apiKey, setApiKey] = useState('')

  return (
    <div className="rounded-lg border border-border bg-secondary/10 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{connection.label}</p>
          <p className="text-xs text-muted-foreground">{connection.required_for_phase}</p>
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

      <p className="mb-2 text-xs text-muted-foreground">{connection.description}</p>

      {connection.mode === 'oauth' ? (
        <Button
          className="w-full"
          size="sm"
          disabled={busy}
          onClick={() => void onAuthorize(connection.toolkit)}
          type="button"
          variant="outline"
        >
          {busy ? 'Launching…' : connection.status === 'connected' ? 'Reconnect' : 'Authorize'}
        </Button>
      ) : (
        <div className="grid gap-2">
          <Input
            placeholder={connection.status === 'connected' ? 'Paste a new API key to rotate' : 'Paste API key'}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <Button
            className="w-full"
            size="sm"
            disabled={busy || !apiKey.trim()}
            onClick={() =>
              void onSaveApiKey(
                connection.toolkit,
                connection.label,
                apiKey.trim(),
              )
            }
            type="button"
            variant={connection.status === 'connected' ? 'outline' : 'default'}
          >
            {busy ? 'Saving…' : connection.status === 'connected' ? 'Update' : `Connect ${connection.label}`}
          </Button>
        </div>
      )}
    </div>
  )
}
