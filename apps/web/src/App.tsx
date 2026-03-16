import { useCallback, useEffect, useMemo, useState, useTransition, type FormEvent } from 'react'
import {
  Activity,
  Bot,
  Cable,
  CircleDot,
  Cpu,
  Home,
  Send,
  Settings,
  Sparkles,
  Zap,
} from 'lucide-react'

import { ApprovalCard } from './components/approval-card'
import { CompanyProfilePanel } from './components/company-profile-panel'
import { IntegrationsPanel } from './components/integrations-panel'
import { WarmingPanel } from './components/warming-panel'
import { SequencePanel } from './components/sequence-panel'
import { LaunchControlRoom } from './components/launch-control-room'
import { MeetingsPanel } from './components/meetings-panel'
import { ProspectsPanel } from './components/prospects-panel'
import { RepliesPanel } from './components/replies-panel'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'
import {
  getAuthSession,
  getAgentCatalog,
  checkIntegration,
  decideApproval,
  decideReply,
  generatePipeline,
  getActivity,
  getApprovals,
  getCampaign,
  getInstantlyWebhook,
  getLaunchReadiness,
  getMeetings,
  getOnboarding,
  getPipeline,
  getProspectRun,
  getReplies,
  getWorkspace,
  launchOauthConnection,
  pollConnection,
  registerInstantlyWebhook,
  runProspectSearch,
  saveApiKeyConnection,
  saveWorkspaceId,
  stageLaunch,
  streamChatWithAgent,
  updateOnboarding,
  verifyProspectEmails,
  type AgentCatalog,
  type AgentId,
  type ApprovalItem,
  type AuthSession,
  type CampaignSummary,
  type InstantlyWebhookSubscription,
  type IntegrationCheckResult,
  type LaunchReadiness,
  type MeetingPrepItem,
  type OnboardingProfile,
  type OperatorEvent,
  type PipelineSnapshot,
  type ProspectRunSummary,
  type ReplyQueueItem,
  type WorkspaceSummary,
} from './lib/api'
import {
  calculateOnboardingProgress,
  csvToList,
  type OnboardingListField,
  type OnboardingTextField,
} from './lib/onboarding'

const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const defaultSuggestions = [
  'Show blockers to first launch',
  'Summarize approvals waiting today',
  'What should I connect next?',
]

type AppTab =
  | 'onboarding'
  | 'overview'
  | 'integrations'
  | 'warming'
  | 'pipeline'
  | 'ai'
