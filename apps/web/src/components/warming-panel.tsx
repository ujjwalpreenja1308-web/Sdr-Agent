import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Download,
  FlameKindling,
  Inbox,
  Mail,
  PauseCircle,
  PlayCircle,
  Plus,
  ShieldCheck,
  Terminal,
  Trash2,
  Upload,
} from 'lucide-react'

import {
  addWarmingInbox,
  deleteWarmingInbox,
  getWarmingInboxStats,
  getWarmingOverview,
  runWarmingCycle,
  testWarmingCredentials,
  updateWarmingInbox,
} from '../lib/api'
import type { WarmingInboxStats, WarmingInboxSummary, WarmingOverview } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type Props = { workspaceId: string }

const EMPTY_FORM = {
  email: '',
  display_name: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_secure: false,
  imap_host: '',
  imap_port: '993',
  imap_user: '',
  imap_pass: '',
  daily_target: '30',
  use_for_outreach: false,
}
type Form = typeof EMPTY_FORM
// EMPTY_FORM and Form are used by the BulkAddForm rows

function healthVariant(score: number): 'success' | 'warning' | 'danger' | 'outline' {
  if (score >= 80) return 'success'
  if (score >= 55) return 'warning'
  return 'danger'
}

function statusVariant(status: string): 'success' | 'warning' | 'destructive' | 'outline' {
  if (status === 'active') return 'success'
  if (status === 'paused') return 'warning'
  if (status === 'error') return 'destructive'
  return 'outline'
}

// ─── Inbox row ────────────────────────────────────────────────────────────────

