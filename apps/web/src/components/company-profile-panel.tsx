import { BookOpen, Building2, Edit3, FileText, Settings, Trash2, Upload, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { KnowledgeStatus, OnboardingProfile, WorkspaceSummary } from '../lib/api'
import { deleteKnowledge, getKnowledgeStatus, uploadKnowledge } from '../lib/api'
import type { OnboardingListField, OnboardingTextField } from '../lib/onboarding'
import { calculateOnboardingProgress } from '../lib/onboarding'
import { Button } from './ui/button'
import { Input } from './ui/input'
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

type Section = 'profile' | 'knowledge'

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
  const [section, setSection] = useState<Section>('profile')
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

  useEffect(() => {
    if (section === 'knowledge') {
      void loadKnowledgeStatus()
    }
  }, [section, loadKnowledgeStatus])

  async function handleFileUpload(pipeline: 'playbooks' | 'company', file: File) {
    setUploading(pipeline)
    setUploadError(null)
    try {
      const text = await file.text()
      await uploadKnowledge(workspace.id, pipeline, text)
      await loadKnowledgeStatus()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(null)
    }
  }

  async function handleTextUpload(pipeline: 'playbooks' | 'company', text: string) {
    if (!text.trim()) return
    setUploading(pipeline)
    setUploadError(null)
    try {
      await uploadKnowledge(workspace.id, pipeline, text)
      await loadKnowledgeStatus()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(null)
    }
  }

  async function handleDelete(pipeline: 'playbooks' | 'company') {
    setDeleting(pipeline)
    setUploadError(null)
    try {
      await deleteKnowledge(workspace.id, pipeline)
      await loadKnowledgeStatus()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setDeleting(null)
    }
  }

  const companyChunks = knowledgeStatus?.find((s) => s.pipeline === 'company')?.chunk_count ?? 0
  const playbookChunks = knowledgeStatus?.find((s) => s.pipeline === 'playbooks')?.chunk_count ?? 0

  return (
    <div className="flex h-full flex-col gap-0 overflow-hidden">
      {/* Section switcher */}
      <div className="flex shrink-0 items-center gap-1 pb-4">
        <button
          type="button"
          onClick={() => setSection('profile')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            section === 'profile'
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
          }`}
        >
          <Building2 className="h-3.5 w-3.5" />
          Profile
        </button>
        <button
          type="button"
          onClick={() => setSection('knowledge')}
          className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
            section === 'knowledge'
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
          }`}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Knowledge Base
          {(companyChunks + playbookChunks) > 0 && (
            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
              {companyChunks + playbookChunks}
            </span>
          )}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{completion}% complete</span>
          <Button
            size="sm"
            variant="ghost"
            className="gap-1.5 text-xs"
            onClick={() => onTabChange('onboarding')}
          >
            <Edit3 className="h-3 w-3" />
            Edit wizard
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {section === 'profile' && (
          <ProfileSection
            onboarding={onboarding}
            onboardingDirty={onboardingDirty}
            saving={saving}
            onListChange={onListChange}
            onSave={onSave}
            onTextChange={onTextChange}
          />
        )}

        {section === 'knowledge' && (
          <KnowledgeSection
            companyChunks={companyChunks}
            playbookChunks={playbookChunks}
            uploading={uploading}
            deleting={deleting}
            dragOver={dragOver}
            error={uploadError}
            onSetDragOver={setDragOver}
            onFileUpload={handleFileUpload}
            onTextUpload={handleTextUpload}
            onDelete={handleDelete}
            onClearError={() => setUploadError(null)}
          />
        )}
      </div>
    </div>
  )
}

