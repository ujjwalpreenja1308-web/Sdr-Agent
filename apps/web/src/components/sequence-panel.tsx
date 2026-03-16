import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Mail, Plus, Trash2, Users, Zap } from 'lucide-react'
import {
  createSequence,
  deleteSequence,
  deleteSequenceStep,
  enrollInSequence,
  getSequenceEnrollments,
  getSequences,
  getSequence,
  pauseEnrollment,
  resumeEnrollment,
  triggerSequenceTick,
  updateSequence,
  updateSequenceStep,
  addSequenceStep,
  type SequenceSummary,
  type SequenceWithSteps,
  type SequenceStep,
  type SequenceEnrollmentWithContact,
  type PipelineSnapshot,
} from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const STEP_TYPE_LABELS: Record<string, string> = {
  icebreaker: 'Ice Breaker',
  follow_up: 'Follow-Up',
  breakup: 'Breakup',
}

const STEP_TYPE_COLORS: Record<string, string> = {
  icebreaker: 'bg-blue-500/10 text-blue-600 border-blue-200',
  follow_up: 'bg-amber-500/10 text-amber-600 border-amber-200',
  breakup: 'bg-red-500/10 text-red-600 border-red-200',
}

const ENROLLMENT_STATUS_COLORS: Record<string, string> = {
  active: 'bg-success/10 text-success border-success/20',
  paused: 'bg-muted text-muted-foreground border-border',
  completed: 'bg-primary/10 text-primary border-primary/20',
  replied: 'bg-blue-500/10 text-blue-600 border-blue-200',
  bounced: 'bg-red-500/10 text-red-600 border-red-200',
  unsubscribed: 'bg-muted text-muted-foreground border-border',
}

