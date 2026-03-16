import { useState } from 'react'
import { CheckCircle2, RefreshCw, Zap } from 'lucide-react'

import type { ConnectionTarget, IntegrationCheckResult } from '../lib/api'
import { Input } from './ui/input'
import { Button } from './ui/button'

type IntegrationsPanelProps = {
  busyToolkit: string | null
  connections: ConnectionTarget[]
  diagnostics: Record<string, IntegrationCheckResult | undefined>
  onAuthorize: (toolkit: string) => Promise<void>
  onCheck: (toolkit: string) => Promise<void>
  onSaveApiKey: (toolkit: string, label: string, apiKey: string) => Promise<void>
}

const TOOL_META: Record<string, { name: string; logo: string; desc: string }> = {
  apollo: { name: 'Apollo', logo: 'https://logo.clearbit.com/apollo.io', desc: 'Lead sourcing & enrichment' },
  hunter: { name: 'Hunter', logo: 'https://logo.clearbit.com/hunter.io', desc: 'Email verification' },
  instantly: { name: 'Instantly', logo: 'https://logo.clearbit.com/instantly.ai', desc: 'Email sequencing' },
  hubspot: { name: 'HubSpot', logo: 'https://logo.clearbit.com/hubspot.com', desc: 'CRM & deals' },
  salesforce: { name: 'Salesforce', logo: 'https://logo.clearbit.com/salesforce.com', desc: 'Enterprise CRM' },
  pipedrive: { name: 'Pipedrive', logo: 'https://logo.clearbit.com/pipedrive.com', desc: 'Sales pipeline CRM' },
  zoho_crm: { name: 'Zoho CRM', logo: 'https://logo.clearbit.com/zoho.com', desc: 'CRM & automation' },
  gmail: { name: 'Gmail', logo: 'https://logo.clearbit.com/gmail.com', desc: 'Inbox & reply handling' },
  outlook: { name: 'Outlook', logo: 'https://logo.clearbit.com/microsoft.com', desc: 'Microsoft email' },
  googlecalendar: { name: 'Google Calendar', logo: 'https://logo.clearbit.com/google.com', desc: 'Meeting scheduling' },
  calendly: { name: 'Calendly', logo: 'https://logo.clearbit.com/calendly.com', desc: 'Booking links' },
  linkedin: { name: 'LinkedIn', logo: 'https://logo.clearbit.com/linkedin.com', desc: 'Social prospecting' },
  clearbit: { name: 'Clearbit', logo: 'https://logo.clearbit.com/clearbit.com', desc: 'Company enrichment' },
  zoominfo: { name: 'ZoomInfo', logo: 'https://logo.clearbit.com/zoominfo.com', desc: 'B2B data platform' },
  lusha: { name: 'Lusha', logo: 'https://logo.clearbit.com/lusha.com', desc: 'Contact data' },
  outreach_tool: { name: 'Outreach', logo: 'https://logo.clearbit.com/outreach.io', desc: 'Sales engagement' },
  salesloft: { name: 'Salesloft', logo: 'https://logo.clearbit.com/salesloft.com', desc: 'Revenue engagement' },
  reply_io: { name: 'Reply.io', logo: 'https://logo.clearbit.com/reply.io', desc: 'Multichannel sequences' },
  lemlist: { name: 'Lemlist', logo: 'https://logo.clearbit.com/lemlist.com', desc: 'Cold email personalization' },
  slack: { name: 'Slack', logo: 'https://logo.clearbit.com/slack.com', desc: 'Team notifications' },
  notion: { name: 'Notion', logo: 'https://logo.clearbit.com/notion.so', desc: 'Knowledge base' },
  airtable: { name: 'Airtable', logo: 'https://logo.clearbit.com/airtable.com', desc: 'Data tables' },
}

const REQUIRED_TOOLKITS = ['apollo', 'hunter', 'instantly']
const OPTIONAL_SECTIONS: { title: string; toolkits: string[] }[] = [
  { title: 'CRM', toolkits: ['hubspot', 'salesforce', 'pipedrive', 'zoho_crm'] },
  { title: 'Email & Calendar', toolkits: ['gmail', 'outlook', 'googlecalendar', 'calendly'] },
  { title: 'Prospecting', toolkits: ['linkedin', 'clearbit', 'zoominfo', 'lusha'] },
  { title: 'Engagement', toolkits: ['outreach_tool', 'salesloft', 'reply_io', 'lemlist'] },
  { title: 'Other', toolkits: ['slack', 'notion', 'airtable'] },
]

