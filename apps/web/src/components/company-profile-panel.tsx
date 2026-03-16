import {
  Building2, Check, MapPin, Pencil,
  Trash2, Upload, Users, X, Zap,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { KnowledgeStatus, OnboardingProfile, WorkspaceSummary } from '../lib/api'
import { deleteKnowledge, getKnowledgeStatus, uploadKnowledge } from '../lib/api'
import type { OnboardingListField, OnboardingTextField } from '../lib/onboarding'
import { calculateOnboardingProgress } from '../lib/onboarding'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

type CompanyProfilePanelProps = {
  onboarding: OnboardingProfile
  onboardingDirty: boolean
  saving: boolean
  workspace: WorkspaceSummary
  onListChange: (field: OnboardingListField, value: string) => void
  onSave: () => Promise<void>
  onTabChange: (tab: 'onboarding') => void
  onTextChange: (field: OnboardingTextField, value: string) => void
}

export function CompanyProfilePanel({
  onboarding,
  onboardingDirty,
  saving,
  workspace,
  onListChange,
  onSave,
  onTabChange,
  onTextChange,
}: CompanyProfilePanelProps) {
  const [knowledgeStatus, setKnowledgeStatus] = useState<KnowledgeStatus[] | null>(null)
  const [uploading, setUploading] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState<string | null>(null)

  const completion = calculateOnboardingProgress(onboarding)

  const loadKnowledgeStatus = useCallback(async () => {
    try {
      const result = await getKnowledgeStatus(workspace.id)
      setKnowledgeStatus(result.pipelines)
    } catch {
      setKnowledgeStatus([])
    }
  }, [workspace.id])

  useEffect(() => { void loadKnowledgeStatus() }, [loadKnowledgeStatus])

  async function handleFileUpload(file: File) {
    setUploading('company')
    setUploadError(null)
    try {
      const text = await file.text()
      await uploadKnowledge(workspace.id, 'company', text)
      await loadKnowledgeStatus()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally { setUploading(null) }
  }

  async function handleTextUpload(text: string) {
    if (!text.trim()) return
    setUploading('company')
    setUploadError(null)
    try {
      await uploadKnowledge(workspace.id, 'company', text)
      await loadKnowledgeStatus()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally { setUploading(null) }
  }

  async function handleDelete() {
    setDeleting('company')
    setUploadError(null)
    try {
      await deleteKnowledge(workspace.id, 'company')
      await loadKnowledgeStatus()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed.')
    } finally { setDeleting(null) }
  }

  const companyChunks = knowledgeStatus?.find((s) => s.pipeline === 'company')?.chunk_count ?? 0

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <ProfileSection
          onboarding={onboarding}
          onboardingDirty={onboardingDirty}
          saving={saving}
          completion={completion}
          companyChunks={companyChunks}
          uploading={uploading === 'company'}
          deleting={deleting === 'company'}
          dragOver={dragOver === 'company'}
          uploadError={uploadError}
          onListChange={onListChange}
          onSave={onSave}
          onTextChange={onTextChange}
          onSetDragOver={(v) => setDragOver(v ? 'company' : null)}
          onFileUpload={handleFileUpload}
          onTextUpload={handleTextUpload}
          onDelete={handleDelete}
          onClearError={() => setUploadError(null)}
        />
      </div>
    </div>
  )
}

// ─── Profile Section ──────────────────────────────────────────────────────────

function ProfileSection({
  onboarding, onboardingDirty, saving, completion,
  companyChunks, uploading, deleting, dragOver, uploadError,
  onListChange, onSave, onTextChange,
  onSetDragOver, onFileUpload, onTextUpload, onDelete, onClearError,
}: {
  onboarding: OnboardingProfile
  onboardingDirty: boolean
  saving: boolean
  completion: number
  companyChunks: number
  uploading: boolean
  deleting: boolean
  dragOver: boolean
  uploadError: string | null
  onListChange: (field: OnboardingListField, value: string) => void
  onSave: () => Promise<void>
  onTextChange: (field: OnboardingTextField, value: string) => void
  onSetDragOver: (v: boolean) => void
  onFileUpload: (file: File) => Promise<void>
  onTextUpload: (text: string) => Promise<void>
  onDelete: () => Promise<void>
  onClearError: () => void
}) {
  const hasProduct = !!onboarding.product_name

  return (
    <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">

      {/* ── Hero card ── */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card">
        {/* Gradient banner */}
        <div
          className="h-24 w-full"
          style={{
            background: 'linear-gradient(135deg, hsl(var(--primary) / 0.15) 0%, hsl(var(--primary) / 0.05) 50%, hsl(var(--accent)) 100%)',
          }}
        />

        {/* Logo + name */}
        <div className="px-6 pb-5">
          <div className="-mt-8 mb-4 flex items-end justify-between">
            <div
              className="flex h-16 w-16 items-center justify-center rounded-2xl border-4 border-card text-2xl font-bold shadow-md"
              style={{ background: 'hsl(var(--primary))', color: 'white' }}
            >
              {(onboarding.product_name || 'P').slice(0, 1).toUpperCase()}
            </div>
            {/* Completion badge */}
            <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5">
              <div className="relative h-2.5 w-24 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${completion}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground">{completion}%</span>
            </div>
          </div>

          {/* Product name */}
          <InlineEditText
            value={onboarding.product_name}
            placeholder="Your product name"
            className="text-xl font-bold text-foreground"
            onChange={(v) => onTextChange('product_name', v)}
          />

          {/* Description */}
          {onboarding.product_description ? (
            <InlineEditTextarea
              value={onboarding.product_description}
              placeholder="Add a product description…"
              className="mt-1.5 text-[14px] text-muted-foreground leading-relaxed"
              onChange={(v) => onTextChange('product_description', v)}
            />
          ) : (
            <InlineEditTextarea
              value=""
              placeholder="Describe what your product does in one sentence…"
              className="mt-1.5 text-[14px] text-muted-foreground italic"
              onChange={(v) => onTextChange('product_description', v)}
            />
          )}

          {/* CTA pill */}
          {onboarding.call_to_action && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1">
              <Zap className="h-3 w-3 text-primary" />
              <InlineEditText
                value={onboarding.call_to_action}
                placeholder="Call to action"
                className="text-[12px] font-semibold text-primary"
                onChange={(v) => onTextChange('call_to_action', v)}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── Two-column: Messaging + ICP ── */}
      <div className="grid grid-cols-2 gap-4">

        {/* Value prop */}
        <ProfileCard
          icon={<span className="text-base">💡</span>}
          title="Value Proposition"
        >
          <InlineEditTextarea
            value={onboarding.value_proposition}
            placeholder="What makes you different from the competition?"
            className="text-[13px] text-foreground leading-relaxed"
            onChange={(v) => onTextChange('value_proposition', v)}
          />
        </ProfileCard>

        {/* Pain points */}
        <ProfileCard
          icon={<span className="text-base">🩹</span>}
          title="Pain Points Solved"
        >
          <InlineEditTextarea
            value={onboarding.pain_points}
            placeholder="What frustrations do your customers have before finding you?"
            className="text-[13px] text-foreground leading-relaxed"
            onChange={(v) => onTextChange('pain_points', v)}
          />
        </ProfileCard>
      </div>

      {/* ── ICP card ── */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-[13px] font-semibold text-foreground">Ideal Customer Profile</h3>
        </div>

        {/* Target customer description */}
        <InlineEditTextarea
          value={onboarding.target_customer}
          placeholder="Describe your ideal customer…"
          className="text-[13px] text-muted-foreground leading-relaxed"
          onChange={(v) => onTextChange('target_customer', v)}
        />

        {/* Tag groups */}
        <div className="space-y-3 pt-1">
          <TagRow
            label="Industries"
            icon={<Building2 className="h-3 w-3" />}
            tags={onboarding.industries}
            color="primary"
            onChange={(v) => onListChange('industries', v)}
          />
          <TagRow
            label="Job Titles"
            icon={<Users className="h-3 w-3" />}
            tags={onboarding.titles}
            color="success"
            onChange={(v) => onListChange('titles', v)}
          />
          <TagRow
            label="Company Sizes"
            icon={<Building2 className="h-3 w-3" />}
            tags={onboarding.company_sizes}
            color="warning"
            onChange={(v) => onListChange('company_sizes', v)}
          />
          <TagRow
            label="Geographies"
            icon={<MapPin className="h-3 w-3" />}
            tags={onboarding.geos}
            color="primary"
            onChange={(v) => onListChange('geos', v)}
          />
          {onboarding.exclusions.length > 0 && (
            <TagRow
              label="Exclusions"
              icon={<X className="h-3 w-3" />}
              tags={onboarding.exclusions}
              color="danger"
              onChange={(v) => onListChange('exclusions', v)}
            />
          )}
        </div>
      </div>

      {/* ── Voice / tone card ── */}
      {onboarding.voice_guidelines && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-base">🎙️</span>
            <h3 className="text-[13px] font-semibold text-foreground">Voice & Tone</h3>
          </div>
          <InlineEditText
            value={onboarding.voice_guidelines}
            placeholder="e.g. Direct, specific, founder-level"
            className="text-[13px] text-muted-foreground"
            onChange={(v) => onTextChange('voice_guidelines', v)}
          />
        </div>
      )}

      {/* ── Empty state prompt ── */}
      {!hasProduct && (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center">
          <Building2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-semibold text-foreground">No profile yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Complete the onboarding to populate your company profile.
          </p>
        </div>
      )}

      {/* ── Company knowledge ── */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
          <div className="flex items-start gap-3">
            <Building2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-foreground">Company Background</p>
                {companyChunks > 0 && (
                  <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-text">
                    {companyChunks} chunks indexed
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                Company story, products, team, differentiators. Used by the agent in every campaign.
              </p>
            </div>
          </div>
          {companyChunks > 0 && (
            <button
              type="button"
              disabled={deleting}
              onClick={() => void onDelete()}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-danger-subtle hover:text-danger-text disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {deleting ? 'Clearing…' : 'Clear'}
            </button>
          )}
        </div>
        {uploadError && (
          <div className="flex items-center justify-between gap-3 border-b border-border bg-danger-subtle px-5 py-2.5">
            <p className="text-[12px] text-danger-text">{uploadError}</p>
            <button type="button" onClick={onClearError}><X className="h-3.5 w-3.5 text-danger-text/60" /></button>
          </div>
        )}
        <KnowledgeUploader
          title="Company Background"
          uploading={uploading}
          deleting={deleting}
          dragOver={dragOver}
          onSetDragOver={onSetDragOver}
          onFileUpload={onFileUpload}
          onTextUpload={onTextUpload}
        />
      </div>

      {/* ── Save bar ── */}
      {onboardingDirty && (
        <div className="sticky bottom-0 flex items-center justify-between rounded-xl border border-border bg-card/95 px-4 py-3 backdrop-blur shadow-lg">
          <p className="text-[12px] text-muted-foreground">You have unsaved changes</p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void onSave()}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />Saving…</>
            ) : (
              <><Check className="h-3.5 w-3.5" />Save changes</>
            )}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Inline edit components ───────────────────────────────────────────────────

function InlineEditText({ value, placeholder, className, onChange }: {
  value: string
  placeholder: string
  className?: string
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`w-full rounded-md border border-primary/40 bg-primary/5 px-2 py-0.5 outline-none ring-2 ring-primary/20 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-secondary/60 ${className}`}
    >
      <span className={value ? '' : 'text-muted-foreground italic'}>{value || placeholder}</span>
      <Pencil className="ml-1 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  )
}

function InlineEditTextarea({ value, placeholder, className, onChange }: {
  value: string
  placeholder: string
  className?: string
  onChange: (v: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => { if (editing) { textareaRef.current?.focus(); textareaRef.current?.select() } }, [editing])

  function commit() {
    setEditing(false)
    if (draft !== value) onChange(draft)
  }

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        rows={3}
        className={`w-full resize-none rounded-md border border-primary/40 bg-primary/5 px-2 py-1 outline-none ring-2 ring-primary/20 ${className}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(value); setEditing(false) } }}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`group flex w-full items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-secondary/60 ${className}`}
    >
      <span className={`flex-1 whitespace-pre-wrap ${value ? '' : 'text-muted-foreground italic'}`}>
        {value || placeholder}
      </span>
      <Pencil className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  )
}

// ─── Tag row with inline edit ─────────────────────────────────────────────────

type TagColor = 'primary' | 'success' | 'warning' | 'danger'

const tagStyles: Record<TagColor, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success-subtle text-success-text',
  warning: 'bg-warning-subtle text-warning-text',
  danger:  'bg-danger-subtle text-danger-text',
}

function TagRow({ label, icon, tags, color, onChange }: {
  label: string
  icon: React.ReactNode
  tags: string[]
  color: TagColor
  onChange: (csv: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(tags.join(', '))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setDraft(tags.join(', ')) }, [tags])
  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])

  function commit() {
    setEditing(false)
    onChange(draft)
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex items-center gap-1.5 w-28 shrink-0 pt-0.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      {editing ? (
        <input
          ref={inputRef}
          className="flex-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-0.5 text-[12px] outline-none ring-2 ring-primary/20"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(tags.join(', ')); setEditing(false) } }}
          placeholder={`Comma-separated ${label.toLowerCase()}…`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="group flex flex-1 flex-wrap items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-secondary/50"
        >
          {tags.length > 0 ? (
            <>
              {tags.map((tag) => (
                <span key={tag} className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${tagStyles[color]}`}>
                  {tag}
                </span>
              ))}
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-60" />
            </>
          ) : (
            <span className="text-[12px] italic text-muted-foreground">Click to add {label.toLowerCase()}…</span>
          )}
        </button>
      )}
    </div>
  )
}