function StepTypeBadge({ type }: { type: string }) {
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${STEP_TYPE_COLORS[type] ?? 'bg-muted text-muted-foreground border-border'}`}>
      {STEP_TYPE_LABELS[type] ?? type}
    </span>
  )
}

// ─── Step Editor ─────────────────────────────────────────────────────────────

function StepEditor({
  step,
  isFirst,
  onUpdate,
  onDelete,
}: {
  step: SequenceStep
  isFirst: boolean
  onUpdate: (stepId: string, field: string, value: string | number) => void
  onDelete: (stepId: string) => void
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center gap-3 text-left"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-muted-foreground">
            {step.position + 1}
          </span>
          <StepTypeBadge type={step.step_type} />
          {!isFirst && (
            <span className="text-xs text-muted-foreground">
              +{step.delay_days}d
            </span>
          )}
          <span className="flex-1 truncate text-xs text-muted-foreground">
            {step.subject_template || 'No subject'}
          </span>
          {expanded
            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        </button>
        <button
          type="button"
          onClick={() => onDelete(step.id)}
          className="rounded p-1 text-muted-foreground hover:text-red-500 hover:bg-red-50 transition-colors"
          title="Delete step"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="space-y-3 border-t border-border px-4 pb-4 pt-3">
          {/* Step type + delay row */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Type</label>
              <select
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                value={step.step_type}
                onChange={(e) => onUpdate(step.id, 'step_type', e.target.value)}
              >
                <option value="icebreaker">Ice Breaker</option>
                <option value="follow_up">Follow-Up</option>
                <option value="breakup">Breakup</option>
              </select>
            </div>
            {!isFirst && (
              <div className="w-28">
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Delay (days)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                  value={step.delay_days}
                  onChange={(e) => onUpdate(step.id, 'delay_days', parseInt(e.target.value, 10) || 1)}
                />
              </div>
            )}
          </div>

          {/* Subject */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Subject <span className="font-normal opacity-60">— use {'{{firstName}}'}, {'{{company}}'}, {'{{senderName}}'}</span>
            </label>
            <input
              type="text"
              className="h-8 w-full rounded-md border border-border bg-background px-3 text-xs"
              value={step.subject_template}
              onChange={(e) => onUpdate(step.id, 'subject_template', e.target.value)}
              placeholder="Subject line…"
            />
          </div>

          {/* Body */}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Body</label>
            <textarea
              rows={6}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs leading-relaxed resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              value={step.body_template}
              onChange={(e) => onUpdate(step.id, 'body_template', e.target.value)}
              placeholder="Email body…"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Enroll Modal ────────────────────────────────────────────────────────────

function EnrollModal({
  pipeline,
  onEnroll,
  onClose,
}: {
  pipeline: PipelineSnapshot | null
  onEnroll: (contactIds: string[]) => Promise<void>
  onClose: () => void
}) {
  const contacts = pipeline?.contacts ?? []
  const eligible = contacts.filter(
    (c) => c.status === 'approved_to_launch' || c.status === 'ready_for_review',
  )
  const [selected, setSelected] = useState<Set<string>>(new Set(eligible.map((c) => c.id)))
  const [busy, setBusy] = useState(false)

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleEnroll() {
    if (selected.size === 0) return
    setBusy(true)
    await onEnroll([...selected])
    setBusy(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold">Enroll contacts</h3>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground text-sm">✕</button>
        </div>

        <div className="max-h-72 overflow-y-auto px-5 py-3">
          {eligible.length === 0 ? (
            <p className="py-4 text-center text-xs text-muted-foreground">
              No approved contacts found. Approve contacts in the Pipeline tab first.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {eligible.map((c) => (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-secondary">
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="h-3.5 w-3.5 accent-primary"
                    />
                    <span className="flex-1 text-xs">
                      <span className="font-medium">{c.full_name}</span>
                      <span className="ml-1.5 text-muted-foreground">{c.company}</span>
                    </span>
                    <span className="text-[10px] text-muted-foreground">{c.email}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <span className="text-xs text-muted-foreground">{selected.size} selected</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
            <Button size="sm" disabled={selected.size === 0 || busy} onClick={handleEnroll}>
              {busy ? 'Enrolling…' : `Enroll ${selected.size}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Create Sequence Modal ────────────────────────────────────────────────────

function CreateSequenceModal({
  onConfirm,
  onClose,
}: {
  onConfirm: (name: string, description: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)

  async function handleSubmit() {
    if (!name.trim()) return
    setBusy(true)
    await onConfirm(name.trim(), description.trim())
    setBusy(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h3 className="text-sm font-semibold">New sequence</h3>
        </div>
        <div className="space-y-3 px-5 py-4">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              type="text"
              className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm"
              placeholder="e.g. Cold outreach — SaaS CTOs"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">Description (optional)</label>
            <input
              type="text"
              className="h-8 w-full rounded-md border border-border bg-background px-3 text-sm"
              placeholder="Short note about this sequence…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!name.trim() || busy} onClick={handleSubmit}>
            {busy ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Enrollment Row ───────────────────────────────────────────────────────────

function EnrollmentRow({
  enrollment,
  sequenceId,
  workspaceId,
  onRefresh,
}: {
  enrollment: SequenceEnrollmentWithContact
  sequenceId: string
  workspaceId: string
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState(false)

  async function toggle() {
    setBusy(true)
    if (enrollment.status === 'active') {
      await pauseEnrollment(workspaceId, sequenceId, enrollment.id)
    } else if (enrollment.status === 'paused') {
      await resumeEnrollment(workspaceId, sequenceId, enrollment.id)
    }
    onRefresh()
    setBusy(false)
  }

  const nextSend = enrollment.next_send_at
    ? new Date(enrollment.next_send_at).toLocaleDateString()
    : enrollment.status === 'active' ? 'Next tick' : '—'

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="truncate text-xs font-medium">{enrollment.contact_name || enrollment.contact_email}</p>
        <p className="truncate text-[11px] text-muted-foreground">{enrollment.contact_company}</p>
      </div>
      <span className={`inline-flex shrink-0 items-center rounded border px-2 py-0.5 text-[11px] font-medium ${ENROLLMENT_STATUS_COLORS[enrollment.status] ?? ''}`}>
        {enrollment.status}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground w-20 text-right">{nextSend}</span>
      {(enrollment.status === 'active' || enrollment.status === 'paused') && (
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px] shrink-0"
          disabled={busy}
          onClick={toggle}
        >
          {enrollment.status === 'active' ? 'Pause' : 'Resume'}
        </Button>
      )}
    </div>
  )
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function SequencePanel({
  workspaceId,
  pipeline,
}: {
  workspaceId: string
  pipeline: PipelineSnapshot | null
}) {
  const [sequences, setSequences] = useState<SequenceSummary[]>([])
  const [selected, setSelected] = useState<SequenceWithSteps | null>(null)
  const [enrollments, setEnrollments] = useState<SequenceEnrollmentWithContact[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showEnroll, setShowEnroll] = useState(false)
  const [activeView, setActiveView] = useState<'steps' | 'enrollments'>('steps')
  const [tickResult, setTickResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadSequences = useCallback(async () => {
    try {
      const data = await getSequences(workspaceId)
      setSequences(data)
    } catch {
      setError('Failed to load sequences')
    }
  }, [workspaceId])

  const loadSelected = useCallback(async (seq: SequenceSummary) => {
    const full = await getSequence(workspaceId, seq.id)
    setSelected(full)
    const envs = await getSequenceEnrollments(workspaceId, seq.id)
    setEnrollments(envs)
  }, [workspaceId])

  useEffect(() => {
    void loadSequences()
  }, [loadSequences])

  async function handleCreate(name: string, description: string) {
    const seq = await createSequence(workspaceId, {
      name,
      description,
      // Seed with the three canonical step types
      steps: [
        {
          step_type: 'icebreaker',
          delay_days: 0,
          subject_template: 'Quick question for {{firstName}} at {{company}}',
          body_template: `Hi {{firstName}},\n\nI came across {{company}} and had a quick question — are you the right person to chat with about [your use case]?\n\nWe help [type of company] achieve [specific outcome] without [common pain point].\n\nWorth a 15-minute call this week?\n\n{{senderName}}`,
        },
        {
          step_type: 'follow_up',
          delay_days: 3,
          subject_template: 'Re: Quick question for {{firstName}} at {{company}}',
          body_template: `Hi {{firstName}},\n\nJust bumping this in case it got lost — did you get a chance to see my last note?\n\nHappy to keep it brief. Would love to share how we've helped similar companies like {{company}}.\n\n{{senderName}}`,
        },
        {
          step_type: 'breakup',
          delay_days: 5,
          subject_template: 'Should I close this out?',
          body_template: `Hi {{firstName}},\n\nI've reached out a couple of times without hearing back, so I'll assume the timing isn't right.\n\nIf anything changes, feel free to ping me — happy to pick this back up.\n\n{{senderName}}`,
        },
      ],
    })
    await loadSequences()
    setSelected(seq)
    setEnrollments([])
    setActiveView('steps')
  }

  async function handleStepUpdate(stepId: string, field: string, value: string | number) {
    if (!selected) return
    await updateSequenceStep(workspaceId, selected.id, stepId, { [field]: value })
    const refreshed = await getSequence(workspaceId, selected.id)
    setSelected(refreshed)
  }

  async function handleStepDelete(stepId: string) {
    if (!selected) return
    await deleteSequenceStep(workspaceId, selected.id, stepId)
    const refreshed = await getSequence(workspaceId, selected.id)
    setSelected(refreshed)
    await loadSequences()
  }

  async function handleAddStep() {
    if (!selected) return
    await addSequenceStep(workspaceId, selected.id, { step_type: 'follow_up', delay_days: 3 })
    const refreshed = await getSequence(workspaceId, selected.id)
    setSelected(refreshed)
    await loadSequences()
  }

  async function handleToggleActive() {
    if (!selected) return
    const nextStatus = selected.status === 'active' ? 'draft' : 'active'
    await updateSequence(workspaceId, selected.id, { status: nextStatus })
    await loadSequences()
    const refreshed = await getSequence(workspaceId, selected.id)
    setSelected(refreshed)
  }

  async function handleDelete() {
    if (!selected) return
    if (!confirm(`Delete "${selected.name}"? This will remove all enrollments.`)) return
    await deleteSequence(workspaceId, selected.id)
    setSelected(null)
    setEnrollments([])
    await loadSequences()
  }

  async function handleEnroll(contactIds: string[]) {
    if (!selected) return
    await enrollInSequence(workspaceId, selected.id, contactIds)
    const envs = await getSequenceEnrollments(workspaceId, selected.id)
    setEnrollments(envs)
    await loadSequences()
  }

  async function handleTick() {
    setBusy(true)
    setTickResult(null)
    try {
      const result = await triggerSequenceTick(workspaceId)
      setTickResult(`Sent ${result.emails_sent} email(s), completed ${result.enrollments_completed} enrollment(s).`)
      // Refresh enrollments if viewing
      if (selected) {
        const envs = await getSequenceEnrollments(workspaceId, selected.id)
        setEnrollments(envs)
        await loadSequences()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Tick failed')
    } finally {
      setBusy(false)
    }
  }

  const selectedSummary = sequences.find((s) => s.id === selected?.id)

  return (
    <div className="flex h-full gap-4 overflow-hidden">
      {/* ── Left: sequence list ── */}
      <div className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto">
        <Button size="sm" className="w-full gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" /> New sequence
        </Button>

        {sequences.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <Mail className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">No sequences yet</p>
          </div>
        ) : (
          sequences.map((seq) => (
            <button
              key={seq.id}
              type="button"
              onClick={() => loadSelected(seq)}
              className={`w-full rounded-xl border text-left px-4 py-3 transition-colors ${
                selected?.id === seq.id
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border bg-card hover:bg-secondary'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="truncate text-xs font-medium">{seq.name}</p>
                <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                  seq.status === 'active'
                    ? 'bg-success/10 text-success border-success/20'
                    : seq.status === 'archived'
                    ? 'bg-muted text-muted-foreground border-border'
                    : 'bg-amber-500/10 text-amber-600 border-amber-200'
                }`}>
                  {seq.status}
                </span>
              </div>
              <div className="mt-1.5 flex gap-3 text-[11px] text-muted-foreground">
                <span>{seq.step_count} steps</span>
                <span>{seq.stats.total_enrolled} enrolled</span>
                <span>{seq.stats.total_sent} sent</span>
              </div>
            </button>
          ))
        )}

        {/* Manual tick trigger */}
        <div className="mt-auto pt-2">
          <Button
            size="sm"
            variant="outline"
            className="w-full gap-2 text-xs"
            disabled={busy}
            onClick={handleTick}
          >
            <Zap className="h-3 w-3" />
            {busy ? 'Running…' : 'Run tick now'}
          </Button>
          {tickResult && (
            <p className="mt-1.5 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-[11px] text-success">
              {tickResult}
            </p>
          )}
        </div>
      </div>

      {/* ── Right: sequence detail ── */}
      {selected ? (
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-center gap-3">
            <div className="flex-1 min-w-0">
              <h2 className="truncate text-sm font-semibold">{selected.name}</h2>
              {selected.description && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{selected.description}</p>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => { setShowEnroll(true); setActiveView('enrollments') }}
              >
                <Users className="h-3.5 w-3.5" /> Enroll
              </Button>
              <Button
                size="sm"
                variant={selected.status === 'active' ? 'outline' : 'default'}
                onClick={handleToggleActive}
              >
                {selected.status === 'active' ? 'Pause' : 'Activate'}
              </Button>
              <Button size="sm" variant="outline" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={handleDelete}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Stats row */}
          {selectedSummary && (
            <div className="flex shrink-0 gap-3">
              {[
                { label: 'Enrolled', value: selectedSummary.stats.total_enrolled },
                { label: 'Active', value: selectedSummary.stats.active },
                { label: 'Replied', value: selectedSummary.stats.replied },
                { label: 'Completed', value: selectedSummary.stats.completed },
                { label: 'Sent', value: selectedSummary.stats.total_sent },
              ].map(({ label, value }) => (
                <div key={label} className="flex-1 rounded-xl border border-border bg-card px-3 py-2.5 text-center">
                  <p className="text-lg font-semibold">{value}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Sub-tabs */}
          <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-card p-1 w-fit">
            {(['steps', 'enrollments'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setActiveView(v)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                  activeView === v
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeView === 'steps' ? (
              <div className="space-y-3 pb-4">
                {selected.steps.map((step) => (
                  <StepEditor
                    key={step.id}
                    step={step}
                    isFirst={step.position === 0}
                    onUpdate={handleStepUpdate}
                    onDelete={handleStepDelete}
                  />
                ))}
                <Button size="sm" variant="outline" className="w-full gap-2" onClick={handleAddStep}>
                  <Plus className="h-3.5 w-3.5" /> Add step
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5 pb-4">
                {enrollments.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-10 text-center">
                    <Users className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">No contacts enrolled yet</p>
                    <Button size="sm" className="mt-3" onClick={() => setShowEnroll(true)}>
                      Enroll contacts
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="mb-1 flex items-center justify-between px-1">
                      <p className="text-[11px] font-medium text-muted-foreground">{enrollments.length} enrollment(s)</p>
                    </div>
                    {enrollments.map((e) => (
                      <EnrollmentRow
                        key={e.id}
                        enrollment={e}
                        sequenceId={selected.id}
                        workspaceId={workspaceId}
                        onRefresh={async () => {
                          const envs = await getSequenceEnrollments(workspaceId, selected.id)
                          setEnrollments(envs)
                        }}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <Mail className="mx-auto mb-3 h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm font-medium text-muted-foreground">Select a sequence</p>
            <p className="mt-0.5 text-xs text-muted-foreground">or create a new one to get started</p>
          </div>
        </div>
      )}

      {error && (
        <div className="fixed bottom-4 right-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-600 shadow-lg">
          {error}
          <button type="button" className="ml-3 font-medium" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {showCreate && (
        <CreateSequenceModal
          onConfirm={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {showEnroll && selected && (
        <EnrollModal
          pipeline={pipeline}
          onEnroll={handleEnroll}
          onClose={() => setShowEnroll(false)}
        />
      )}
    </div>
  )
}
