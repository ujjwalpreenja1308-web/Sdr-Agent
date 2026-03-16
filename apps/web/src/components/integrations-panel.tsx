import { useState } from 'react'
import { CheckCircle2, RefreshCw, Search, Zap } from 'lucide-react'

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

const TOOL_META: Record<string, { name: string; logo: string; desc: string; badge?: string }> = {
  // ── Sourcing ──
  apollo:    { name: 'Apollo',    logo: 'https://logo.clearbit.com/apollo.io',    desc: 'Find and source leads by ICP filters', badge: 'Sourcing' },
  linkedin:  { name: 'LinkedIn',  logo: 'https://logo.clearbit.com/linkedin.com', desc: 'Social graph prospecting & signals',   badge: 'Sourcing' },
  zoominfo:  { name: 'ZoomInfo',  logo: 'https://logo.clearbit.com/zoominfo.com', desc: 'B2B contact & company database',       badge: 'Sourcing' },
  lusha:     { name: 'Lusha',     logo: 'https://logo.clearbit.com/lusha.com',    desc: 'Direct dials & verified emails',       badge: 'Sourcing' },
  // ── Enrichment & verification ──
  hunter:    { name: 'Hunter',    logo: 'https://logo.clearbit.com/hunter.io',    desc: 'Email verification & deliverability',  badge: 'Enrichment' },
  clearbit:  { name: 'Clearbit',  logo: 'https://logo.clearbit.com/clearbit.com', desc: 'Company & person enrichment',          badge: 'Enrichment' },
  proxycurl: { name: 'Proxycurl', logo: 'https://logo.clearbit.com/proxycurl.com',desc: 'LinkedIn profile enrichment',          badge: 'Enrichment' },
}

const SOURCING_TOOLKITS    = ['apollo', 'linkedin', 'zoominfo', 'lusha']
const ENRICHMENT_TOOLKITS  = ['hunter', 'clearbit', 'proxycurl']

export function IntegrationsPanel({
  busyToolkit,
  connections,
  diagnostics,
  onAuthorize,
  onCheck,
  onSaveApiKey,
}: IntegrationsPanelProps) {
  const connectionMap = Object.fromEntries(connections.map((c) => [c.toolkit, c]))

  const sourcingConnected   = SOURCING_TOOLKITS.filter((t)   => connectionMap[t]?.status === 'connected').length
  const enrichmentConnected = ENRICHMENT_TOOLKITS.filter((t) => connectionMap[t]?.status === 'connected').length

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 py-2">

        {/* Callout */}
        <div className="flex items-start gap-3 rounded-xl border border-border bg-secondary/40 px-4 py-3.5">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Connect your lead sourcing and enrichment tools. Deliverability — warming, sending, inbox rotation — is handled by PipeIQ directly.
          </p>
        </div>

        {/* Lead Sourcing */}
        <Section
          title="Lead Sourcing"
          subtitle="Where we find your prospects"
          connected={sourcingConnected}
          total={SOURCING_TOOLKITS.length}
        >
          <div className="grid grid-cols-2 gap-3">
            {SOURCING_TOOLKITS.map((toolkit) => (
              <AppCard
                key={toolkit}
                toolkit={toolkit}
                connection={connectionMap[toolkit]}
                diagnostic={diagnostics[toolkit]}
                busy={busyToolkit === toolkit}
                onAuthorize={onAuthorize}
                onCheck={onCheck}
                onSaveApiKey={onSaveApiKey}
              />
            ))}
          </div>
        </Section>

        {/* Enrichment & Verification */}
        <Section
          title="Enrichment & Verification"
          subtitle="How we validate and enrich each contact"
          connected={enrichmentConnected}
          total={ENRICHMENT_TOOLKITS.length}
        >
          <div className="grid grid-cols-2 gap-3">
            {ENRICHMENT_TOOLKITS.map((toolkit) => (
              <AppCard
                key={toolkit}
                toolkit={toolkit}
                connection={connectionMap[toolkit]}
                diagnostic={diagnostics[toolkit]}
                busy={busyToolkit === toolkit}
                onAuthorize={onAuthorize}
                onCheck={onCheck}
                onSaveApiKey={onSaveApiKey}
              />
            ))}
          </div>
        </Section>

      </div>
    </div>
  )
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, subtitle, connected, total, children }: {
  title: string
  subtitle: string
  connected: number
  total: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-[13px] font-semibold text-foreground">{title}</p>
          <p className="text-[12px] text-muted-foreground">{subtitle}</p>
        </div>
        <span className="text-[12px] text-muted-foreground">
          {connected}/{total} connected
        </span>
      </div>
      {children}
    </div>
  )
}

