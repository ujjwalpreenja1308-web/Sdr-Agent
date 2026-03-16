import { BookOpen, FileText, Lightbulb, MessageSquare, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import { deleteKnowledge, getKnowledgeStatus, uploadKnowledge } from '../lib/api'
import { KnowledgeUploader } from './company-profile-panel'

type PlaybooksPanelProps = {
  workspaceId: string
}

type PlaybookType = {
  id: 'playbooks'
  title: string
  description: string
  icon: React.ReactNode
  examples: string[]
}

const PLAYBOOK_TYPES: PlaybookType[] = [
  {
    id: 'playbooks',
    title: 'Sales Playbooks',
    description: 'Winning sequences, objection handling scripts, proven email frameworks, and messaging guides. The agent uses this to write better copy and handle replies intelligently.',
    icon: <BookOpen className="h-5 w-5 text-primary" />,
    examples: [
      'Cold email frameworks that convert',
      'Common objections & responses',
      'Champion letters & follow-up cadences',
      'Win/loss analysis notes',
    ],
  },
]

export function PlaybooksPanel({ workspaceId }: PlaybooksPanelProps) {
  const [chunkCount, setChunkCount] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const result = await getKnowledgeStatus(workspaceId)
      const count = result.pipelines.find((p) => p.pipeline === 'playbooks')?.chunk_count ?? 0
      setChunkCount(count)
    } catch { /* ignore */ }
  }, [workspaceId])

  useEffect(() => { void loadStatus() }, [loadStatus])

  async function handleFileUpload(file: File) {
    setUploading(true)
    setError(null)
    try {
      const text = await file.text()
      await uploadKnowledge(workspaceId, 'playbooks', text)
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally { setUploading(false) }
  }

  async function handleTextUpload(text: string) {
    if (!text.trim()) return
    setUploading(true)
    setError(null)
    try {
      await uploadKnowledge(workspaceId, 'playbooks', text)
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.')
    } finally { setUploading(false) }
  }

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      await deleteKnowledge(workspaceId, 'playbooks')
      await loadStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.')
    } finally { setDeleting(false) }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-6 space-y-6">

        {/* Header */}
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <BookOpen className="h-4.5 w-4.5 text-primary" />
            </div>
            <h1 className="text-lg font-bold text-foreground">Playbooks</h1>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed pl-12">
            Upload your best sales content — email frameworks, objection scripts, winning sequences.
            The agent reads these to write sharper copy and smarter replies.
          </p>
        </div>

        {/* What to upload */}
        <div className="grid grid-cols-2 gap-3">
          {[
            { icon: <FileText className="h-4 w-4 text-primary" />, label: 'Email sequences', hint: 'Your best-performing cold email cadences' },
            { icon: <MessageSquare className="h-4 w-4 text-success" />, label: 'Objection handling', hint: 'Scripts for common pushbacks' },
            { icon: <Lightbulb className="h-4 w-4 text-warning" />, label: 'Messaging frameworks', hint: 'SPIN, PAS, value prop templates' },
            { icon: <BookOpen className="h-4 w-4 text-muted-foreground" />, label: 'Win/loss notes', hint: 'What worked, what didn\'t' },
          ].map(({ icon, label, hint }) => (
            <div key={label} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
                {icon}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground">{label}</p>
                <p className="text-[11px] text-muted-foreground">{hint}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Upload card */}
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-border">
            <div className="flex items-start gap-3">
              <BookOpen className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-semibold text-foreground">Sales Playbooks</p>
                  {chunkCount > 0 && (
                    <span className="rounded-full bg-success-subtle px-2 py-0.5 text-[10px] font-semibold text-success-text">
                      {chunkCount} chunks indexed
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Paste or upload any sales content — the agent will learn from it automatically.
                </p>
              </div>
            </div>
            {chunkCount > 0 && (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition hover:bg-danger-subtle hover:text-danger-text disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {deleting ? 'Clearing…' : 'Clear all'}
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center justify-between gap-3 border-b border-border bg-danger-subtle px-5 py-2.5">
              <p className="text-[12px] text-danger-text">{error}</p>
              <button type="button" onClick={() => setError(null)}>
                <X className="h-3.5 w-3.5 text-danger-text/60" />
              </button>
            </div>
          )}

          <KnowledgeUploader
            title="Sales Playbooks"
            uploading={uploading}
            deleting={deleting}
            dragOver={dragOver}
            onSetDragOver={setDragOver}
            onFileUpload={handleFileUpload}
            onTextUpload={handleTextUpload}
          />
        </div>

        {/* Empty indexed state tip */}
        {chunkCount === 0 && (
          <div className="rounded-xl border border-dashed border-border px-5 py-5 text-center">
            <p className="text-[12px] text-muted-foreground">
              Nothing uploaded yet. The agent will use generic best practices until you add your playbooks.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