export function IntegrationsPanel({
  busyToolkit,
  connections,
  diagnostics,
  onAuthorize,
  onCheck,
  onSaveApiKey,
}: IntegrationsPanelProps) {
  const connectionMap = Object.fromEntries(connections.map((c) => [c.toolkit, c]))
  const connectedRequired = REQUIRED_TOOLKITS.filter((t) => connectionMap[t]?.status === 'connected').length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 py-2">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Required</p>
            <span className="text-xs text-muted-foreground">{connectedRequired}/{REQUIRED_TOOLKITS.length} connected</span>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">These three tools power the full outbound loop.</p>
          <div className="grid grid-cols-3 gap-3">
            {REQUIRED_TOOLKITS.map((toolkit) => (
              <AppCard
                key={toolkit}
                toolkit={toolkit}
                connection={connectionMap[toolkit]}
                diagnostic={diagnostics[toolkit]}
                busy={busyToolkit === toolkit}
                required
                onAuthorize={onAuthorize}
                onCheck={onCheck}
                onSaveApiKey={onSaveApiKey}
              />
            ))}
          </div>
        </div>

        {OPTIONAL_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{section.title}</p>
            <div className="grid grid-cols-4 gap-3">
              {section.toolkits.map((toolkit) => (
                <AppCard
                  key={toolkit}
                  toolkit={toolkit}
                  connection={connectionMap[toolkit]}
                  diagnostic={diagnostics[toolkit]}
                  busy={busyToolkit === toolkit}
                  required={false}
                  onAuthorize={onAuthorize}
                  onCheck={onCheck}
                  onSaveApiKey={onSaveApiKey}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function AppCard({
  busy,
  connection,
  diagnostic,
  required,
  toolkit,
  onAuthorize,
  onCheck,
  onSaveApiKey,
}: {
  busy: boolean
  connection?: ConnectionTarget
  diagnostic?: IntegrationCheckResult
  required: boolean
  toolkit: string
  onAuthorize: (toolkit: string) => Promise<void>
  onCheck: (toolkit: string) => Promise<void>
  onSaveApiKey: (toolkit: string, label: string, apiKey: string) => Promise<void>
}) {
  const meta = TOOL_META[toolkit]
  const isConnected = connection?.status === 'connected'
  const isApiKey = connection?.mode === 'api_key'
  const [apiKey, setApiKey] = useState('')

  return (
    <div
      className={[
        'flex flex-col gap-3 rounded-xl border p-4 transition-colors',
        isConnected ? 'border-success/30 bg-success-subtle/30' : 'border-border bg-card hover:border-border-strong',
      ].join(' ')}
    >
      <div className="flex items-start justify-between">
        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
          {meta?.logo ? (
            <img
              src={meta.logo}
              alt={meta.name}
              className="h-6 w-6 object-contain"
              onError={(e) => {
                const t = e.currentTarget
                t.style.display = 'none'
                const p = t.parentElement
                if (p) {
                  const fallback = document.createElement('span')
                  fallback.className = 'text-xs font-bold text-muted-foreground'
                  fallback.textContent = meta.name.slice(0, 2).toUpperCase()
                  p.appendChild(fallback)
                }
              }}
            />
          ) : (
            <span className="text-xs font-bold text-muted-foreground">
              {(meta?.name ?? toolkit).slice(0, 2).toUpperCase()}
            </span>
          )}
        </div>
        {isConnected ? (
          <CheckCircle2 className="h-4 w-4 text-success-text" />
        ) : required ? (
          <span className="rounded-full bg-warning-subtle px-1.5 py-0.5 text-[10px] font-medium text-warning-text">req</span>
        ) : null}
      </div>

      <div className="flex-1">
        <p className="text-sm font-medium leading-tight">{meta?.name ?? toolkit}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{meta?.desc ?? connection?.description ?? ''}</p>
      </div>

      {isApiKey ? (
        <div className="grid gap-1.5">
          <Input
            className="h-7 rounded-lg text-xs"
            placeholder={isConnected ? 'Paste a new API key to rotate' : 'Paste API key'}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              className="h-7 flex-1 rounded-lg px-2 text-xs"
              disabled={busy || !apiKey.trim()}
              size="sm"
              type="button"
              variant={isConnected ? 'secondary' : 'default'}
              onClick={() =>
                void onSaveApiKey(
                  toolkit,
                  connection?.label ?? meta?.name ?? toolkit,
                  apiKey.trim(),
                )
              }
            >
              <Zap className="h-3 w-3" />
              {busy ? '...' : isConnected ? 'Rotate key' : 'Connect'}
            </Button>
            {isConnected ? (
              <Button
                className="h-7 w-7 rounded-lg p-0"
                disabled={busy}
                size="icon-sm"
                type="button"
                variant="outline"
                onClick={() => void onCheck(toolkit)}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button
            className="h-7 flex-1 rounded-lg px-2 text-xs"
            disabled={busy}
            size="sm"
            type="button"
            variant={isConnected ? 'secondary' : 'default'}
            onClick={() => void onAuthorize(toolkit)}
          >
            <Zap className="h-3 w-3" />
            {busy ? '...' : isConnected ? 'Reconnect' : 'Connect'}
          </Button>
          {isConnected ? (
            <Button
              className="h-7 w-7 rounded-lg p-0"
              disabled={busy}
              size="icon-sm"
              type="button"
              variant="outline"
              onClick={() => void onCheck(toolkit)}
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          ) : null}
        </div>
      )}

      {diagnostic ? (
        <div className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs text-muted-foreground">
          {diagnostic.summary}
        </div>
      ) : null}
    </div>
  )
}