type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
}

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
  const [integrationChecks, setIntegrationChecks] = useState<
    Record<string, IntegrationCheckResult | undefined>
  >({})
  const [replies, setReplies] = useState<ReplyQueueItem[]>([])
  const [meetings, setMeetings] = useState<MeetingPrepItem[]>([])
  const [approvals, setApprovals] = useState<ApprovalItem[]>([])
  const [activity, setActivity] = useState<OperatorEvent[]>([])
  const [activeTab, setActiveTab] = useState<AppTab>('onboarding')
  const [chatPrompt, setChatPrompt] = useState('Show blockers to first launch')
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([])
  const [chatMeta, setChatMeta] = useState('')
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalog | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyToolkit, setBusyToolkit] = useState<string | null>(null)
  const [busyApprovalId, setBusyApprovalId] = useState<string | null>(null)
  const [busyReplyId, setBusyReplyId] = useState<string | null>(null)
  const [hasInitialized, setHasInitialized] = useState(false)
  const [isChatPending, startChatTransition] = useTransition()
  const [isSavingOnboarding, startOnboardingTransition] = useTransition()
  const [isGeneratingPipeline, startPipelineTransition] = useTransition()
  const [isRunningProspects, startProspectTransition] = useTransition()
  const [isVerifyingProspects, startVerificationTransition] = useTransition()
  const [isLaunchingCampaign, startLaunchTransition] = useTransition()
  const [isRegisteringWebhook, startWebhookTransition] = useTransition()
  const activeWorkspaceId = session?.workspace_id ?? null
  const activeUserId = session?.user_id ?? null

  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => approval.status === 'pending'),
    [approvals],
  )

  const pendingReplies = useMemo(
    () => replies.filter((reply) => reply.status === 'pending'),
    [replies],
  )

  const onboardingDirty = useMemo(() => {
    if (!onboarding) {
      return false
    }
    return JSON.stringify(onboarding) !== savedOnboardingSnapshot
  }, [onboarding, savedOnboardingSnapshot])

  const refreshSession = useCallback(async () => {
    const nextSession = await getAuthSession()
    const storedWorkspaceId = typeof window !== 'undefined'
      ? window.localStorage.getItem('pipeiq_workspace_id')
      : null
    const resolvedWorkspaceId =
      storedWorkspaceId &&
      nextSession.workspaces.some((workspaceOption) => workspaceOption.id === storedWorkspaceId)
        ? storedWorkspaceId
        : nextSession.workspace_id
    const sessionWithWorkspace = {
      ...nextSession,
      workspace_id: resolvedWorkspaceId,
    }
    setSession((current) => {
      if (
        current?.workspace_id === sessionWithWorkspace.workspace_id &&
        current.user_id === sessionWithWorkspace.user_id
      ) {
        return current
      }
      return sessionWithWorkspace
    })
    saveWorkspaceId(sessionWithWorkspace.workspace_id)
    return sessionWithWorkspace
  }, [])

  const refreshData = useCallback(async () => {
    if (!activeWorkspaceId) {
      return
    }
    try {
      // Critical path: workspace + onboarding load first so the UI can render immediately
      const [nextWorkspace, nextOnboarding] = await Promise.all([
        getWorkspace(activeWorkspaceId),
        getOnboarding(activeWorkspaceId),
      ])
      setWorkspace(nextWorkspace)
      setOnboarding(nextOnboarding)
      setSavedOnboardingSnapshot(JSON.stringify(nextOnboarding))
      setError(null)

      if (!hasInitialized) {
        setActiveTab('overview')
        setHasInitialized(true)
      }

      // Secondary: fire the rest in the background without blocking the UI
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
          setSelectedAgentId((current) => current ?? catalog.recommended_agent_id ?? null)
        }),
        getActivity(activeWorkspaceId, 12).then(setActivity),
      ])
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load workspace.')
    }
  }, [activeWorkspaceId, hasInitialized])

  useEffect(() => {
    void (async () => {
      try {
        await refreshSession()
      } catch (sessionError) {
        setError(sessionError instanceof Error ? sessionError.message : 'Unable to load session.')
      }
    })()
  }, [refreshSession])

  useEffect(() => {
    if (!activeWorkspaceId) {
      return
    }
    void refreshData()
  }, [activeWorkspaceId, refreshData])

  useEffect(() => {
    if (!hasInitialized) {
      return
    }
    const interval = window.setInterval(() => {
      void refreshData()
    }, 15000)
    return () => window.clearInterval(interval)
  }, [hasInitialized, refreshData])


  function handleOnboardingTextChange(field: OnboardingTextField, value: string) {
    setOnboarding((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        [field]: value,
      }
    })
  }

  function handleOnboardingListChange(field: OnboardingListField, value: string) {
    setOnboarding((current) => {
      if (!current) {
        return current
      }
      return {
        ...current,
        [field]: csvToList(value),
      }
    })
  }

  async function handleSaveOnboarding() {
    if (!onboarding || !activeWorkspaceId) {
      return
    }

    setError(null)

    startOnboardingTransition(() => {
      void (async () => {
        try {
          const saved = await updateOnboarding(activeWorkspaceId, onboarding)
          setOnboarding(saved)
          setSavedOnboardingSnapshot(JSON.stringify(saved))
          await refreshData()

          if (calculateOnboardingProgress(saved) >= 80) {
            setActiveTab('integrations')
          }
        } catch (saveError) {
          setError(
            saveError instanceof Error ? saveError.message : 'Could not save onboarding.',
          )
        }
      })()
    })
  }

  async function handleGeneratePipeline() {
    if (!activeWorkspaceId) {
      return
    }
    setError(null)

    startPipelineTransition(() => {
      void (async () => {
        try {
          await generatePipeline(activeWorkspaceId)
          await refreshData()
          setActiveTab('pipeline')
        } catch (generationError) {
          setError(
            generationError instanceof Error
              ? generationError.message
              : 'Could not generate the first batch.',
          )
        }
      })()
    })
  }

  async function handleRunProspectSearch() {
    if (!activeWorkspaceId) {
      return
    }
    setError(null)

    startProspectTransition(() => {
      void (async () => {
        try {
          await runProspectSearch(activeWorkspaceId)
          await refreshData()
          setActiveTab('pipeline')
        } catch (prospectError) {
          setError(
            prospectError instanceof Error
              ? prospectError.message
              : 'Could not run Apollo prospecting.',
          )
        }
      })()
    })
  }

  async function handleVerifyProspectEmails() {
    if (!activeWorkspaceId || !activeUserId) {
      return
    }
    setError(null)

    startVerificationTransition(() => {
      void (async () => {
        try {
          await verifyProspectEmails(activeWorkspaceId, activeUserId)
          await refreshData()
          setActiveTab('pipeline')
        } catch (verificationError) {
          setError(
            verificationError instanceof Error
              ? verificationError.message
              : 'Could not verify prospect emails.',
          )
        }
      })()
    })
  }

  async function handleStageLaunch() {
    if (!activeWorkspaceId) {
      return
    }
    setError(null)

    startLaunchTransition(() => {
      void (async () => {
        try {
          const result = await stageLaunch(activeWorkspaceId)
          await refreshData()
          if (result.status === 'blocked') {
            setError(result.blockers[0] ?? result.message)
            return
          }
          setActiveTab('pipeline')
        } catch (launchError) {
          setError(
            launchError instanceof Error ? launchError.message : 'Could not stage the campaign.',
          )
        }
      })()
    })
  }

  async function handleRegisterWebhook() {
    if (!activeWorkspaceId) {
      return
    }
    setError(null)

    startWebhookTransition(() => {
      void (async () => {
        try {
          await registerInstantlyWebhook({
            workspace_id: activeWorkspaceId,
            target_url: `${apiBaseUrl}/api/webhooks/instantly`,
          })
          await refreshData()
        } catch (webhookError) {
          setError(
            webhookError instanceof Error ? webhookError.message : 'Could not register webhook.',
          )
        }
      })()
    })
  }

  async function handleAuthorize(toolkit: string) {
    if (!activeWorkspaceId || !activeUserId) {
      return
    }
    setBusyToolkit(toolkit)
    setError(null)

    try {
      const launch = await launchOauthConnection({
        workspace_id: activeWorkspaceId,
        external_user_id: activeUserId,
        toolkit,
        callback_url: window.location.origin,
      })

      if (launch.redirect_url) {
        window.open(launch.redirect_url, '_blank', 'noopener,noreferrer')
      }

      let attempts = 0
      const interval = window.setInterval(async () => {
        attempts += 1

        try {
          const status = await pollConnection(launch.connection_id)
          if (status.status === 'connected' || attempts >= 30) {
            window.clearInterval(interval)
            await refreshData()
            setBusyToolkit(null)
          }
        } catch {
          window.clearInterval(interval)
          setBusyToolkit(null)
        }
      }, 3000)
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Authorization failed.')
      setBusyToolkit(null)
    }
  }

  async function handleSaveApiKey(toolkit: string, label: string, apiKey: string) {
    if (!activeWorkspaceId || !activeUserId) {
      return
    }
    setBusyToolkit(toolkit)
    setError(null)

    try {
      await saveApiKeyConnection({
        workspace_id: activeWorkspaceId,
        external_user_id: activeUserId,
        toolkit,
        label,
        api_key: apiKey,
      })
      await refreshData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save API key.')
    } finally {
      setBusyToolkit(null)
    }
  }

  async function handleCheckIntegration(toolkit: string) {
    if (!activeWorkspaceId) {
      return
    }
    setBusyToolkit(toolkit)
    setError(null)

    try {
      const result = await checkIntegration(toolkit, activeWorkspaceId)
      setIntegrationChecks((current) => ({
        ...current,
        [toolkit]: result,
      }))
      await refreshData()
    } catch (checkError) {
      setError(
        checkError instanceof Error ? checkError.message : 'Could not run integration check.',
      )
    } finally {
      setBusyToolkit(null)
    }
  }

  async function handleApprovalDecision(approvalId: string, decision: 'approved' | 'rejected') {
    if (!activeWorkspaceId) {
      return
    }
    setBusyApprovalId(approvalId)
    setError(null)

    try {
      await decideApproval(approvalId, decision, activeWorkspaceId)
      await refreshData()
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Could not update approval.')
    } finally {
      setBusyApprovalId(null)
    }
  }

  async function handleReplyDecision(replyId: string, decision: 'approved' | 'dismissed') {
    if (!activeWorkspaceId) {
      return
    }
    setBusyReplyId(replyId)
    setError(null)

    try {
      await decideReply(replyId, decision, activeWorkspaceId)
      await refreshData()
      if (decision === 'approved') {
        setActiveTab('pipeline')
      }
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Could not update reply.')
    } finally {
      setBusyReplyId(null)
    }
  }

  async function runPrompt(prompt: string) {
    if (!activeWorkspaceId) {
      return
    }
    setChatPrompt(prompt)
    setChatEntries([
      { role: 'user', content: prompt },
      { role: 'assistant', content: '' },
    ])
    setChatMeta(`Streaming ${import.meta.env.VITE_API_URL ?? 'http://localhost:8000'}/chat`)
    setActiveTab('ai')
    setError(null)

    startChatTransition(() => {
      void (async () => {
        try {
          await streamChatWithAgent(
            {
              workspace_id: activeWorkspaceId,
              message: prompt,
              agent_id: selectedAgentId ?? agentCatalog?.recommended_agent_id ?? undefined,
            },
            {
              onMeta(payload) {
                if (payload.selected_agent_id) {
                  setSelectedAgentId(payload.selected_agent_id)
                }
                if (payload.selected_agent_label) {
                  setChatMeta(
                    `${payload.selected_agent_label} streaming via ${payload.model ?? 'gpt-4o'}`,
                  )
                }
              },
              onDelta(delta) {
                setChatEntries((current) =>
                  current.map((entry, index) =>
                    index === current.length - 1 && entry.role === 'assistant'
                      ? { ...entry, content: entry.content + delta }
                      : entry,
                  ),
                )
              },
              onDone(finalText) {
                setChatEntries((current) =>
                  current.map((entry, index) =>
                    index === current.length - 1 && entry.role === 'assistant'
                      ? { ...entry, content: finalText }
                      : entry,
                  ),
                )
                setChatMeta('')
              },
            },
          )
        } catch (chatError) {
          setError(chatError instanceof Error ? chatError.message : 'Chat failed.')
        }
      })()
    })
  }

  async function handleChatSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await runPrompt(chatPrompt)
  }


  if (!session || !workspace || !onboarding) {
    return (
      <main className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          {error ? (
            <p className="text-sm text-danger-text">{error}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Loading workspace…</p>
          )}
        </div>
      </main>
    )
  }

  const requiredConnections = workspace.connections.filter(
    (connection) => connection.category === 'required',
  )
  const hunterConnection = workspace.connections.find((connection) => connection.toolkit === 'hunter')

  const navItems: { value: AppTab; label: string; icon: typeof Home; badge?: number }[] = [
    { value: 'overview', label: 'Overview', icon: Home },
    { value: 'onboarding', label: 'Company', icon: Settings },
    { value: 'integrations', label: 'Integrations', icon: Cable },
    { value: 'warming', label: 'Warming', icon: Activity },
    { value: 'pipeline', label: 'Outreach', icon: Zap, badge: (pendingApprovals.length + pendingReplies.length) || undefined },
    { value: 'ai', label: 'AI', icon: Cpu },
  ]

  return (
    <main className="h-screen overflow-hidden bg-background text-foreground">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AppTab)}
        className="grid h-full grid-cols-[192px_minmax(0,1fr)] overflow-hidden"
      >
        {/* Sidebar */}
        <aside className="flex h-full flex-col border-r border-border bg-card">
          {/* Logo */}
          <div className="flex items-center gap-2.5 px-4 py-4">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold tracking-tight">PipeIQ</span>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-2 py-1">
            <TabsList className="grid h-auto w-full grid-cols-1 gap-0.5 bg-transparent p-0">
              {navItems.map(({ value, label, icon: Icon, badge }) => (
                <TabsTrigger
                  key={value}
                  value={value}
                  className="group relative h-9 w-full justify-start gap-3 rounded-lg px-3 text-muted-foreground data-[state=active]:bg-secondary data-[state=active]:text-foreground"
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 text-left text-[13px] font-medium">{label}</span>
                  {badge !== undefined && badge > 0 ? (
                    <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                      {badge}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </nav>

          {/* Footer */}
          <div className="px-4 py-4">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 rounded-full ${campaign?.status === 'running' ? 'bg-success' : 'bg-muted-foreground/30'}`} />
              <span className="text-[11px] text-muted-foreground">{campaign?.status === 'running' ? 'Running' : 'Idle'}</span>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <section className="flex h-full min-w-0 flex-col overflow-hidden bg-background">
          {/* Top bar */}
          <header className="flex h-[49px] shrink-0 items-center justify-between border-b border-border bg-card px-5">
            <h1 className="text-sm font-medium">
              {navItems.find((n) => n.value === activeTab)?.label ?? 'Workspace'}
            </h1>
            {pendingApprovals.length > 0 ? (
              <Badge variant="warning">{pendingApprovals.length} pending</Badge>
            ) : null}
          </header>

          <div className="min-h-0 flex-1 overflow-hidden p-5">
            <TabsContent value="onboarding" className="h-full">
              <CompanyProfilePanel
                onboarding={onboarding}
                onboardingDirty={onboardingDirty}
                saving={isSavingOnboarding}
                workspace={workspace}
                onListChange={handleOnboardingListChange}
                onSave={handleSaveOnboarding}
                onTabChange={(tab) => {
                  if (tab === 'onboarding') setActiveTab('onboarding')
                }}
                onTextChange={handleOnboardingTextChange}
              />
            </TabsContent>

            <TabsContent value="overview" className="h-full">
              <OverviewPanel
                activity={activity}
                onRunPrompt={runPrompt}
                pendingApprovals={pendingApprovals}
                workspace={workspace}
              />
            </TabsContent>

            <TabsContent value="integrations" className="h-full">
              <IntegrationsPanel
                busyToolkit={busyToolkit}
                connections={workspace.connections}
                diagnostics={integrationChecks}
                onAuthorize={handleAuthorize}
                onCheck={handleCheckIntegration}
                onSaveApiKey={handleSaveApiKey}
              />
            </TabsContent>

            <TabsContent value="warming" className="h-full overflow-y-auto p-6">
              <WarmingPanel workspaceId={workspace.id} />
            </TabsContent>

            <TabsContent value="pipeline" className="h-full">
              {pipeline && prospectRun && launchReadiness && campaign && instantlyWebhook ? (
                <OutreachPanel
                  approvals={approvals}
                  busyApprovalId={busyApprovalId}
                  busyReplyId={busyReplyId}
                  busyToolkit={busyToolkit}
                  campaign={campaign}
                  generating={isGeneratingPipeline}
                  hunterConnection={hunterConnection}
                  launching={isLaunchingCampaign}
                  meetings={meetings}
                  pipeline={pipeline}
                  prospectRun={prospectRun}
                  readiness={launchReadiness}
                  registeringWebhook={isRegisteringWebhook}
                  replies={replies}
                  requiredConnections={requiredConnections}
                  runningProspects={isRunningProspects}
                  verifyingProspects={isVerifyingProspects}
                  webhook={instantlyWebhook}
                  webhookTargetUrl={`${apiBaseUrl}/api/webhooks/instantly`}
                  onApprovalDecision={handleApprovalDecision}
                  onAuthorize={handleAuthorize}
                  onConnectHunter={() => handleAuthorize('hunter')}
                  onGenerate={handleGeneratePipeline}
                  onReplyDecision={handleReplyDecision}
                  onRegisterWebhook={handleRegisterWebhook}
                  onRunProspects={handleRunProspectSearch}
                  onSaveApiKey={handleSaveApiKey}
                  onStageLaunch={handleStageLaunch}
                  onVerifyProspects={handleVerifyProspectEmails}
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <p className="text-sm text-muted-foreground">Loading outreach data…</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="ai" className="h-full">
              <AiPanel
                chatEntries={chatEntries}
                chatMeta={chatMeta}
                chatPrompt={chatPrompt}
                isChatPending={isChatPending}
                onPromptChange={setChatPrompt}
                onPromptSubmit={handleChatSubmit}
                onSuggestionClick={runPrompt}
              />
            </TabsContent>
          </div>

          {error ? (
            <div className="shrink-0 border-t border-danger-text/20 bg-danger-subtle px-5 py-2.5 text-xs text-danger-text">
              {error}
            </div>
          ) : null}
        </section>
      </Tabs>
    </main>
  )
}

type OutreachTab = 'prospects' | 'approvals' | 'pipeline' | 'sequences' | 'replies' | 'meetings'

function OutreachPanel({
  approvals, busyApprovalId, busyReplyId, busyToolkit, campaign, generating,
  hunterConnection, launching, meetings, pipeline, prospectRun, readiness,
  registeringWebhook, replies, requiredConnections, runningProspects, verifyingProspects,
  webhook, webhookTargetUrl,
  onApprovalDecision, onAuthorize, onConnectHunter, onGenerate, onReplyDecision,
  onRegisterWebhook, onRunProspects, onSaveApiKey, onStageLaunch, onVerifyProspects,
}: {
  approvals: ReturnType<typeof import('./lib/api').getApprovals> extends Promise<infer T> ? T : never
  busyApprovalId: string | null
  busyReplyId: string | null
  busyToolkit: string | null
  campaign: import('./lib/api').CampaignSummary
  generating: boolean
  hunterConnection: import('./lib/api').ConnectionTarget | undefined
  launching: boolean
  meetings: import('./lib/api').MeetingPrepItem[]
  pipeline: import('./lib/api').PipelineSnapshot
  prospectRun: import('./lib/api').ProspectRunSummary
  readiness: import('./lib/api').LaunchReadiness
  registeringWebhook: boolean
  replies: import('./lib/api').ReplyQueueItem[]
  requiredConnections: import('./lib/api').ConnectionTarget[]
  runningProspects: boolean
  verifyingProspects: boolean
  webhook: import('./lib/api').InstantlyWebhookSubscription
  webhookTargetUrl: string
  onApprovalDecision: (id: string, d: 'approved' | 'rejected') => Promise<void>
  onAuthorize: (toolkit: string) => Promise<void>
  onConnectHunter: () => Promise<void>
  onGenerate: () => Promise<void>
  onReplyDecision: (id: string, d: 'approved' | 'dismissed') => Promise<void>
  onRegisterWebhook: () => Promise<void>
  onRunProspects: () => Promise<void>
  onSaveApiKey: (toolkit: string, label: string, apiKey: string) => Promise<void>
  onStageLaunch: () => Promise<void>
  onVerifyProspects: () => Promise<void>
}) {
  const [subTab, setSubTab] = useState<OutreachTab>('prospects')
  const pendingApprovals = approvals.filter((a) => a.status === 'pending')
  const pendingReplies = replies.filter((r) => r.status === 'pending')

  const subNav: { value: OutreachTab; label: string; badge?: number }[] = [
    { value: 'prospects', label: 'Prospects' },
    { value: 'pipeline', label: 'Pipeline' },
    { value: 'sequences', label: 'Sequences' },
    { value: 'approvals', label: 'Approvals', badge: pendingApprovals.length || undefined },
    { value: 'replies', label: 'Replies', badge: pendingReplies.length || undefined },
    { value: 'meetings', label: 'Meetings' },
  ]

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden">
      <div className="flex shrink-0 gap-1 rounded-lg border border-border bg-card p-1 w-fit">
        {subNav.map(({ value, label, badge }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSubTab(value)}
            className={`relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              subTab === value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
          >
            {label}
            {badge !== undefined && badge > 0 ? (
              <span className={`flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium ${subTab === value ? 'bg-white/25 text-white' : 'bg-primary text-primary-foreground'}`}>
                {badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {subTab === 'prospects' && (
          <ProspectsPanel
            hunterConnection={hunterConnection}
            pipeline={pipeline}
            prospectRun={prospectRun}
            running={runningProspects}
            verifying={verifyingProspects}
            onConnectHunter={onConnectHunter}
            onRun={onRunProspects}
            onVerify={onVerifyProspects}
          />
        )}
        {subTab === 'pipeline' && (
          <LaunchControlRoom
            busyToolkit={busyToolkit}
            generating={generating}
            launching={launching}
            pipeline={pipeline}
            readiness={readiness}
            requiredConnections={requiredConnections}
            onAuthorize={onAuthorize}
            onGenerate={onGenerate}
            onSaveApiKey={onSaveApiKey}
            onStageLaunch={onStageLaunch}
          />
        )}
        {subTab === 'approvals' && (
          <div className="grid h-full auto-rows-min grid-cols-2 gap-3 overflow-y-auto content-start">
            {approvals.length > 0 ? (
              approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  busy={busyApprovalId === approval.id}
                  onDecision={onApprovalDecision}
                />
              ))
            ) : (
              <div className="col-span-2 rounded-xl border border-dashed border-border p-10 text-center">
                <p className="text-sm font-medium">No approvals yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Generate the personalized batch first.</p>
              </div>
            )}
          </div>
        )}
        {subTab === 'replies' && (
          <RepliesPanel
            busyReplyId={busyReplyId}
            registeringWebhook={registeringWebhook}
            replies={replies}
            webhook={webhook}
            webhookTargetUrl={webhookTargetUrl}
            onDecision={onReplyDecision}
            onRegisterWebhook={onRegisterWebhook}
          />
        )}
        {subTab === 'sequences' && (
          <SequencePanel workspaceId={pipeline.workspace_id} pipeline={pipeline} />
        )}
        {subTab === 'meetings' && (
          <MeetingsPanel campaign={campaign} meetings={meetings} />
        )}
      </div>
    </div>
  )
}

function OverviewPanel({
  activity,
  onRunPrompt,
  pendingApprovals,
  workspace,
}: {
  activity: OperatorEvent[]
  onRunPrompt: (prompt: string) => Promise<void>
  pendingApprovals: ApprovalItem[]
  workspace: WorkspaceSummary
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 py-2">
        {/* Metrics */}
        <div className="grid grid-cols-3 gap-3">
          {workspace.metrics.map((metric) => (
            <div key={metric.label} className="rounded-xl border border-border bg-card p-4">
              <p className="text-xs text-muted-foreground">{metric.label}</p>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight">{metric.value}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{metric.caption}</p>
            </div>
          ))}
        </div>

        {/* Approvals */}
        {pendingApprovals.length > 0 ? (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">Pending approvals</p>
            <div className="space-y-2">
              {pendingApprovals.map((approval) => (
                <div key={approval.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{approval.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{approval.summary}</p>
                  </div>
                  <Badge variant="warning">{approval.sample_size} samples</Badge>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Activity */}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Recent activity</p>
          {activity.length > 0 ? (
            <div className="space-y-1.5">
              {activity.slice(0, 6).map((event) => (
                <div key={event.id} className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3">
                  <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium">{event.summary}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(event.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
              <p className="text-xs text-muted-foreground">No activity yet</p>
            </div>
          )}
        </div>

        {/* Ask AI */}
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Ask AI</p>
          <div className="flex flex-wrap gap-2">
            {defaultSuggestions.map((s) => (
              <Button key={s} size="sm" variant="outline" onClick={() => onRunPrompt(s)}>{s}</Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function AiPanel({
  chatEntries,
  chatMeta,
  chatPrompt,
  isChatPending,
  onPromptChange,
  onPromptSubmit,
  onSuggestionClick,
}: {
  chatEntries: ChatEntry[]
  chatMeta: string
  chatPrompt: string
  isChatPending: boolean
  onPromptChange: (value: string) => void
  onPromptSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onSuggestionClick: (prompt: string) => Promise<void>
}) {
  const userEntry = chatEntries.find((e) => e.role === 'user')
  const assistantEntry = chatEntries.find((e) => e.role === 'assistant')

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {chatEntries.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-6 px-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Bot className="h-5 w-5" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">Ask anything</p>
              <p className="mt-1 text-xs text-muted-foreground">The right agent is chosen automatically based on your query.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {defaultSuggestions.map((s) => (
                <Button key={s} size="sm" variant="outline" onClick={() => onSuggestionClick(s)}>{s}</Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
            {userEntry ? (
              <div className="flex justify-end">
                <div className="max-w-[80%] rounded-2xl bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                  {userEntry.content}
                </div>
              </div>
            ) : null}
            {assistantEntry ? (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl border border-border bg-card px-4 py-3">
                  {chatMeta && isChatPending ? (
                    <p className="mb-1.5 text-[11px] text-muted-foreground">{chatMeta}</p>
                  ) : null}
                  {assistantEntry.content ? (
                    <p className="whitespace-pre-wrap text-sm text-foreground leading-relaxed">
                      {assistantEntry.content}
                    </p>
                  ) : (
                    <span className="inline-flex gap-1 text-muted-foreground">
                      <span className="animate-pulse">·</span>
                      <span className="animate-pulse [animation-delay:150ms]">·</span>
                      <span className="animate-pulse [animation-delay:300ms]">·</span>
                    </span>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border bg-card px-4 py-3">
        <form className="mx-auto flex max-w-2xl gap-2" onSubmit={onPromptSubmit}>
          <Textarea
            className="h-[52px] flex-1 resize-none text-sm"
            placeholder="Ask about your pipeline, blockers, or next steps…"
            value={chatPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                e.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <Button className="h-[52px] px-5" disabled={isChatPending} type="submit">
            {isChatPending ? <CircleDot className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  )
}

export default App
