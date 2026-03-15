import { Cable, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ConnectionTarget, IntegrationCheckResult } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type IntegrationsPanelProps = {
  busyToolkit: string | null
  connections: ConnectionTarget[]
  diagnostics: Record<string, IntegrationCheckResult | undefined>
  onAuthorize: (toolkit: string) => Promise<void>
  onCheck: (toolkit: string) => Promise<void>
}

export function IntegrationsPanel({
  busyToolkit,
  connections,
  diagnostics,
  onAuthorize,
  onCheck,
}: IntegrationsPanelProps) {
  const required = connections.filter((connection) => connection.category === 'required')
  const optional = connections.filter((connection) => connection.category === 'optional')

  return (
    <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-4 overflow-hidden">
      <div className="grid h-full grid-rows-[0.9fr_1.1fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <Badge variant="outline" className="mb-2">
                Integrations
              </Badge>
              <CardTitle>Composio operator layer</CardTitle>
              <CardDescription>
                Every customer-facing tool should connect and execute through the same operator
                backend.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-3 gap-3">
            <MetricTile
              label="Required"
              value={String(required.length)}
              icon={<Cable className="h-4 w-4 text-muted-foreground" />}
            />
            <MetricTile
              label="Connected"
              value={String(connections.filter((connection) => connection.status === 'connected').length)}
              icon={<CheckCircle2 className="h-4 w-4 text-muted-foreground" />}
            />
            <MetricTile
              label="Checked"
              value={String(Object.values(diagnostics).filter(Boolean).length)}
              icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
            />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Required toolchain</CardTitle>
              <CardDescription>
                Apollo, Hunter, and Instantly are the hard dependencies for an autonomous SDR loop.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {required.map((connection) => (
              <IntegrationRow
                key={connection.toolkit}
                busy={busyToolkit === connection.toolkit}
                connection={connection}
                diagnostic={diagnostics[connection.toolkit]}
                onAuthorize={onAuthorize}
                onCheck={onCheck}
              />
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <div>
            <CardTitle>Optional surfaces</CardTitle>
            <CardDescription>
              Inbox, scheduling, and CRM sync should also be validated through Composio before they
              are trusted for autonomous actions.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {optional.map((connection) => (
            <IntegrationRow
              key={connection.toolkit}
              busy={busyToolkit === connection.toolkit}
              connection={connection}
              diagnostic={diagnostics[connection.toolkit]}
              onAuthorize={onAuthorize}
              onCheck={onCheck}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function IntegrationRow({
  busy,
  connection,
  diagnostic,
  onAuthorize,
  onCheck,
}: {
  busy: boolean
  connection: ConnectionTarget
  diagnostic?: IntegrationCheckResult
  onAuthorize: (toolkit: string) => Promise<void>
  onCheck: (toolkit: string) => Promise<void>
}) {
  return (
    <div className="rounded-2xl border border-border bg-secondary/20 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-medium">{connection.label}</p>
          <p className="text-sm text-muted-foreground">{connection.required_for_phase}</p>
        </div>
        <Badge variant={statusVariant(connection.status)}>
          {connection.status.replaceAll('_', ' ')}
        </Badge>
      </div>

      <p className="text-sm text-muted-foreground">{connection.description}</p>

      {diagnostic ? (
        <div className="mt-3 rounded-xl border border-border bg-background/80 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{diagnostic.summary}</p>
            <Badge variant={statusVariant(diagnostic.connection_status)}>
              {diagnostic.connection_status}
            </Badge>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            {diagnostic.details.length > 0 ? (
              diagnostic.details.slice(0, 3).map((detail) => <p key={detail}>{detail}</p>)
            ) : (
              <p>No diagnostic details returned yet.</p>
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          className="flex-1"
          disabled={busy}
          onClick={() => void onAuthorize(connection.toolkit)}
          type="button"
          variant="outline"
        >
          <Cable className="mr-2 h-4 w-4" />
          {busy ? 'Opening...' : connection.status === 'connected' ? 'Reconnect' : 'Connect'}
        </Button>
        <Button
          className="flex-1"
          disabled={busy || connection.status !== 'connected'}
          onClick={() => void onCheck(connection.toolkit)}
          type="button"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          {busy ? 'Checking...' : 'Run check'}
        </Button>
      </div>
    </div>
  )
}

function MetricTile({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        {icon}
      </div>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}

function statusVariant(status: 'not_connected' | 'pending' | 'connected' | 'error') {
  if (status === 'connected') {
    return 'success'
  }
  if (status === 'pending') {
    return 'warning'
  }
  if (status === 'error') {
    return 'danger'
  }
  return 'outline'
}