function ProfileSection({
  onboarding,
  onboardingDirty,
  saving,
  onListChange,
  onSave,
  onTextChange,
}: {
  onboarding: OnboardingProfile
  onboardingDirty: boolean
  saving: boolean
  onListChange: (field: OnboardingListField, value: string) => void
  onSave: () => Promise<void>
  onTextChange: (field: OnboardingTextField, value: string) => void
}) {
  return (
    <div className="mx-auto max-w-xl space-y-8 pb-6">
      {/* Company */}
      <div>
        <SectionHeader icon={Building2} title="Company" />
        <div className="mt-4 space-y-4">
          <Field label="Product name">
            <Input
              value={onboarding.product_name}
              onChange={(e) => onTextChange('product_name', e.target.value)}
              placeholder="Acme Inc."
            />
          </Field>
          <Field label="Product description">
            <Textarea
              className="h-24 resize-none"
              value={onboarding.product_description}
              onChange={(e) => onTextChange('product_description', e.target.value)}
              placeholder="AI-powered outbound platform..."
            />
          </Field>
          <Field label="Call to action">
            <Input
              value={onboarding.call_to_action}
              onChange={(e) => onTextChange('call_to_action', e.target.value)}
              placeholder="Book a 20-minute growth session"
            />
          </Field>
        </div>
      </div>

      {/* Messaging */}
      <div>
        <SectionHeader icon={FileText} title="Messaging" />
        <div className="mt-4 space-y-4">
          <Field label="Value proposition">
            <Textarea
              className="h-24 resize-none"
              value={onboarding.value_proposition}
              onChange={(e) => onTextChange('value_proposition', e.target.value)}
              placeholder="We replace founder-led outbound..."
            />
          </Field>
          <Field label="Pain points">
            <Textarea
              className="h-24 resize-none"
              value={onboarding.pain_points}
              onChange={(e) => onTextChange('pain_points', e.target.value)}
              placeholder="Outbound depends on the founder..."
            />
          </Field>
          <Field label="Voice guidelines">
            <Input
              value={onboarding.voice_guidelines}
              onChange={(e) => onTextChange('voice_guidelines', e.target.value)}
              placeholder="Direct, specific, founder-level"
            />
          </Field>
        </div>
      </div>

      {/* ICP */}
      <div>
        <SectionHeader icon={Settings} title="Ideal customer" />
        <div className="mt-4 space-y-4">
          <Field label="Target customer">
            <Textarea
              className="h-24 resize-none"
              value={onboarding.target_customer}
              onChange={(e) => onTextChange('target_customer', e.target.value)}
              placeholder="B2B SaaS founders..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Industries">
              <Input
                value={onboarding.industries.join(', ')}
                onChange={(e) => onListChange('industries', e.target.value)}
                placeholder="B2B SaaS, devtools"
              />
            </Field>
            <Field label="Job titles">
              <Input
                value={onboarding.titles.join(', ')}
                onChange={(e) => onListChange('titles', e.target.value)}
                placeholder="Founder, CEO, VP Sales"
              />
            </Field>
            <Field label="Company sizes">
              <Input
                value={onboarding.company_sizes.join(', ')}
                onChange={(e) => onListChange('company_sizes', e.target.value)}
                placeholder="2-30, 31-100"
              />
            </Field>
            <Field label="Geographies">
              <Input
                value={onboarding.geos.join(', ')}
                onChange={(e) => onListChange('geos', e.target.value)}
                placeholder="United States, Canada"
              />
            </Field>
          </div>
          <Field label="Exclusions">
            <Input
              value={onboarding.exclusions.join(', ')}
              onChange={(e) => onListChange('exclusions', e.target.value)}
              placeholder="Agencies, enterprise-only teams"
            />
          </Field>
        </div>
      </div>

      {/* Save bar */}
      {onboardingDirty && (
        <div className="sticky bottom-0 flex justify-end border-t border-border bg-background pt-3">
          <Button size="sm" disabled={saving} onClick={() => void onSave()}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      )}
    </div>
  )
}

