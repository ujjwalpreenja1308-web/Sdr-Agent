import type { AdaptiveSignalType, JsonObject } from '@pipeiq/shared'

import { getSupabaseAdmin, isSupabasePersistenceEnabled } from './supabase.js'

// ─── In-memory fallback ───────────────────────────────────────────────────────

type SignalRow = {
  workspace_id: string
  signal_type: AdaptiveSignalType
  original_value: string | null
  corrected_value: string | null
  context_json: JsonObject
  created_at: string
}

const fallbackSignals = new Map<string, SignalRow[]>()

// ─── Record a new adaptive signal ─────────────────────────────────────────────

export async function recordAdaptiveSignal(params: {
  workspaceId: string
  signalType: AdaptiveSignalType
  originalValue?: string
  correctedValue?: string
  context?: JsonObject
}): Promise<void> {
  const row: SignalRow = {
    workspace_id: params.workspaceId,
    signal_type: params.signalType,
    original_value: params.originalValue ?? null,
    corrected_value: params.correctedValue ?? null,
    context_json: params.context ?? {},
    created_at: new Date().toISOString(),
  }

  // Cache in-memory
  const existing = fallbackSignals.get(params.workspaceId) ?? []
  fallbackSignals.set(params.workspaceId, [row, ...existing].slice(0, 200))

  if (!isSupabasePersistenceEnabled()) {
    return
  }

  const supabase = getSupabaseAdmin()
  const { error } = await supabase.from('adaptive_signals').insert({
    workspace_id: params.workspaceId,
    signal_type: params.signalType,
    original_value: params.originalValue ?? null,
    corrected_value: params.correctedValue ?? null,
    context_json: params.context ?? {},
  })

  if (error) {
    console.warn(`adaptive_signals insert warn: ${error.message}`)
  }
}

// ─── Build "lessons learned" prompt block ────────────────────────────────────

export async function buildAdaptiveContext(workspaceId: string): Promise<string> {
  let signals: SignalRow[] = []

  if (isSupabasePersistenceEnabled()) {
    try {
      const supabase = getSupabaseAdmin()
      const { data, error } = await supabase
        .from('adaptive_signals')
        .select('signal_type, original_value, corrected_value, context_json, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(50)

      if (!error && data) {
        signals = data as SignalRow[]
      }
    } catch {
      signals = (fallbackSignals.get(workspaceId) ?? []).slice(0, 50)
    }
  } else {
    signals = (fallbackSignals.get(workspaceId) ?? []).slice(0, 50)
  }

  if (signals.length === 0) {
    return ''
  }

  const corrections = signals.filter((s) => s.signal_type === 'reply_correction')
  const rejections = signals.filter((s) => s.signal_type === 'approval_rejection')

  const lines: string[] = ['Lessons learned from past mistakes:']

  if (corrections.length > 0) {
    lines.push('  Reply classification corrections:')
    // Group by original → corrected to surface patterns
    const groups = new Map<string, number>()
    for (const s of corrections) {
      const key = `${s.original_value ?? '?'} → ${s.corrected_value ?? '?'}`
      groups.set(key, (groups.get(key) ?? 0) + 1)
    }
    for (const [key, count] of groups) {
      lines.push(`  - "${key}" (occurred ${count}x)`)
    }
  }

  if (rejections.length > 0) {
    lines.push('  Approval rejections with notes:')
    const recent = rejections.slice(0, 5)
    for (const s of recent) {
      const note =
        typeof s.context_json?.rejection_note === 'string'
          ? s.context_json.rejection_note
          : s.original_value ?? 'no note'
      lines.push(`  - "${note}"`)
    }
  }

  return lines.join('\n')
}
