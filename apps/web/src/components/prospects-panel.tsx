import { Link2, Orbit, Search, ShieldCheck } from 'lucide-react'

import type { ConnectionTarget, PipelineSnapshot, ProspectRunSummary } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type ProspectsPanelProps = {
  hunterConnection: ConnectionTarget | undefined
  pipeline: PipelineSnapshot
  prospectRun: ProspectRunSummary
  running: boolean
  verifying: boolean
  onConnectHunter: () => Promise<void>
  onRun: () => Promise<void>
  onVerify: () => Promise<void>
}

export function ProspectsPanel({
  hunterConnection,
  pipeline,
  prospectRun,
  running,
  verifying,
  onConnectHunter,
  onRun,
  onVerify,
}: ProspectsPanelProps) {
  const verificationCounts = pipeline.contacts.reduce(
    (accumulator, contact) => {
      accumulator[contact.email_verification_status] += 1
      return accumulator
    },
    { unverified: 0, valid: 0, risky: 0, invalid: 0 },
  )

  return (
    <div className="grid h-full grid-cols-[1fr_280px] gap-4 overflow-hidden">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pr-1">
        {/* Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Prospect sourcing</CardTitle>
            <CardDescription>Run Apollo search, then verify deliverability with Hunter.</CardDescription>
            <Badge variant={prospectRun.status === 'completed' ? 'success' : 'warning'}>
              {prospectRun.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <div className="grid grid-cols-3 gap-3">
              <MetricTile label="Sourced" value={String(prospectRun.sourced_count)} />
              <MetricTile label="Verified" value={String(verificationCounts.valid + verificationCounts.risky)} />
              <MetricTile label="Invalid" value={String(verificationCounts.invalid)} />
            </div>

            <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2.5">
              <p className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Run note</p>
              <p className="text-xs">{prospectRun.note}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={running} onClick={() => void onRun()} type="button">
                <Search className="h-3.5 w-3.5" />
                {running ? 'Running Apollo…' : 'Run prospect search'}
              </Button>
              {hunterConnection?.status === 'connected' ? (
                <Button
                  size="sm"
                  disabled={verifying || pipeline.contacts.length === 0}
                  onClick={() => void onVerify()}
                  type="button"
                  variant="outline"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {verifying ? 'Verifying…' : 'Verify emails'}
                </Button>
              ) : (
                <Button size="sm" onClick={() => void onConnectHunter()} type="button" variant="outline">
                  <Link2 className="h-3.5 w-3.5" />
                  Connect Hunter
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Contact list */}
        <Card>
          <CardHeader>
            <CardTitle>Sourced contacts</CardTitle>
            <CardDescription>Verification status gates the personalization batch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            {pipeline.contacts.length > 0 ? (
              pipeline.contacts.slice(0, 8).map((contact) => (
                <div key={contact.id} className="rounded-lg border border-border bg-secondary/10 px-3 py-2.5">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{contact.full_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {contact.title} · {contact.company}
                      </p>
                      <p className="text-xs text-muted-foreground">{contact.email}</p>
                    </div>
                    <Badge variant={verificationVariant(contact.email_verification_status)}>
                      {contact.email_verification_status}
                    </Badge>
                  </div>
                  {(contact.email_verification_note || contact.signal_detail) ? (
                    <p className="text-xs text-muted-foreground">
                      {contact.email_verification_note || contact.signal_detail}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                Run Apollo prospecting to populate the first set of contacts.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Workflow guide */}
      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>How it works</CardTitle>
          <CardDescription>Verification gates which contacts get personalized.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <WorkflowRow
            icon={Search}
            title="Search"
            description="Apollo people search via Composio using your ICP filters."
          />
          <WorkflowRow
            icon={ShieldCheck}
            title="Verify"
            description="Hunter classifies each email as valid, risky, or invalid."
          />
          <WorkflowRow
            icon={Orbit}
            title="Hand off"
            description="Valid and risky contacts move into the personalized batch."
          />
        </CardContent>
      </Card>
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

function WorkflowRow({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: typeof Search
  title: string
}) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-border bg-secondary/10 p-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  )
}

function verificationVariant(status: 'unverified' | 'valid' | 'risky' | 'invalid') {
  if (status === 'valid') {
    return 'success'
  }
  if (status === 'risky') {
    return 'warning'
  }
  if (status === 'invalid') {
    return 'danger'
  }
  return 'outline'
}