// ─── App card ─────────────────────────────────────────────────────────────────

function AppCard({
  busy, connection, diagnostic, toolkit,
  onAuthorize, onCheck, onSaveApiKey,
}: {
  busy: boolean
  connection?: ConnectionTarget
  diagnostic?: IntegrationCheckResult
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
    <div className={`flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
      isConnected ? 'border-success/30 bg-success-subtle/20' : 'border-border bg-card hover:border-border-strong'
    }`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-white">
            {meta?.logo ? (
              <img
                src={meta.logo}
                alt={meta.name}
                className="h-5 w-5 object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  const p = e.currentTarget.parentElement
                  if (p) {
                    const fb = document.createElement('span')
                    fb.className = 'text-[10px] font-bold text-muted-foreground'
                    fb.textContent = meta.name.slice(0, 2).toUpperCase()
                    p.appendChild(fb)
                  }
                }}
              />
            ) : (
              <span className="text-[10px] font-bold text-muted-foreground">
                {(meta?.name ?? toolkit).slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <p className="text-[13px] font-semibold leading-tight text-foreground">{meta?.name ?? toolkit}</p>
            <p className="text-[11px] text-muted-foreground leading-tight">{meta?.desc}</p>
          </div>
        </div>
        {isConnected && <CheckCircle2 className="h-4 w-4 shrink-0 text-success-text" />}
      </div>

      {/* Connect action */}
      {isApiKey ? (
        <div className="space-y-1.5">
          <Input
            className="h-7 rounded-lg text-xs"
            placeholder={isConnected ? 'Paste new key to rotate' : 'Paste API key'}
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <div className="flex gap-1.5">
            <Button
              className="h-7 flex-1 rounded-lg text-xs"
              disabled={busy || !apiKey.trim()}
              size="sm"
              type="button"
              variant={isConnected ? 'secondary' : 'default'}
              onClick={() => void onSaveApiKey(toolkit, connection?.label ?? meta?.name ?? toolkit, apiKey.trim())}
            >
              <Zap className="h-3 w-3" />
              {busy ? '…' : isConnected ? 'Rotate key' : 'Connect'}
            </Button>
            {isConnected && (
              <Button className="h-7 w-7 rounded-lg p-0" disabled={busy} size="icon-sm" type="button" variant="outline" onClick={() => void onCheck(toolkit)}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <Button
            className="h-7 flex-1 rounded-lg text-xs"
            disabled={busy}
            size="sm"
            type="button"
            variant={isConnected ? 'secondary' : 'default'}
            onClick={() => void onAuthorize(toolkit)}
          >
            <Zap className="h-3 w-3" />
            {busy ? '…' : isConnected ? 'Reconnect' : 'Connect'}
          </Button>
          {isConnected && (
            <Button className="h-7 w-7 rounded-lg p-0" disabled={busy} size="icon-sm" type="button" variant="outline" onClick={() => void onCheck(toolkit)}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}

      {/* Diagnostic */}
      {diagnostic && (
        <div className="rounded-lg border border-border bg-background px-2.5 py-2 text-[11px] text-muted-foreground">
          {diagnostic.summary}
        </div>
      )}
    </div>
  )
}