function KnowledgeSection({
  companyChunks,
  playbookChunks,
  uploading,
  deleting,
  dragOver,
  error,
  onSetDragOver,
  onFileUpload,
  onTextUpload,
  onDelete,
  onClearError,
}: {
  companyChunks: number
  playbookChunks: number
  uploading: string | null
  deleting: string | null
  dragOver: string | null
  error: string | null
  onSetDragOver: (v: string | null) => void
  onFileUpload: (pipeline: 'playbooks' | 'company', file: File) => Promise<void>
  onTextUpload: (pipeline: 'playbooks' | 'company', text: string) => Promise<void>
  onDelete: (pipeline: 'playbooks' | 'company') => Promise<void>
  onClearError: () => void
}) {
  return (
    <div className="mx-auto max-w-xl space-y-6 pb-6">
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Upload documents to train AI agents on your company context. The agents use this knowledge when writing emails, handling replies, and planning outreach.
        </p>
      </div>

      {error && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger-text/20 bg-danger-subtle px-4 py-3">
          <p className="text-xs text-danger-text">{error}</p>
          <button type="button" onClick={onClearError}>
            <X className="h-3.5 w-3.5 text-danger-text/60" />
          </button>
        </div>
      )}

      <KnowledgePipelineCard
        title="Company Background"
        description="Company story, products, team, differentiators, case studies. Used in every agent decision."
        chunkCount={companyChunks}
        uploading={uploading === 'company'}
        deleting={deleting === 'company'}
        dragOver={dragOver === 'company'}
        onSetDragOver={(v) => onSetDragOver(v ? 'company' : null)}
        onFileUpload={(f) => onFileUpload('company', f)}
        onTextUpload={(t) => onTextUpload('company', t)}
        onDelete={() => onDelete('company')}
      />

      <KnowledgePipelineCard
        title="Sales Playbooks"
        description="Winning email sequences, objection handling, proven frameworks. Shapes copy and follow-up logic."
        chunkCount={playbookChunks}
        uploading={uploading === 'playbooks'}
        deleting={deleting === 'playbooks'}
        dragOver={dragOver === 'playbooks'}
        onSetDragOver={(v) => onSetDragOver(v ? 'playbooks' : null)}
        onFileUpload={(f) => onFileUpload('playbooks', f)}
        onTextUpload={(t) => onTextUpload('playbooks', t)}
        onDelete={() => onDelete('playbooks')}
      />
    </div>
  )
}

function KnowledgePipelineCard({
  title,
  description,
  chunkCount,
  uploading,
  deleting,
  dragOver,
  onSetDragOver,
  onFileUpload,
  onTextUpload,
  onDelete,
}: {
  title: string
  description: string
  chunkCount: number
  uploading: boolean
  deleting: boolean
  dragOver: boolean
  onSetDragOver: (v: boolean) => void
  onFileUpload: (file: File) => Promise<void>
  onTextUpload: (text: string) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [pasteMode, setPasteMode] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const busy = uploading || deleting

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    onSetDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) void onFileUpload(file)
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) void onFileUpload(file)
    e.target.value = ''
  }

  async function handlePasteSubmit() {
    if (!pasteText.trim()) return
    await onTextUpload(pasteText)
    setPasteText('')
    setPasteMode(false)
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 p-4 border-b border-border">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{title}</p>
            {chunkCount > 0 && (
              <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[10px] font-medium text-primary">
                {chunkCount} chunks
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
        {chunkCount > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 h-7 gap-1 text-xs text-muted-foreground hover:text-danger-text"
            disabled={deleting}
            onClick={() => void onDelete()}
          >
            <Trash2 className="h-3 w-3" />
            {deleting ? 'Clearing…' : 'Clear'}
          </Button>
        )}
      </div>

      {/* Upload area */}
      <div className="p-4 space-y-3">
        {!pasteMode ? (
          <>
            {/* Drop zone */}
            <div
              className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 transition-colors cursor-pointer ${
                dragOver
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-border/80 hover:bg-secondary/20'
              } ${busy ? 'pointer-events-none opacity-50' : ''}`}
              onDragOver={(e) => { e.preventDefault(); onSetDragOver(true) }}
              onDragLeave={() => onSetDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? (
                <>
                  <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  <p className="text-xs text-muted-foreground">Processing…</p>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-xs font-medium">Drop a file here or click to upload</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">TXT, MD, PDF — up to 2MB</p>
                  </div>
                </>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".txt,.md,.pdf,.csv"
              className="hidden"
              onChange={handleFileChange}
            />

            <button
              type="button"
              onClick={() => setPasteMode(true)}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
            >
              Or paste text directly →
            </button>
          </>
        ) : (
          <>
            <Textarea
              className="h-32 resize-none text-xs"
              placeholder={`Paste your ${title.toLowerCase()} content here…`}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              disabled={busy}
              autoFocus
            />
            <div className="flex justify-between gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-xs"
                onClick={() => { setPasteMode(false); setPasteText('') }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="text-xs gap-1.5"
                disabled={!pasteText.trim() || uploading}
                onClick={() => void handlePasteSubmit()}
              >
                {uploading ? (
                  <>
                    <div className="h-3 w-3 rounded-full border border-white border-t-transparent animate-spin" />
                    Processing…
                  </>
                ) : (
                  <>
                    <Upload className="h-3 w-3" />
                    Upload text
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SectionHeader({ icon: Icon, title }: { icon: typeof Building2; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  )
}
