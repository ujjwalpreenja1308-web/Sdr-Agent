import {
  useCallback, useEffect, useMemo, useRef, useState, useTransition,
  type FormEvent,
} from 'react'
import {
  BarChart2, Bot, ChevronLeft, ChevronRight, Cpu,
  Hash, Home, Inbox, Layers, LogOut, MessageSquare,
  PanelRightOpen, Plus, Settings, Sparkles, Users, Zap,
  BookOpen, Building2, Flame,
} from 'lucide-react'

import { CompanyProfilePanel } from './components/company-profile-panel'
import { PlaybooksPanel } from './components/playbooks-panel'
import { IntegrationsPanel } from './components/integrations-panel'
import { WarmingPanel } from './components/warming-panel'
import { SequencePanel } from './components/sequence-panel'
import { LaunchControlRoom } from './components/launch-control-room'
import { MeetingsPanel } from './components/meetings-panel'
import { ProspectsPanel } from './components/prospects-panel'
import { RepliesPanel } from './components/replies-panel'
import { AnimatedOnboarding } from './components/animated-onboarding'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import {
  getAuthSession, getAgentCatalog, checkIntegration, decideApproval, decideReply,
  generatePipeline, getActivity, getApprovals, getCampaign, getInstantlyWebhook,
  getLaunchReadiness, getMeetings, getOnboarding, getPipeline, getProspectRun,
  getReplies, getWorkspace, launchOauthConnection, pollConnection,
  registerInstantlyWebhook, runProspectSearch, saveApiKeyConnection, saveWorkspaceId,
  stageLaunch, streamChatWithAgent, updateOnboarding, verifyProspectEmails,
  type AgentCatalog, type AgentId, type ApprovalItem, type AuthSession,
  type CampaignSummary, type InstantlyWebhookSubscription, type IntegrationCheckResult,
  type LaunchReadiness, type MeetingPrepItem, type OnboardingProfile, type OperatorEvent,
  type PipelineSnapshot, type ProspectRunSummary, type ReplyQueueItem, type WorkspaceSummary,
} from './lib/api'
import { calculateOnboardingProgress, csvToList, type OnboardingListField, type OnboardingTextField } from './lib/onboarding'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

// ─── Types ────────────────────────────────────────────────────────────────────

type AppView =
  | 'ai'
  | 'analytics'
  | 'company-profile'
  | 'company-playbooks'
  | 'campaigns'
  | 'sequences'
  | 'inbox'
  | 'integrations'
  | 'warmup'
  | 'settings'

type ChatEntry = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  approvals?: ApprovalItem[]
}

type ConvoSummary = {
  id: string
  title: string
  preview: string
  timestamp: Date
}

// ─── Main App ────────────────────────────────────────────────────────────────