function InboxRow({
  inbox,
  workspaceId,
  onDelete,
  onToggle,
}: {
  inbox: WarmingInboxSummary
  workspaceId: string
  onDelete: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [stats, setStats] = useState<WarmingInboxStats | null>(null)
  const [loadingStats, setLoadingStats] = useState(false)

  async function toggleStats() {
    if (expanded) { setExpanded(false); return }
    if (stats) { setExpanded(true); return }
    setLoadingStats(true)
    try {
      setStats(await getWarmingInboxStats(workspaceId, inbox.id))
      setExpanded(true)
    } finally {
      setLoadingStats(false)
    }
  }

  const pct = inbox.daily_target > 0
    ? Math.min(100, Math.round((inbox.current_daily_sent / inbox.daily_target) * 100))
    : 0

  return (
    <div className="rounded-xl border border-border bg-card transition-colors">
      <div className="flex items-center gap-3 p-4">
        {/* Icon */}
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
          <Mail className="h-4 w-4 text-muted-foreground" />
        </div>

        {/* Main info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{inbox.email}</span>
            {inbox.display_name && (
              <span className="text-xs text-muted-foreground">· {inbox.display_name}</span>
            )}
            <Badge variant={statusVariant(inbox.status)}>{inbox.status}</Badge>
            {inbox.use_for_outreach && (
              <Badge variant="outline" className="text-[10px]">outreach</Badge>
            )}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span>
              Health <Badge variant={healthVariant(inbox.health_score)} className="ml-1 text-[10px]">
                {inbox.health_score.toFixed(0)}
              </Badge>
            </span>
            <span>{inbox.current_daily_sent}/{inbox.daily_target} sent today</span>
            <span>Spam {inbox.spam_rate.toFixed(1)}%</span>
            <span>Inbox {inbox.inbox_placement_rate.toFixed(0)}%</span>
          </div>
          {/* ramp bar */}
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7"
            title={inbox.warmup_enabled ? 'Pause warming' : 'Resume warming'}
            onClick={() => onToggle(inbox.id, !inbox.warmup_enabled)}
          >
            {inbox.warmup_enabled
              ? <PauseCircle className="h-3.5 w-3.5" />
              : <PlayCircle className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            title="Remove inbox"
            onClick={() => onDelete(inbox.id)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7"
            title={expanded ? 'Hide stats' : 'Show stats'}
            disabled={loadingStats}
            onClick={toggleStats}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      {inbox.error_note && (
        <div className="border-t border-border px-4 py-2 text-xs text-destructive">
          {inbox.error_note}
        </div>
      )}

      {/* 14-day stats */}
      {expanded && stats && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>7d sent <span className="font-medium text-foreground">{stats.total_sent_7d}</span></span>
            <span>7d opens <span className="font-medium text-foreground">{stats.total_opens_7d}</span></span>
            <span>7d replies <span className="font-medium text-foreground">{stats.total_replies_7d}</span></span>
            <span>7d spam <span className="font-medium text-destructive">{stats.spam_hits_7d}</span></span>
          </div>
          {/* Bar chart */}
          <div className="flex items-end gap-0.5 h-8">
            {stats.days.slice(0, 14).reverse().map((day) => {
              const h = day.target_sends > 0
                ? Math.max(4, Math.round((day.actual_sends / day.target_sends) * 32))
                : 4
              return (
                <div
                  key={day.date}
                  className="flex-1 rounded-sm"
                  style={{ height: h }}
                  title={`${day.date}: ${day.actual_sends}/${day.target_sends}${day.spam_hits > 0 ? ` · ${day.spam_hits} spam` : ''}`}
                  // eslint-disable-next-line react/forbid-dom-props
                  data-spam={day.spam_hits > 0}
                >
                  <div
                    className={`h-full w-full rounded-sm ${day.spam_hits > 0 ? 'bg-destructive/60' : 'bg-primary/50'}`}
                  />
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-muted-foreground">Last 14 days · red = spam hits</p>
        </div>
      )}
    </div>
  )
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────

const CSV_HEADERS = [
  'email', 'display_name',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_secure',
  'imap_host', 'imap_port', 'imap_user', 'imap_pass',
  'daily_target', 'use_for_outreach',
]

const CSV_EXAMPLE_ROWS = [
  ['you@gmail.com', 'Your Name', 'smtp.gmail.com', '587', 'you@gmail.com', 'app-password', 'false', 'imap.gmail.com', '993', 'you@gmail.com', 'app-password', '30', 'false'],
  ['sales@company.com', 'Sales Inbox', 'smtp.office365.com', '587', 'sales@company.com', 'app-password', 'false', 'outlook.office365.com', '993', 'sales@company.com', 'app-password', '30', 'true'],
]

function downloadCsvTemplate() {
  const lines = [
    CSV_HEADERS.join(','),
    ...CSV_EXAMPLE_ROWS.map((r) => r.map((v) => `"${v}"`).join(',')),
  ]
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'warming-inboxes-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function parseCsvToRows(text: string): InboxRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length < 2) return []
  // Detect if first line is header (contains 'email')
  const firstLine = lines[0].toLowerCase()
  const dataLines = firstLine.includes('email') ? lines.slice(1) : lines

  return dataLines.map((line) => {
    // Simple CSV parse — handle quoted fields
    const cols: string[] = []
    let cur = ''
    let inQuote = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQuote = !inQuote; continue }
      if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue }
      cur += ch
    }
    cols.push(cur.trim())

    const [
      email = '', display_name = '',
      smtp_host = '', smtp_port = '587', smtp_user = '', smtp_pass = '', smtp_secure_s = 'false',
      imap_host = '', imap_port = '993', imap_user = '', imap_pass = '',
      daily_target = '30', use_for_outreach_s = 'false',
    ] = cols

    return {
      email, display_name,
      smtp_host, smtp_port, smtp_user, smtp_pass,
      smtp_secure: smtp_secure_s.toLowerCase() === 'true',
      imap_host, imap_port, imap_user, imap_pass,
      daily_target,
      use_for_outreach: use_for_outreach_s.toLowerCase() === 'true',
      _id: Math.random().toString(36).slice(2),
      _status: 'idle' as RowStatus,
      _error: null,
      _smtpOk: false,
      _imapOk: false,
    }
  }).filter((r) => r.email)
}

// ─── Bulk add form ────────────────────────────────────────────────────────────
// Users fill a table of rows — one row per inbox — then test + submit all at once.

type RowStatus = 'idle' | 'testing' | 'ok' | 'error'

interface InboxRow extends Form {
  _id: string          // local key only
  _status: RowStatus
  _error: string | null
  _smtpOk: boolean
  _imapOk: boolean
}

function newRow(): InboxRow {
  return {
    ...EMPTY_FORM,
    _id: Math.random().toString(36).slice(2),
    _status: 'idle',
    _error: null,
    _smtpOk: false,
    _imapOk: false,
  }
}

function BulkAddForm({
  workspaceId,
  onAdded,
  onCancel,
}: {
  workspaceId: string
  onAdded: () => void
  onCancel: () => void
}) {
  const [tab, setTab] = useState<'manual' | 'csv'>('csv')
  const [rows, setRows] = useState<InboxRow[]>([newRow()])
  const [saving, setSaving] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const parsed = parseCsvToRows(text)
      if (parsed.length === 0) {
        setGlobalError('No valid rows found in CSV. Make sure it matches the template format.')
        return
      }
      setRows(parsed)
      setTab('manual')
      setGlobalError(null)
    }
    reader.readAsText(file)
    // Reset so same file can be re-uploaded
    e.target.value = ''
  }

  function updateRow(id: string, patch: Partial<InboxRow>) {
    setRows((rs) =>
      rs.map((r) =>
        r._id === id ? { ...r, ...patch, _status: 'idle', _smtpOk: false, _imapOk: false, _error: null } : r,
      ),
    )
  }

  function addRow() {
    setRows((rs) => [...rs, newRow()])
  }

  function removeRow(id: string) {
    setRows((rs) => rs.filter((r) => r._id !== id))
  }

  // Test all rows in parallel
  async function handleTestAll() {
    setGlobalError(null)
    // Mark all as testing
    setRows((rs) => rs.map((r) => ({ ...r, _status: 'testing' as RowStatus, _error: null })))

    await Promise.all(
      rows.map(async (row) => {
        try {
          const result = await testWarmingCredentials(workspaceId, {
            smtp_host: row.smtp_host, smtp_port: Number(row.smtp_port),
            smtp_user: row.smtp_user, smtp_pass: row.smtp_pass, smtp_secure: row.smtp_secure,
            imap_host: row.imap_host, imap_port: Number(row.imap_port),
            imap_user: row.imap_user, imap_pass: row.imap_pass,
          })
          setRows((rs) =>
            rs.map((r) =>
              r._id === row._id
                ? { ...r, _status: result.ok ? 'ok' : 'error', _smtpOk: result.smtp.ok, _imapOk: result.imap.ok, _error: result.ok ? null : `SMTP: ${result.smtp.error ?? 'ok'} · IMAP: ${result.imap.error ?? 'ok'}` }
                : r,
            ),
          )
        } catch (e) {
          setRows((rs) =>
            rs.map((r) =>
              r._id === row._id
                ? { ...r, _status: 'error', _smtpOk: false, _imapOk: false, _error: e instanceof Error ? e.message : 'Test failed' }
                : r,
            ),
          )
        }
      }),
    )
  }

  // Submit only rows that passed testing
  async function handleSaveAll() {
    const okRows = rows.filter((r) => r._status === 'ok')
    if (okRows.length === 0) return
    setSaving(true)
    setGlobalError(null)
    let saved = 0
    for (const row of okRows) {
      try {
        await addWarmingInbox(workspaceId, {
          email: row.email, display_name: row.display_name || undefined,
          smtp_host: row.smtp_host, smtp_port: Number(row.smtp_port),
          smtp_user: row.smtp_user, smtp_pass: row.smtp_pass, smtp_secure: row.smtp_secure,
          imap_host: row.imap_host, imap_port: Number(row.imap_port),
          imap_user: row.imap_user, imap_pass: row.imap_pass,
          daily_target: Number(row.daily_target),
          use_for_outreach: row.use_for_outreach,
        })
        saved++
      } catch (e) {
        setRows((rs) =>
          rs.map((r) =>
            r._id === row._id
              ? { ...r, _status: 'error', _error: e instanceof Error ? e.message : 'Save failed' }
              : r,
          ),
        )
      }
    }
    setSaving(false)
    if (saved > 0) onAdded()
    else setGlobalError('No inboxes were saved — check errors above.')
  }

  const allTested = rows.every((r) => r._status === 'ok' || r._status === 'error')
  const anyOk = rows.some((r) => r._status === 'ok')
  const anyTesting = rows.some((r) => r._status === 'testing')
  const inputCls = 'h-7 text-xs rounded-md px-2'

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect inboxes</CardTitle>
        <CardDescription>
          Add rows manually or import a CSV. Test all, then save the ones that pass.
        </CardDescription>
        <div className="flex items-center gap-2 pt-1">
          {/* Tab toggle */}
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              type="button"
              className={`px-3 py-1.5 transition-colors ${tab === 'manual' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('manual')}
            >
              Manual
            </button>
            <button
              type="button"
              className={`px-3 py-1.5 transition-colors border-l border-border ${tab === 'csv' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('csv')}
            >
              CSV import
            </button>
          </div>
          {tab === 'manual' && (
            <Button size="sm" variant="outline" onClick={addRow}>
              <Plus className="h-3.5 w-3.5" />
              Add row
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* CSV import panel */}
        {tab === 'csv' && (
          <div className="rounded-xl border border-dashed border-border bg-secondary/20 p-6 text-center space-y-4">
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card">
                <Upload className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium">Upload CSV file</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One inbox per row. Download the template to see the required columns.
                </p>
              </div>
            </div>
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="outline" onClick={downloadCsvTemplate}>
                <Download className="h-3.5 w-3.5" />
                Download template
              </Button>
              <Button size="sm" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" />
                Upload CSV
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">CSV columns (in order):</p>
              <p className="font-mono">{CSV_HEADERS.join(', ')}</p>
            </div>
            {rows.length > 1 && (
              <p className="text-xs text-success-text">
                {rows.length} inboxes loaded — switch to Manual to review before testing.
              </p>
            )}
          </div>
        )}
        {/* Manual table */}
        {tab === 'manual' && <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pb-2 pr-2 font-medium w-40">Email</th>
                <th className="pb-2 pr-2 font-medium w-28">SMTP host</th>
                <th className="pb-2 pr-2 font-medium w-14">Port</th>
                <th className="pb-2 pr-2 font-medium w-28">SMTP user</th>
                <th className="pb-2 pr-2 font-medium w-28">SMTP pass</th>
                <th className="pb-2 pr-2 font-medium w-28">IMAP host</th>
                <th className="pb-2 pr-2 font-medium w-14">Port</th>
                <th className="pb-2 pr-2 font-medium w-28">IMAP user</th>
                <th className="pb-2 pr-2 font-medium w-28">IMAP pass</th>
                <th className="pb-2 pr-2 font-medium w-12">Target</th>
                <th className="pb-2 pr-2 font-medium w-16">Outreach</th>
                <th className="pb-2 font-medium w-16">Status</th>
                <th className="pb-2 w-7" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row._id} className="align-top">
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} placeholder="you@domain.com" value={row.email} onChange={(e) => updateRow(row._id, { email: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} placeholder="smtp.gmail.com" value={row.smtp_host} onChange={(e) => updateRow(row._id, { smtp_host: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} type="number" value={row.smtp_port} onChange={(e) => updateRow(row._id, { smtp_port: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} value={row.smtp_user} onChange={(e) => updateRow(row._id, { smtp_user: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} type="password" placeholder="••••••••" value={row.smtp_pass} onChange={(e) => updateRow(row._id, { smtp_pass: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} placeholder="imap.gmail.com" value={row.imap_host} onChange={(e) => updateRow(row._id, { imap_host: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} type="number" value={row.imap_port} onChange={(e) => updateRow(row._id, { imap_port: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} value={row.imap_user} onChange={(e) => updateRow(row._id, { imap_user: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} type="password" placeholder="••••••••" value={row.imap_pass} onChange={(e) => updateRow(row._id, { imap_pass: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    <Input className={inputCls} type="number" min={1} max={40} value={row.daily_target} onChange={(e) => updateRow(row._id, { daily_target: e.target.value })} />
                  </td>
                  <td className="py-1.5 pr-2 text-center">
                    <input type="checkbox" className="accent-primary mt-1.5" checked={row.use_for_outreach} onChange={(e) => updateRow(row._id, { use_for_outreach: e.target.checked })} />
                  </td>
                  <td className="py-1.5 pr-2">
                    {row._status === 'idle' && <span className="text-muted-foreground">—</span>}
                    {row._status === 'testing' && <span className="text-muted-foreground animate-pulse">Testing…</span>}
                    {row._status === 'ok' && (
                      <span className="text-success-text font-medium">✓ Ready</span>
                    )}
                    {row._status === 'error' && (
                      <span className="text-destructive" title={row._error ?? ''}>✗ Failed</span>
                    )}
                  </td>
                  <td className="py-1.5">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      disabled={rows.length === 1}
                      onClick={() => removeRow(row._id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}

        {/* Per-row errors summary */}
        {rows.some((r) => r._status === 'error') && (
          <div className="space-y-1">
            {rows.filter((r) => r._status === 'error').map((r) => (
              <p key={r._id} className="text-xs text-destructive">
                <span className="font-medium">{r.email || '(empty)'}</span>: {r._error}
              </p>
            ))}
          </div>
        )}

        {globalError && <p className="text-xs text-destructive">{globalError}</p>}

        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          {tab === 'manual' && (
            <>
              {!allTested ? (
                <Button
                  size="sm"
                  disabled={anyTesting || rows.every((r) => !r.smtp_host || !r.smtp_pass || !r.imap_host || !r.imap_pass)}
                  onClick={handleTestAll}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {anyTesting ? 'Testing all…' : `Test ${rows.length} inbox${rows.length > 1 ? 'es' : ''}`}
                </Button>
              ) : (
                <Button size="sm" disabled={saving || !anyOk} onClick={handleSaveAll}>
                  <Plus className="h-3.5 w-3.5" />
                  {saving ? 'Saving…' : `Save ${rows.filter((r) => r._status === 'ok').length} inbox${rows.filter((r) => r._status === 'ok').length !== 1 ? 'es' : ''}`}
                </Button>
              )}
              {allTested && rows.some((r) => r._status === 'error') && (
                <Button size="sm" variant="outline" onClick={handleTestAll}>
                  Retry failed
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {rows.filter((r) => r._status === 'ok').length}/{rows.length} ready
              </span>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function WarmingPanel({ workspaceId }: Props) {
  const [overview, setOverview] = useState<WarmingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [showCron, setShowCron] = useState(false)
  const [running, setRunning] = useState(false)
  const [runMsg, setRunMsg] = useState<{ sent: number; errors: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      setOverview(await getWarmingOverview(workspaceId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load warming data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [workspaceId])

  async function handleRun() {
    setRunning(true)
    setRunMsg(null)
    setError(null)
    try {
      const r = await runWarmingCycle(workspaceId)
      setRunMsg({ sent: r.emails_sent, errors: r.errors.length })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  async function handleDelete(inboxId: string) {
    if (!confirm('Remove this inbox from the warming pool?')) return
    try {
      await deleteWarmingInbox(workspaceId, inboxId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  async function handleToggle(inboxId: string, enabled: boolean) {
    try {
      await updateWarmingInbox(workspaceId, inboxId, {
        warmup_enabled: enabled,
        status: enabled ? 'active' : 'paused',
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    }
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl py-8">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Deliverability</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Connected inboxes warm each other at 5–40 emails/day, building sender reputation.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={running} onClick={() => void handleRun()}>
            <FlameKindling className="h-3.5 w-3.5" />
            {running ? 'Running…' : 'Run now'}
          </Button>
          <Button size="sm" onClick={() => { setShowAdd(true); setRunMsg(null) }}>
            <Plus className="h-3.5 w-3.5" />
            Add inbox
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {runMsg && (
        <div className="rounded-lg border border-success/30 bg-success-subtle/30 px-3 py-2 text-xs text-success-text">
          Sent {runMsg.sent} warming emails.
          {runMsg.errors > 0 && <span className="ml-2 text-warning-text">{runMsg.errors} error(s)</span>}
        </div>
      )}

      {/* Stats row */}
      {overview && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total inboxes', value: overview.total_inboxes, icon: Inbox },
            { label: 'Active', value: overview.active_inboxes, icon: Activity },
            { label: 'Sent today', value: `${overview.total_sent_today} / ${overview.total_capacity_today}`, icon: Mail },
            { label: 'Avg health', value: overview.average_health_score.toFixed(0), icon: ShieldCheck },
          ].map(({ label, value, icon: Icon }) => (
            <div key={label} className="rounded-xl border border-border bg-secondary/20 p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Icon className="h-3 w-3" />
                {label}
              </div>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Bulk add form */}
      {showAdd && (
        <BulkAddForm
          workspaceId={workspaceId}
          onAdded={async () => { setShowAdd(false); await load() }}
          onCancel={() => setShowAdd(false)}
        />
      )}

      {/* Inbox list */}
      {overview && overview.inboxes.length > 0 ? (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Connected inboxes ({overview.inboxes.length})
          </p>
          {overview.inboxes.map((inbox) => (
            <InboxRow
              key={inbox.id}
              inbox={inbox}
              workspaceId={workspaceId}
              onDelete={handleDelete}
              onToggle={handleToggle}
            />
          ))}
        </div>
      ) : !showAdd ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-secondary">
              <Mail className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium">No inboxes connected</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Add Gmail, Outlook, or any SMTP/IMAP inbox. They warm each other at 5–40 emails/day.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-3.5 w-3.5" />
              Connect first inbox
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Cron setup — collapsible */}
      <div className="rounded-xl border border-border bg-card">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left"
          onClick={() => setShowCron((v) => !v)}
        >
          <div className="flex items-center gap-2 text-xs font-medium">
            <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
            DigitalOcean cron setup
          </div>
          {showCron ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        {showCron && (
          <div className="border-t border-border px-4 pb-4 pt-3 space-y-2 text-xs text-muted-foreground">
            <p>Add this to your Droplet's crontab to run warming daily at 08:00 UTC:</p>
            <code className="block select-all rounded-lg border border-border bg-secondary/30 px-3 py-2 font-mono text-foreground">
              {`0 8 * * * curl -s -X POST https://YOUR_API/internal/warming/run-all -H "x-cron-secret: $WARMING_SECRET"`}
            </code>
            <p>Set <code className="rounded bg-secondary px-1 font-mono">PIPEIQ_WARMING_CRON_SECRET</code> in your server <code className="rounded bg-secondary px-1 font-mono">.env</code>.</p>
          </div>
        )}
      </div>
    </div>
  )
}