// ─── Profile card wrapper ─────────────────────────────────────────────────────

function ProfileCard({ icon, title, children }: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  )
}

// ─── Shared knowledge uploader (used by both Profile + Playbooks pages) ───────

export function KnowledgeUploader({
  title, uploading, deleting, dragOver,
  onSetDragOver, onFileUpload, onTextUpload,
}: {
  title: string
  uploading: boolean
  deleting: boolean
  dragOver: boolean
  onSetDragOver: (v: boolean) => void
  onFileUpload: (file: File) => Promise<void>
  onTextUpload: (text: string) => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const busy = uploading || deleting

  return (
    <div className="p-5 space-y-3">
      {!pasteMode ? (
        <>
          <div
            className={`flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed p-7 transition-all ${
              dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-secondary/30'
            } ${busy ? 'pointer-events-none opacity-50' : ''}`}
            onDragOver={(e) => { e.preventDefault(); onSetDragOver(true) }}
            onDragLeave={() => onSetDragOver(false)}
            onDrop={(e) => { e.preventDefault(); onSetDragOver(false); const f = e.dataTransfer.files[0]; if (f) void onFileUpload(f) }}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <>
                <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                <p className="text-[12px] text-muted-foreground">Processing document…</p>
              </>
            ) : (
              <>
                <Upload className="h-5 w-5 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-[13px] font-medium text-foreground">Drop a file or click to upload</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">TXT, MD, PDF — up to 2MB</p>
                </div>
              </>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".txt,.md,.pdf,.csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFileUpload(f); e.target.value = '' }} />
          <button type="button" onClick={() => setPasteMode(true)}
            className="w-full py-1 text-center text-[12px] text-muted-foreground transition hover:text-foreground">
            Or paste text directly →
          </button>
        </>
      ) : (
        <>
          <Textarea
            className="h-32 resize-none text-[12px]"
            placeholder={`Paste your ${title.toLowerCase()} content here…`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            disabled={busy}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => { setPasteMode(false); setPasteText('') }}>Cancel</Button>
            <Button size="sm" disabled={!pasteText.trim() || uploading}
              onClick={() => void (async () => { if (!pasteText.trim()) return; await onTextUpload(pasteText); setPasteText(''); setPasteMode(false) })()}>
              {uploading ? 'Processing…' : 'Upload text'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