function App() {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [workspace, setWorkspace] = useState<WorkspaceSummary | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingProfile | null>(null)
  const [savedOnboardingSnapshot, setSavedOnboardingSnapshot] = useState('')
  const [prospectRun, setProspectRun] = useState<ProspectRunSummary | null>(null)
  const [pipeline, setPipeline] = useState<PipelineSnapshot | null>(null)
  const [launchReadiness, setLaunchReadiness] = useState<LaunchReadiness | null>(null)
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null)
  const [instantlyWebhook, setInstantlyWebhook] = useState<InstantlyWebhookSubscription | null>(null)
  const [integrationChecks, setIntegrationChecks] = useState<Record<string, IntegrationCheckResult | undefined>>({})
  const [replies, setReplies] = useState<ReplyQueueItem[]>([])
  const [meetings, setMeetings] = useState<MeetingPrepItem[]>([])
  const [approvals, setApprovals] = useState<ApprovalItem[]>([])
  const [activity, setActivity] = useState<OperatorEvent[]>([])

  // UI state
  const [activeView, setActiveView] = useState<AppView>('ai')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [pastConvosOpen, setPastConvosOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Chat state
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatMeta, setChatMeta] = useState('')
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalog | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null)
  const [pastConvos] = useState<ConvoSummary[]>([])
  const chatBottomRef = useRef<HTMLDivElement>(null)

  // Loading states
  const [busyToolkit, setBusyToolkit] = useState<string | null>(null)
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null)
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)
  const [isChatPending, startChatTransition] = useTransition()
  const [isSavingOnboarding, startOnboardingTransition] = useTransition()
  const [isGeneratingPipeline, startPipelineTransition] = useTransition()
  const [isRunningProspects, startProspectTransition] = useTransition()
  const [isVerifyingProspects, startVerificationTransition] = useTransition()
  const [isLaunchingCampaign, startLaunchTransition] = useTransition()
  const [isRegisteringWebhook, startWebhookTransition] = useTransition()

  const activeWorkspaceId = session?.workspace_id ?? null
  const activeUserId = session?.user_id ?? null

  const pendingApprovals = useMemo(() => approvals.filter((a) => a.status === 'pending'), [approvals])
  const pendingReplies = useMemo(() => replies.filter((r) => r.status === 'pending'), [replies])

  const onboardingDirty = useMemo(() => {
    if (!onboarding) return false
    return JSON.stringify(onboarding) !== savedOnboardingSnapshot
  }, [onboarding, savedOnboardingSnapshot])

  // ── Data loading ──────────────────────────────────────────────────────────

  const refreshSession = useCallback(async () => {
    const nextSession = await getAuthSession()
    const storedId = typeof window !== 'undefined' ? window.localStorage.getItem('pipeiq_workspace_id') : null
    const resolvedId = storedId && nextSession.workspaces.some((w) => w.id === storedId)
      ? storedId : nextSession.workspace_id
    const s = { ...nextSession, workspace_id: resolvedId }
    setSession((cur) => cur?.workspace_id === s.workspace_id && cur.user_id === s.user_id ? cur : s)
    saveWorkspaceId(s.workspace_id)
    return s
  }, [])

  const refreshData = useCallback(async () => {
    if (!activeWorkspaceId) return
    try {
      const [nextWorkspace, nextOnboarding] = await Promise.all([
        getWorkspace(activeWorkspaceId),
        getOnboarding(activeWorkspaceId),
      ])
      setWorkspace(nextWorkspace)
      setOnboarding(nextOnboarding)
      setSavedOnboardingSnapshot(JSON.stringify(nextOnboarding))
      setError(null)

      if (!hasInitialized) {
        const progress = calculateOnboardingProgress(nextOnboarding)
        if (progress < 40) {
          setShowOnboarding(true)
        }
        setHasInitialized(true)
      }

      void Promise.allSettled([
        getLaunchReadiness(activeWorkspaceId).then(setLaunchReadiness),
        getCampaign(activeWorkspaceId).then(setCampaign),
        getInstantlyWebhook(activeWorkspaceId).then(setInstantlyWebhook),
        getReplies(activeWorkspaceId).then(setReplies),
        getMeetings(activeWorkspaceId).then(setMeetings),
        getProspectRun(activeWorkspaceId).then(setProspectRun),
        getPipeline(activeWorkspaceId).then(setPipeline),
        getApprovals(activeWorkspaceId).then(setApprovals),
        getAgentCatalog(activeWorkspaceId).then((catalog) => {
          setAgentCatalog(catalog)
          setSelectedAgentId((cur) => cur ?? catalog.recommended_agent_id ?? null)
        }),
        getActivity(activeWorkspaceId, 12).then(setActivity),
      ])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load workspace.')
    }
  }, [activeWorkspaceId, hasInitialized])

  useEffect(() => {
    void (async () => {
      try { await refreshSession() }
      catch (e) { setError(e instanceof Error ? e.message : 'Unable to load session.') }
    })()
  }, [refreshSession])

  useEffect(() => {
    if (!activeWorkspaceId) return
    void refreshData()
  }, [activeWorkspaceId, refreshData])

  useEffect(() => {
    if (!hasInitialized) return
    const id = window.setInterval(() => void refreshData(), 15000)
    return () => window.clearInterval(id)
  }, [hasInitialized, refreshData])

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatEntries])

  // ── Onboarding handlers ───────────────────────────────────────────────────

  function handleOnboardingTextChange(field: OnboardingTextField, value: string) {
    setOnboarding((cur) => cur ? { ...cur, [field]: value } : cur)
  }

  function handleOnboardingListChange(field: OnboardingListField, value: string) {
    setOnboarding((cur) => cur ? { ...cur, [field]: csvToList(value) } : cur)
  }

  async function handleSaveOnboarding() {
    if (!onboarding || !activeWorkspaceId) return
    setError(null)
    startOnboardingTransition(() => {
      void (async () => {
        try {
          const saved = await updateOnboarding(activeWorkspaceId, onboarding)
          setOnboarding(saved)
          setSavedOnboardingSnapshot(JSON.stringify(saved))
          await refreshData()
          if (calculateOnboardingProgress(saved) >= 80) setActiveView('integrations')
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not save onboarding.')
        }
      })()
    })
  }

  // ── Pipeline handlers ─────────────────────────────────────────────────────

  async function handleGeneratePipeline() {
    if (!activeWorkspaceId) return
    setError(null)
    startPipelineTransition(() => {
      void (async () => {
        try {
          await generatePipeline(activeWorkspaceId)
          await refreshData()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not generate batch.')
        }
      })()
    })
  }

  async function handleRunProspectSearch() {
    if (!activeWorkspaceId) return
    setError(null)
    startProspectTransition(() => {
      void (async () => {
        try {
          await runProspectSearch(activeWorkspaceId)
          await refreshData()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not run prospecting.')
        }
      })()
    })
  }

  async function handleVerifyProspectEmails() {
    if (!activeWorkspaceId || !activeUserId) return
    setError(null)
    startVerificationTransition(() => {
      void (async () => {
        try {
          await verifyProspectEmails(activeWorkspaceId, activeUserId)
          await refreshData()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not verify emails.')
        }
      })()
    })
  }

  async function handleStageLaunch() {
    if (!activeWorkspaceId) return
    setError(null)
    startLaunchTransition(() => {
      void (async () => {
        try {
          const result = await stageLaunch(activeWorkspaceId)
          await refreshData()
          if (result.status === 'blocked') setError(result.blockers[0] ?? result.message)
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not stage campaign.')
        }
      })()
    })
  }

  async function handleRegisterWebhook() {
    if (!activeWorkspaceId) return
    setError(null)
    startWebhookTransition(() => {
      void (async () => {
        try {
          await registerInstantlyWebhook({ workspace_id: activeWorkspaceId, target_url: `${apiBaseUrl}/api/webhooks/instantly` })
          await refreshData()
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Could not register webhook.')
        }
      })()
    })
  }

  async function handleAuthorize(toolkit: string) {
    if (!activeWorkspaceId || !activeUserId) return
    setBusyToolkit(toolkit)
    setError(null)
    try {
      const launch = await launchOauthConnection({ workspace_id: activeWorkspaceId, external_user_id: activeUserId, toolkit, callback_url: window.location.origin })
      if (launch.redirect_url) window.open(launch.redirect_url, '_blank', 'noopener,noreferrer')
      let attempts = 0
      const iv = window.setInterval(async () => {
        attempts++
        try {
          const status = await pollConnection(launch.connection_id)
          if (status.status === 'connected' || attempts >= 30) {
            window.clearInterval(iv)
            await refreshData()
            setBusyToolkit(null)
          }
        } catch { window.clearInterval(iv); setBusyToolkit(null) }
      }, 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Authorization failed.')
      setBusyToolkit(null)
    }
  }

  async function handleSaveApiKey(toolkit: string, label: string, apiKey: string) {
    if (!activeWorkspaceId || !activeUserId) return
    setBusyToolkit(toolkit)
    setError(null)
    try {
      await saveApiKeyConnection({ workspace_id: activeWorkspaceId, external_user_id: activeUserId, toolkit, label, api_key: apiKey })
      await refreshData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save API key.')
    } finally { setBusyToolkit(null) }
  }

  async function handleCheckIntegration(toolkit: string) {
    if (!activeWorkspaceId) return
    setBusyToolkit(toolkit)
    setError(null)
    try {
      const result = await checkIntegration(toolkit, activeWorkspaceId)
      setIntegrationChecks((cur) => ({ ...cur, [toolkit]: result }))
      await refreshData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check integration.')
    } finally { setBusyToolkit(null) }
  }

  async function handleApprovalDecision(approvalId: string, decision: 'approved' | 'rejected') {
    if (!activeWorkspaceId) return
    setBusyApprovalId(approvalId)
    setError(null)
    try {
      await decideApproval(approvalId, decision, activeWorkspaceId)
      await refreshData()
      // Update the inline chat approval too
      setChatEntries((cur) => cur.map((entry) => ({
        ...entry,
        approvals: entry.approvals?.map((a) =>
          a.id === approvalId ? { ...a, status: decision === 'approved' ? 'approved' : 'rejected' } : a
        ),
      })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update approval.')
    } finally { setBusyApprovalId(null) }
  }

  async function handleReplyDecision(replyId: string, decision: 'approved' | 'dismissed') {
    if (!activeWorkspaceId) return
    setBusyReplyId(replyId)
    setError(null)
    try {
      await decideReply(replyId, decision, activeWorkspaceId)
      await refreshData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update reply.')
    } finally { setBusyReplyId(null) }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  async function runPrompt(prompt: string) {
    if (!activeWorkspaceId || !prompt.trim()) return
    const userEntry: ChatEntry = { id: crypto.randomUUID(), role: 'user', content: prompt, timestamp: new Date() }
    const assistantEntry: ChatEntry = { id: crypto.randomUUID(), role: 'assistant', content: '', timestamp: new Date() }
    setChatEntries((cur) => [...cur, userEntry, assistantEntry])
    setChatInput('')
    setActiveView('ai')
    setError(null)

    startChatTransition(() => {
      void (async () => {
        try {
          await streamChatWithAgent(
            { workspace_id: activeWorkspaceId, message: prompt, agent_id: selectedAgentId ?? agentCatalog?.recommended_agent_id ?? undefined },
            {
              onMeta(payload) {
                if (payload.selected_agent_id) setSelectedAgentId(payload.selected_agent_id)
                if (payload.selected_agent_label) setChatMeta(`${payload.selected_agent_label} · ${payload.model ?? 'gpt-4o'}`)
              },
              onDelta(delta) {
                setChatEntries((cur) => cur.map((e, i) =>
                  i === cur.length - 1 && e.role === 'assistant' ? { ...e, content: e.content + delta } : e
                ))
              },
              onDone(finalText) {
                setChatEntries((cur) => cur.map((e, i) =>
                  i === cur.length - 1 && e.role === 'assistant'
                    ? { ...e, content: finalText, approvals: pendingApprovals.length > 0 ? pendingApprovals : undefined }
                    : e
                ))
                setChatMeta('')
              },
            },
          )
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Chat failed.')
        }
      })()
    })
  }

  async function handleChatSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    await runPrompt(chatInput)
  }

  // ── Onboarding via chat (agent-driven) ───────────────────────────────────

  async function handleOnboardingComplete(profile: OnboardingProfile) {
    if (!activeWorkspaceId) return
    try {
      const saved = await updateOnboarding(activeWorkspaceId, profile)
      setOnboarding(saved)
      setSavedOnboardingSnapshot(JSON.stringify(saved))
      setShowOnboarding(false)
      await refreshData()
      // Welcome message in chat
      const welcomeMsg: ChatEntry = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Great! I've got everything I need about ${profile.product_name ?? 'your product'}. I'm now going to find your best-fit prospects, write personalised outreach, and prepare your first campaign sequence. I'll check in when I need your approval — you can sit back. 🚀`,
        timestamp: new Date(),
      }
      setChatEntries([welcomeMsg])
      setActiveView('ai')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile.')
    }
  }

  // ── Render: loading ───────────────────────────────────────────────────────

  if (!session || !workspace || !onboarding) {
    return (
      <main className="flex h-screen items-center justify-center" style={{ background: 'hsl(var(--sidebar-bg))' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          {error ? (
            <p className="text-sm text-danger-text">{error}</p>
          ) : (
            <div className="flex gap-1.5">
              <div className="typing-dot" />
              <div className="typing-dot" />
              <div className="typing-dot" />
            </div>
          )}
        </div>
      </main>
    )
  }

  // ── Render: animated onboarding ───────────────────────────────────────────

  if (showOnboarding) {
    return (
      <AnimatedOnboarding
        initial={onboarding}
        onComplete={handleOnboardingComplete}
        onSkip={() => setShowOnboarding(false)}
      />
    )
  }

  const requiredConnections = workspace.connections.filter((c) => c.category === 'required')
  const hunterConnection = workspace.connections.find((c) => c.toolkit === 'hunter')

  // ── Render: main app ──────────────────────────────────────────────────────

  return (
    <main className="flex h-screen overflow-hidden bg-background">
      {/* ── Sidebar ── */}
      <Sidebar
        collapsed={sidebarCollapsed}
        activeView={activeView}
        campaign={campaign}
        pendingInbox={pendingApprovals.length + pendingReplies.length}
        onCollapse={() => setSidebarCollapsed((v) => !v)}
        onNavigate={setActiveView}
        onNewChat={() => { setChatEntries([]); setActiveView('ai') }}
        userName={session.user_id}
      />

      {/* ── Main content ── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <TopBar
          activeView={activeView}
          chatMeta={chatMeta}
          isChatPending={isChatPending}
          pastConvosOpen={pastConvosOpen}
          onTogglePastConvos={() => setPastConvosOpen((v) => !v)}
        />

        {/* Content area */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="min-w-0 flex-1 overflow-hidden">

            {/* ── AI Chat view ── */}
            {activeView === 'ai' && (
              <ChatView
                approvals={approvals}
                busyApprovalId={busyApprovalId}
                chatBottomRef={chatBottomRef}
                chatEntries={chatEntries}
                chatInput={chatInput}
                chatMeta={chatMeta}
                isChatPending={isChatPending}
                onApprovalDecision={handleApprovalDecision}
                onInputChange={setChatInput}
                onSubmit={handleChatSubmit}
                onSuggestionClick={runPrompt}
                userName={session.user_id}
              />
            )}

            {/* ── Analytics ── */}
            {activeView === 'analytics' && (
              <AnalyticsView
                activity={activity}
                campaign={campaign}
                pendingApprovals={pendingApprovals}
                workspace={workspace}
                onRunPrompt={runPrompt}
              />
            )}

            {/* ── Company Profile ── */}
            {activeView === 'company-profile' && (
              <div className="h-full overflow-y-auto p-6">
                <CompanyProfilePanel
                  onboarding={onboarding}
                  onboardingDirty={onboardingDirty}
                  saving={isSavingOnboarding}
                  workspace={workspace}
                  onListChange={handleOnboardingListChange}
                  onSave={handleSaveOnboarding}
                  onTabChange={() => {}}
                  onTextChange={handleOnboardingTextChange}
                />
              </div>
            )}

            {/* ── Playbooks ── */}
            {activeView === 'company-playbooks' && (
              <PlaybooksPanel workspaceId={workspace.id} />
            )}

            {/* ── Campaigns ── */}
            {activeView === 'campaigns' && pipeline && prospectRun && launchReadiness && campaign && instantlyWebhook && (
              <div className="h-full overflow-y-auto p-6 space-y-6">
                <ProspectsPanel
                  hunterConnection={hunterConnection}
                  pipeline={pipeline}
                  prospectRun={prospectRun}
                  running={isRunningProspects}
                  verifying={isVerifyingProspects}
                  onConnectHunter={() => handleAuthorize('hunter')}
                  onRun={handleRunProspectSearch}
                  onVerify={handleVerifyProspectEmails}
                />
                <LaunchControlRoom
                  busyToolkit={busyToolkit}
                  generating={isGeneratingPipeline}
                  launching={isLaunchingCampaign}
                  pipeline={pipeline}
                  readiness={launchReadiness}
                  requiredConnections={requiredConnections}
                  onAuthorize={handleAuthorize}
                  onGenerate={handleGeneratePipeline}
                  onSaveApiKey={handleSaveApiKey}
                  onStageLaunch={handleStageLaunch}
                />
              </div>
            )}

            {/* ── Sequences ── */}
            {activeView === 'sequences' && pipeline && (
              <div className="h-full overflow-y-auto p-6">
                <SequencePanel workspaceId={pipeline.workspace_id} pipeline={pipeline} />
              </div>
            )}

            {/* ── Inbox ── */}
            {activeView === 'inbox' && (
              <div className="h-full overflow-y-auto p-6 space-y-6">
                {replies.length > 0 && (
                  <RepliesPanel
                    busyReplyId={busyReplyId}
                    registeringWebhook={isRegisteringWebhook}
                    replies={replies}
                    webhook={instantlyWebhook!}
                    webhookTargetUrl={`${apiBaseUrl}/api/webhooks/instantly`}
                    onDecision={handleReplyDecision}
                    onRegisterWebhook={handleRegisterWebhook}
                  />
                )}
                {meetings.length > 0 && campaign && (
                  <MeetingsPanel campaign={campaign} meetings={meetings} />
                )}
                {replies.length === 0 && meetings.length === 0 && (
                  <div className="flex h-full items-center justify-center">
                    <div className="text-center">
                      <Inbox className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                      <p className="text-sm font-medium">Inbox is empty</p>
                      <p className="mt-1 text-xs text-muted-foreground">Replies and meeting requests will appear here</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Integrations ── */}
            {activeView === 'integrations' && (
              <div className="h-full overflow-y-auto p-6">
                <IntegrationsPanel
                  busyToolkit={busyToolkit}
                  connections={workspace.connections}
                  diagnostics={integrationChecks}
                  onAuthorize={handleAuthorize}
                  onCheck={handleCheckIntegration}
                  onSaveApiKey={handleSaveApiKey}
                />
              </div>
            )}

            {/* ── Warmup ── */}
            {activeView === 'warmup' && (
              <div className="h-full overflow-y-auto p-6">
                <WarmingPanel workspaceId={workspace.id} />
              </div>
            )}

            {/* ── Settings ── */}
            {activeView === 'settings' && (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Settings className="mx-auto mb-3 h-8 w-8 text-muted-foreground/40" />
                  <p className="text-sm font-medium">Settings</p>
                  <p className="mt-1 text-xs text-muted-foreground">Workspace configuration coming soon</p>
                </div>
              </div>
            )}
          </div>

          {/* ── Past convos panel ── */}
          {pastConvosOpen && (
            <PastConvosPanel
              convos={pastConvos}
              onSelect={() => {}}
              onClose={() => setPastConvosOpen(false)}
            />
          )}
        </div>

        {/* Error bar */}
        {error && (
          <div className="shrink-0 border-t border-danger/20 bg-danger-subtle px-5 py-2.5 text-xs text-danger-text flex items-center justify-between">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
      </div>
    </main>
  )
}

// ─── Sidebar ─────────────────────────────────────────────────────────────────

function Sidebar({
  collapsed, activeView, campaign, pendingInbox,
  onCollapse, onNavigate, onNewChat, userName,
}: {
  collapsed: boolean
  activeView: AppView
  campaign: CampaignSummary | null
  pendingInbox: number
  onCollapse: () => void
  onNavigate: (view: AppView) => void
  onNewChat: () => void
  userName: string
}) {
  const isRunning = campaign?.status === 'running'

  const sections = [
    {
      items: [
        { view: 'ai' as AppView, icon: Cpu, label: 'AI' },
        { view: 'analytics' as AppView, icon: BarChart2, label: 'Analytics' },
      ],
    },
    {
      label: 'Company',
      items: [
        { view: 'company-profile' as AppView, icon: Building2, label: 'Profile' },
        { view: 'company-playbooks' as AppView, icon: BookOpen, label: 'Playbooks' },
      ],
    },
    {
      label: 'Campaigns',
      items: [
        { view: 'campaigns' as AppView, icon: Zap, label: 'Campaigns', badge: undefined },
        { view: 'sequences' as AppView, icon: Layers, label: 'Email sequences' },
      ],
    },
    {
      items: [
        { view: 'inbox' as AppView, icon: Inbox, label: 'Inbox', badge: pendingInbox || undefined },
        { view: 'integrations' as AppView, icon: Hash, label: 'Integrations' },
        { view: 'warmup' as AppView, icon: Flame, label: 'Warmup' },
      ],
    },
  ]

  return (
    <aside
      className="sidebar flex flex-col h-full shrink-0 transition-all duration-220"
      style={{ width: collapsed ? 52 : 220 }}
    >
      {/* Logo + collapse */}
      <div className="flex h-[49px] shrink-0 items-center justify-between px-3 border-b" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/20">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-white">PipeIQ</span>
          </div>
        )}
        <button
          type="button"
          onClick={onCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/10 text-sidebar-muted hover:text-white ml-auto"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* New chat button */}
      <div className="px-2 pt-3 pb-1">
        <button
          type="button"
          onClick={onNewChat}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors hover:bg-white/10"
          style={{ color: 'hsl(var(--sidebar-muted))' }}
          title="New chat"
        >
          <Plus className="h-4 w-4 shrink-0" />
          {!collapsed && <span>New chat</span>}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {sections.map((section, si) => (
          <div key={si}>
            {section.label && !collapsed && (
              <p className="sidebar-section-label">{section.label}</p>
            )}
            {section.items.map(({ view, icon: Icon, label, badge }) => (
              <button
                key={view}
                type="button"
                onClick={() => onNavigate(view)}
                className={`sidebar-nav-item w-full ${activeView === view ? 'active' : ''}`}
                title={collapsed ? label : undefined}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1 text-left">{label}</span>}
                {!collapsed && badge !== undefined && badge > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-white">
                    {badge}
                  </span>
                )}
                {collapsed && badge !== undefined && badge > 0 && (
                  <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-primary" />
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="shrink-0 border-t px-3 py-3 space-y-2" style={{ borderColor: 'hsl(var(--sidebar-border))' }}>
        {/* Campaign status */}
        {!collapsed && (
          <div className="flex items-center gap-2">
            {isRunning ? <div className="status-dot-running" /> : <div className="status-dot-idle" />}
            <span className="text-[11px]" style={{ color: 'hsl(var(--sidebar-muted))' }}>
              {isRunning ? 'Campaign running' : 'No active campaign'}
            </span>
          </div>
        )}
        {/* Settings */}
        <button
          type="button"
          onClick={() => onNavigate('settings')}
          className={`sidebar-nav-item w-full ${activeView === 'settings' ? 'active' : ''}`}
          title={collapsed ? 'Settings' : undefined}
        >
          <Settings className="h-4 w-4 shrink-0" />
          {!collapsed && <span className="flex-1 text-left">Settings</span>}
        </button>
        {/* User */}
        {!collapsed && (
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/30 text-[10px] font-bold text-primary-foreground">
              {userName.slice(0, 1).toUpperCase()}
            </div>
            <span className="truncate text-[12px] font-medium" style={{ color: 'hsl(var(--sidebar-fg))' }}>
              {userName.split('@')[0]}
            </span>
          </div>
        )}
      </div>
    </aside>
  )
}

// ─── Top Bar ─────────────────────────────────────────────────────────────────

function TopBar({ activeView, chatMeta, isChatPending, pastConvosOpen, onTogglePastConvos }: {
  activeView: AppView
  chatMeta: string
  isChatPending: boolean
  pastConvosOpen: boolean
  onTogglePastConvos: () => void
}) {
  const titles: Record<AppView, string> = {
    'ai': 'AI',
    'analytics': 'Analytics',
    'company-profile': 'Company · Profile',
    'company-playbooks': 'Company · Playbooks',
    'campaigns': 'Campaigns',
    'sequences': 'Email Sequences',
    'inbox': 'Inbox',
    'integrations': 'Integrations',
    'warmup': 'Warmup',
    'settings': 'Settings',
  }

  return (
    <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-border bg-card px-5">
      <div className="flex items-center gap-3">
        <h1 className="text-[13px] font-semibold text-foreground">{titles[activeView]}</h1>
        {activeView === 'ai' && isChatPending && chatMeta && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <span className="inline-flex gap-0.5">
              <div className="typing-dot" style={{ width: 4, height: 4 }} />
              <div className="typing-dot" style={{ width: 4, height: 4, animationDelay: '0.15s' }} />
              <div className="typing-dot" style={{ width: 4, height: 4, animationDelay: '0.3s' }} />
            </span>
            {chatMeta}
          </span>
        )}
      </div>
      {activeView === 'ai' && (
        <button
          type="button"
          onClick={onTogglePastConvos}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${pastConvosOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>History</span>
        </button>
      )}
    </header>
  )
}

// ─── Chat View ────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  'Build me a campaign for SaaS companies',
  'Show blockers to first launch',
  'Who are my hottest prospects?',
  'Draft a follow-up for interested replies',
]

function ChatView({
  approvals, busyApprovalId, chatBottomRef, chatEntries, chatInput,
  chatMeta, isChatPending, onApprovalDecision, onInputChange, onSubmit,
  onSuggestionClick, userName,
}: {
  approvals: ApprovalItem[]
  busyApprovalId: string | null
  chatBottomRef: React.RefObject<HTMLDivElement>
  chatEntries: ChatEntry[]
  chatInput: string
  chatMeta: string
  isChatPending: boolean
  onApprovalDecision: (id: string, d: 'approved' | 'rejected') => Promise<void>
  onInputChange: (v: string) => void
  onSubmit: (e: FormEvent<HTMLFormElement>) => Promise<void>
  onSuggestionClick: (s: string) => Promise<void>
  userName: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea
  function handleTextareaInput() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {chatEntries.length === 0 ? (
          /* Empty state */
          <div className="flex h-full flex-col items-center justify-center gap-8 px-6">
            <div className="text-center animate-fade-slide-up">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <Bot className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">How can I help you?</h2>
              <p className="mt-1.5 text-sm text-muted-foreground max-w-sm">
                I'm your AI SDR. Tell me what you want to sell and I'll handle the outreach.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5 w-full max-w-lg animate-fade-slide-up-delay-1">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onSuggestionClick(s)}
                  className="rounded-xl border border-border bg-card px-4 py-3 text-left text-[13px] font-medium text-foreground transition-all hover:border-primary/40 hover:bg-primary-subtle hover:shadow-sm"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message thread */
          <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
            {chatEntries.map((entry, i) => (
              <div key={entry.id} className={`flex gap-3 ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {entry.role === 'assistant' && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Bot className="h-3.5 w-3.5 text-primary" />
                  </div>
                )}
                <div className={`flex flex-col gap-3 ${entry.role === 'user' ? 'items-end' : 'items-start'}`} style={{ maxWidth: '85%' }}>
                  {entry.role === 'user' ? (
                    <div className="chat-bubble-user">{entry.content}</div>
                  ) : (
                    <div className="chat-bubble-assistant">
                      {isChatPending && i === chatEntries.length - 1 && !entry.content ? (
                        <div className="flex gap-1.5 py-0.5">
                          <div className="typing-dot" />
                          <div className="typing-dot" />
                          <div className="typing-dot" />
                        </div>
                      ) : (
                        <p className="whitespace-pre-wrap leading-relaxed">{entry.content}</p>
                      )}
                    </div>
                  )}
                  {/* Inline approval cards */}
                  {entry.role === 'assistant' && entry.approvals && entry.approvals.length > 0 && (
                    <div className="w-full space-y-3 mt-1">
                      {entry.approvals.map((approval) => (
                        <InlineChatApproval
                          key={approval.id}
                          approval={approval}
                          busy={busyApprovalId === approval.id}
                          onDecision={onApprovalDecision}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {entry.role === 'user' && (
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-bold text-foreground">
                    {userName.slice(0, 1).toUpperCase()}
                  </div>
                )}
              </div>
            ))}
            <div ref={chatBottomRef} />
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 py-4">
        <form
          className="chat-input-bar mx-auto flex max-w-2xl flex-col gap-0"
          onSubmit={onSubmit}
        >
          <textarea
            ref={textareaRef}
            rows={1}
            className="w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-sm text-foreground placeholder:text-muted-foreground outline-none"
            placeholder="Build me a campaign and sequence for…"
            value={chatInput}
            onChange={(e) => { onInputChange(e.target.value); handleTextareaInput() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <div className="flex items-center justify-between px-3 pb-2.5">
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">↵ send · ⇧↵ newline</span>
            </div>
            <button
              type="submit"
              disabled={isChatPending || !chatInput.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-white transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isChatPending ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
                  <path d="M14 2L8 8M14 2H9M14 2V7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M8 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Inline Approval Card ─────────────────────────────────────────────────────

function InlineChatApproval({ approval, busy, onDecision }: {
  approval: ApprovalItem
  busy: boolean
  onDecision: (id: string, d: 'approved' | 'rejected') => Promise<void>
}) {
  const isDone = approval.status !== 'pending'

  return (
    <div className="approval-inline animate-fade-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${isDone ? 'bg-success' : 'bg-warning'}`} />
          <span className="text-[12px] font-semibold text-foreground">{approval.title}</span>
          <Badge variant={approval.type === 'batch_send' ? 'primary' : 'outline'} className="text-[10px] px-1.5 py-0">
            {approval.type.replace('_', ' ')}
          </Badge>
        </div>
        <Badge variant={isDone ? (approval.status === 'approved' ? 'success' : 'danger') : 'warning'}>
          {approval.status}
        </Badge>
      </div>

      {/* Samples */}
      <div className="px-4 py-3 space-y-2.5">
        <p className="text-[11px] text-muted-foreground">{approval.summary}</p>
        {approval.samples.slice(0, 2).map((s) => (
          <div key={s.contact_id} className="rounded-lg bg-secondary/60 px-3 py-2.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-semibold text-foreground">{s.contact_name}</span>
              <span className="text-[11px] text-muted-foreground">{s.company}</span>
            </div>
            <p className="text-[12px] font-medium text-foreground mb-0.5">{s.subject}</p>
            <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{s.body}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      {!isDone && (
        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision(approval.id, 'rejected')}
            className="flex-1 rounded-lg border border-border bg-card py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Revise'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision(approval.id, 'approved')}
            className="flex-1 rounded-lg bg-primary py-2 text-[13px] font-medium text-white transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Approve & send'}
          </button>
        </div>
      )}
      {isDone && (
        <div className="flex items-center gap-1.5 border-t border-border px-4 py-2.5">
          <span className={`text-[12px] font-medium ${approval.status === 'approved' ? 'text-success-text' : 'text-danger-text'}`}>
            {approval.status === 'approved' ? '✓ Approved — campaign staged' : '✗ Marked for revision'}
          </span>
        </div>
      )}
    </div>
  )
}

// ─── Analytics View ───────────────────────────────────────────────────────────

function AnalyticsView({ activity, campaign, pendingApprovals, workspace, onRunPrompt }: {
  activity: OperatorEvent[]
  campaign: CampaignSummary | null
  pendingApprovals: ApprovalItem[]
  workspace: WorkspaceSummary
  onRunPrompt: (p: string) => Promise<void>
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 px-6 py-6">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3">
          {workspace.metrics.map((m) => (
            <div key={m.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{m.label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">{m.value}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{m.caption}</p>
            </div>
          ))}
        </div>

        {/* Pending approvals */}
        {pendingApprovals.length > 0 && (
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Needs your attention</p>
            <div className="space-y-2">
              {pendingApprovals.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-xl border border-warning/30 bg-warning-subtle px-4 py-3">
                  <div>
                    <p className="text-[13px] font-semibold text-foreground">{a.title}</p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{a.summary}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRunPrompt(`Review approval: ${a.title}`)}
                    className="ml-4 rounded-lg bg-warning px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-warning/90"
                  >
                    Review
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Activity */}
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Recent activity</p>
          {activity.length > 0 ? (
            <div className="divide-y divide-border rounded-xl border border-border bg-card overflow-hidden">
              {activity.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-foreground">{e.summary}</p>
                    <p className="text-[11px] text-muted-foreground">{new Date(e.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No activity yet — start a campaign</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Past Convos Panel ────────────────────────────────────────────────────────

function PastConvosPanel({ convos, onSelect, onClose }: {
  convos: ConvoSummary[]
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <div className="past-convos-panel flex w-72 shrink-0 flex-col animate-slide-in-right">
      <div className="flex h-[49px] shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-[13px] font-semibold">History</span>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {convos.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageSquare className="h-6 w-6 text-muted-foreground/30" />
            <p className="text-[12px] text-muted-foreground">Past conversations will appear here</p>
          </div>
        ) : (
          <div className="space-y-1">
            {convos.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c.id)}
                className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-secondary"
              >
                <p className="truncate text-[13px] font-medium text-foreground">{c.title}</p>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{c.preview}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground/60">{c.timestamp.toLocaleDateString()}</p>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
