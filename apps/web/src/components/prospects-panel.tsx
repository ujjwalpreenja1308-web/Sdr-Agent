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
    <div className="grid h-full grid-cols-[0.95fr_1.05fr] gap-4 overflow-hidden">
      <div className="grid h-full grid-rows-[0.88fr_1.12fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <Badge variant="outline" className="mb-2">
                Apollo + Hunter
              </Badge>
              <CardTitle>Source prospects, then verify deliverability</CardTitle>
              <CardDescription>
                Prospecting and verification are now separate pre-launch steps before any batch gets
                personalized.
              </CardDescription>
            </div>
            <Badge variant={prospectRun.status === 'completed' ? 'success' : 'warning'}>
              {prospectRun.status}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <MetricTile label="Sourced" value={String(prospectRun.sourced_count)} />
              <MetricTile label="Verified" value={String(verificationCounts.valid + verificationCounts.risky)} />
              <MetricTile label="Invalid" value={String(verificationCounts.invalid)} />
            </div>

            <div className="rounded-xl border border-border bg-secondary/20 p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Run note
              </p>
              <p className="text-sm">{prospectRun.note}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={running} onClick={() => void onRun()} type="button">
                <Search className="mr-2 h-4 w-4" />
                {running ? 'Running Apollo...' : 'Run prospect search'}
              </Button>
              {hunterConnection?.status === 'connected' ? (
                <Button
                  disabled={verifying || pipeline.contacts.length === 0}
                  onClick={() => void onVerify()}
                  type="button"
                  variant="outline"
                >
                  <ShieldCheck className="mr-2 h-4 w-4" />
                  {verifying ? 'Verifying emails...' : 'Verify emails'}
                </Button>
              ) : (
                <Button onClick={() => void onConnectHunter()} type="button" variant="outline">
                  <Link2 className="mr-2 h-4 w-4" />
                  Connect Hunter
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Sourced contacts</CardTitle>
              <CardDescription>Verification badges are the gate before personalization.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {pipeline.contacts.length > 0 ? (
              pipeline.contacts.slice(0, 5).map((contact) => (
                <div key={contact.id} className="rounded-xl border border-border bg-secondary/20 p-4">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{contact.full_name}</p>
                      <p className="text-sm text-muted-foreground">
                        {contact.title} at {contact.company}
                      </p>
                      <p className="text-sm text-muted-foreground">{contact.email}</p>
                    </div>
                    <Badge variant={verificationVariant(contact.email_verification_status)}>
                      {contact.email_verification_status}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {contact.email_verification_note || contact.signal_detail}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                Run Apollo prospecting to populate the first set of contacts.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <div>
            <CardTitle>How the verification slice behaves</CardTitle>
            <CardDescription>
              Hunter now decides which emails can move into the personalized batch.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <WorkflowRow
            icon={Search}
            title="Search"
            description="PipeIQ calls Apollo people search and enrichment using the saved ICP filters."
          />
          <WorkflowRow
            icon={ShieldCheck}
            title="Verify"
            description="Hunter runs through Composio and classifies each sourced email as valid, risky, or invalid."
          />
          <WorkflowRow
            icon={Orbit}
            title="Hand off"
            description="Only verified or risky contacts move into the first personalized batch and later launch approvals."
          />
        </CardContent>
      </Card>
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
    <div className="flex gap-3 rounded-xl border border-border p-4">
      <div className="mt-0.5 rounded-lg bg-secondary p-2">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
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
