import { useCallback, useEffect, useMemo, useState, useTransition, type FormEvent } from 'react'
import {
  Bot,
  Cable,
  CheckCircle2,
  ChevronRight,
  Play,
  Send,
  Sparkles,
  Users,
} from 'lucide-react'

import { ApprovalCard } from './components/approval-card'
import { IntegrationsPanel } from './components/integrations-panel'
import { LaunchControlRoom } from './components/launch-control-room'
import { MeetingsPanel } from './components/meetings-panel'
import { OnboardingPanel } from './components/onboarding-panel'
import { ProspectsPanel } from './components/prospects-panel'
import { RepliesPanel } from './components/replies-panel'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { Textarea } from './components/ui/textarea'
import {
  checkIntegration,
  decideApproval,
  decideReply,
  generatePipeline,
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
  stageLaunch,
  streamChatWithAgent,
  updateOnboarding,
  verifyProspectEmails,
  type ApprovalItem,
  type CampaignSummary,
  type InstantlyWebhookSubscription,
  type IntegrationCheckResult,
  type LaunchReadiness,
  type MeetingPrepItem,
  type OnboardingProfile,
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

const externalUserId = 'founder-demo'
const workspaceId = 'default'
const apiBaseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const suggestions = [
  'Show blockers to first launch',
  'Summarize approvals waiting today',
  'What should I connect next?',
]

type AppTab =
  | 'onboarding'
  | 'overview'
  | 'integrations'
  | 'prospects'
  | 'approvals'
  | 'pipeline'
  | 'replies'
  | 'meetings'
  | 'ai'
type ChatEntry = {
  role: 'user' | 'assistant'
  content: string
}

function App() {
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
  const [activeTab, setActiveTab] = useState<AppTab>('onboarding')
  const [chatPrompt, setChatPrompt] = useState('Show blockers to first launch')
  const [chatEntries, setChatEntries] = useState<ChatEntry[]>([])
  const [chatMeta, setChatMeta] = useState('')
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

  const pendingApprovals = useMemo(
    () => approvals.filter((approval) => approval.status === 'pending'),
    [approvals],
  )

  const pendingReplies = useMemo(
    () => replies.filter((reply) => reply.status === 'pending'),
    [replies],
  )

  const connectedCount = useMemo(
    () =>
      workspace?.connections.filter((connection) => connection.status === 'connected').length ?? 0,
    [workspace],
  )

  const onboardingDirty = useMemo(() => {
    if (!onboarding) {
      return false
    }
    return JSON.stringify(onboarding) !== savedOnboardingSnapshot
  }, [onboarding, savedOnboardingSnapshot])

  const refreshData = useCallback(async () => {
    try {
      const [
        nextReadiness,
        nextCampaign,
        nextWebhook,
        nextReplies,
        nextMeetings,
        nextWorkspace,
        nextOnboarding,
        nextProspectRun,
        nextPipeline,
        nextApprovals,
      ] =
        await Promise.all([
        getLaunchReadiness(workspaceId),
        getCampaign(workspaceId),
        getInstantlyWebhook(workspaceId),
        getReplies(workspaceId),
        getMeetings(workspaceId),
        getWorkspace(workspaceId),
        getOnboarding(workspaceId),
        getProspectRun(workspaceId),
        getPipeline(workspaceId),
        getApprovals(workspaceId),
        ])
      setLaunchReadiness(nextReadiness)
      setCampaign(nextCampaign)
      setInstantlyWebhook(nextWebhook)
      setReplies(nextReplies)
      setMeetings(nextMeetings)
      setWorkspace(nextWorkspace)
      setOnboarding(nextOnboarding)
      setSavedOnboardingSnapshot(JSON.stringify(nextOnboarding))
      setProspectRun(nextProspectRun)
      setPipeline(nextPipeline)
      setApprovals(nextApprovals)
      setError(null)
      if (!hasInitialized) {
        const missingRequiredConnections = nextWorkspace.connections.some(
          (connection) =>
            connection.category === 'required' && connection.status !== 'connected',
        )
        const hasVerifiedProspects = nextPipeline.contacts.some(
          (contact) =>
            contact.email_verification_status === 'valid' ||
            contact.email_verification_status === 'risky',
        )
        if (!nextWorkspace.onboarding_completed) {
          setActiveTab('onboarding')
        } else if (missingRequiredConnections) {
          setActiveTab('integrations')
        } else if (nextProspectRun.status !== 'completed' || !hasVerifiedProspects) {
          setActiveTab('prospects')
        } else if (nextApprovals.length > 0) {
          setActiveTab('approvals')
        } else if (
          nextReadiness.checklist.find((item) => item.id === 'batch')?.status !== 'complete'
        ) {
          setActiveTab('pipeline')
        } else {
          setActiveTab('overview')
        }
        setHasInitialized(true)
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load workspace.')
    }
  }, [hasInitialized])

  useEffect(() => {
    void refreshData()
  }, [refreshData])

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
    if (!onboarding) {
      return
    }

    setError(null)

    startOnboardingTransition(() => {
      void (async () => {
        try {
          const saved = await updateOnboarding(workspaceId, onboarding)
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
    setError(null)

    startPipelineTransition(() => {
      void (async () => {
        try {
          await generatePipeline(workspaceId)
          await refreshData()
          setActiveTab('approvals')
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
    setError(null)

    startProspectTransition(() => {
      void (async () => {
        try {
          await runProspectSearch(workspaceId)
          await refreshData()
          setActiveTab('prospects')
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
    setError(null)

    startVerificationTransition(() => {
      void (async () => {
        try {
          await verifyProspectEmails(workspaceId, externalUserId)
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
    setError(null)

    startLaunchTransition(() => {
      void (async () => {
        try {
          const result = await stageLaunch(workspaceId)
          await refreshData()
          if (result.status === 'blocked') {
            setError(result.blockers[0] ?? result.message)
            return
          }
          setActiveTab('replies')
        } catch (launchError) {
          setError(
            launchError instanceof Error ? launchError.message : 'Could not stage the campaign.',
          )
        }
      })()
    })
  }

  async function handleRegisterWebhook() {
    setError(null)

    startWebhookTransition(() => {
      void (async () => {
        try {
          await registerInstantlyWebhook({
            workspace_id: workspaceId,
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
    setBusyToolkit(toolkit)
    setError(null)

    try {
      const launch = await launchOauthConnection({
        workspace_id: workspaceId,
        external_user_id: externalUserId,
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

  async function handleSaveApiKey(toolkit: string, label: string, secretHint: string) {
    setBusyToolkit(toolkit)
    setError(null)

    try {
      await saveApiKeyConnection({
        workspace_id: workspaceId,
        external_user_id: externalUserId,
        toolkit,
        label,
        secret_hint: secretHint,
      })
      await refreshData()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save API key hint.')
    } finally {
      setBusyToolkit(null)
    }
  }

  async function handleCheckIntegration(toolkit: string) {
    setBusyToolkit(toolkit)
    setError(null)

    try {
      const result = await checkIntegration(toolkit, workspaceId)
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
    setBusyApprovalId(approvalId)
    setError(null)

    try {
      await decideApproval(approvalId, decision, workspaceId)
      await refreshData()
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'Could not update approval.')
    } finally {
      setBusyApprovalId(null)
    }
  }

  async function handleReplyDecision(replyId: string, decision: 'approved' | 'dismissed') {
    setBusyReplyId(replyId)
    setError(null)

    try {
      await decideReply(replyId, decision, workspaceId)
      await refreshData()
      if (decision === 'approved') {
        setActiveTab('meetings')
      }
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : 'Could not update reply.')
    } finally {
      setBusyReplyId(null)
    }
  }

  async function runPrompt(prompt: string) {
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
              workspace_id: workspaceId,
              message: prompt,
            },
            {
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
                setChatMeta('GPT-4o streaming response complete')
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

  if (
    !workspace ||
    !onboarding ||
    !prospectRun ||
    !pipeline ||
    !launchReadiness ||
    !campaign ||
    !instantlyWebhook
  ) {
    return (
      <main className="h-screen overflow-hidden bg-background p-6">
        <div className="flex h-full items-center justify-center rounded-[28px] border border-border bg-card">
          <p className="text-sm text-muted-foreground">Loading PipeIQ...</p>
        </div>
      </main>
    )
  }

  const requiredConnections = workspace.connections.filter(
    (connection) => connection.category === 'required',
  )
  const hunterConnection = workspace.connections.find((connection) => connection.toolkit === 'hunter')

  return (
    <main className="h-screen overflow-hidden bg-background p-4 text-foreground">
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as AppTab)}
        className="grid h-full grid-cols-[240px_minmax(0,1fr)] overflow-hidden rounded-[28px] border border-border bg-card"
      >
        <aside className="flex h-full flex-col border-r border-border bg-card px-4 py-5">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">PipeIQ</p>
              <p className="text-xs text-muted-foreground">Desktop workspace</p>
            </div>
          </div>

          <TabsList className="grid h-auto grid-cols-1 gap-1 bg-transparent p-0">
            <TabsTrigger value="onboarding" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Onboarding
            </TabsTrigger>
            <TabsTrigger value="overview" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Home
            </TabsTrigger>
            <TabsTrigger value="integrations" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Integrations
            </TabsTrigger>
            <TabsTrigger value="prospects" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Prospects
            </TabsTrigger>
            <TabsTrigger value="approvals" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Approvals
            </TabsTrigger>
            <TabsTrigger value="pipeline" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Pipeline
            </TabsTrigger>
            <TabsTrigger value="replies" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Replies
            </TabsTrigger>
            <TabsTrigger value="meetings" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              Meetings
            </TabsTrigger>
            <TabsTrigger value="ai" className="justify-start rounded-xl px-3 py-2 data-[state=active]:bg-secondary">
              PipeIQ AI
            </TabsTrigger>
          </TabsList>

          <div className="mt-6 space-y-3">
            <StatusRow icon={Sparkles} label="Onboarding" value={`${workspace.onboarding_progress}%`} />
            <StatusRow icon={Users} label="Sourced prospects" value={String(prospectRun.deduped_count)} />
            <StatusRow icon={Cable} label="Connected tools" value={String(connectedCount)} />
            <StatusRow icon={Send} label="Pending replies" value={String(pendingReplies.length)} />
          </div>

          <Card className="mt-auto bg-secondary/50 shadow-none">
            <CardHeader>
              <div>
                <CardTitle className="text-sm">Launch status</CardTitle>
                <CardDescription>Everything important in one view.</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Badge variant={workspace.onboarding_completed ? 'success' : 'warning'}>
                {workspace.onboarding_completed
                  ? 'Onboarding complete'
                  : `${workspace.onboarding_progress}% strategy captured`}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {workspace.onboarding_completed
                  ? 'The workspace is ready for prospecting, approvals, and campaign staging.'
                  : 'Finish the intake first so prospecting and email generation stop relying on seeded assumptions.'}
              </p>
              <Button size="sm" onClick={() => setActiveTab(workspace.onboarding_completed ? 'overview' : 'onboarding')}>
                {workspace.onboarding_completed ? 'Open home' : 'Continue setup'}
              </Button>
            </CardContent>
          </Card>
        </aside>

        <section className="flex h-full min-w-0 flex-col overflow-hidden">
          <header className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h1 className="text-xl font-semibold">{workspace.name}</h1>
              <p className="text-sm text-muted-foreground">{workspace.phase_focus}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={workspace.onboarding_completed ? 'success' : 'warning'}>
                {`Onboarding ${workspace.onboarding_progress}%`}
              </Badge>
              <Badge variant="outline">{connectedCount} connected</Badge>
              <Badge variant={pendingApprovals.length > 0 ? 'warning' : 'success'}>
                {pendingApprovals.length} pending
              </Badge>
              <Badge variant={campaign.status === 'running' ? 'success' : 'outline'}>
                {campaign.status}
              </Badge>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-hidden p-6">
            <TabsContent value="onboarding" className="h-full">
              <OnboardingPanel
                connectedCount={connectedCount}
                onboarding={onboarding}
                onboardingDirty={onboardingDirty}
                pendingApprovals={pendingApprovals}
                prospectStatus={prospectRun.status}
                requiredConnections={requiredConnections}
                saving={isSavingOnboarding}
                workspace={workspace}
                onListChange={handleOnboardingListChange}
                onSave={handleSaveOnboarding}
                onTabChange={setActiveTab}
                onTextChange={handleOnboardingTextChange}
              />
            </TabsContent>

            <TabsContent value="overview" className="h-full">
              <OverviewPanel
                connectedCount={connectedCount}
                onRunPrompt={runPrompt}
                pendingApprovals={pendingApprovals}
                pipeline={pipeline}
                prospectRun={prospectRun}
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
              />
            </TabsContent>

            <TabsContent value="prospects" className="h-full">
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
            </TabsContent>

            <TabsContent value="approvals" className="h-full">
              <div className="grid h-full grid-cols-[1.3fr_0.7fr] gap-4 overflow-hidden">
                <div className="grid min-h-0 grid-cols-2 gap-4">
                  {approvals.length > 0 ? (
                    approvals.map((approval) => (
                      <ApprovalCard
                        key={approval.id}
                        approval={approval}
                        busy={busyApprovalId === approval.id}
                        onDecision={handleApprovalDecision}
                      />
                    ))
                  ) : (
                    <Card className="col-span-2 h-full shadow-none">
                      <CardHeader>
                        <div>
                          <CardTitle>No approvals yet</CardTitle>
                          <CardDescription>
                            Generate the personalized batch after prospecting to create the first
                            human review queue.
                          </CardDescription>
                        </div>
                      </CardHeader>
                      <CardContent className="flex h-[calc(100%-92px)] items-end">
                        <Button variant="outline" onClick={() => setActiveTab('pipeline')}>
                          Open batch generation
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
                <Card className="h-full shadow-none">
                  <CardHeader>
                    <div>
                      <CardTitle>Review notes</CardTitle>
                      <CardDescription>Approve only what should go straight into a live campaign.</CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent className="flex h-[calc(100%-92px)] flex-col justify-between">
                    <div className="space-y-3">
                      <ReviewNote icon={CheckCircle2} title="Approvals" description="Batch approvals switch sourced prospects into launch-ready state." />
                      <ReviewNote icon={Send} title="Sending seam" description="Instantly launch now executes through the workspace Composio connection." />
                      <ReviewNote icon={Bot} title="Agent support" description="PipeIQ AI can summarize blockers and connection gaps from the same state." />
                    </div>
                    <Button variant="outline" onClick={() => setActiveTab('ai')}>
                      Ask PipeIQ AI
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="pipeline" className="h-full">
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
            </TabsContent>

            <TabsContent value="replies" className="h-full">
              <RepliesPanel
                busyReplyId={busyReplyId}
                registeringWebhook={isRegisteringWebhook}
                replies={replies}
                webhook={instantlyWebhook}
                webhookTargetUrl={`${apiBaseUrl}/api/webhooks/instantly`}
                onDecision={handleReplyDecision}
                onRegisterWebhook={handleRegisterWebhook}
              />
            </TabsContent>

            <TabsContent value="meetings" className="h-full">
              <MeetingsPanel campaign={campaign} meetings={meetings} />
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

          {error ? <div className="border-t border-border bg-rose-50 px-6 py-3 text-sm text-rose-700">{error}</div> : null}
        </section>
      </Tabs>
    </main>
  )
}

function OverviewPanel({
  connectedCount,
  onRunPrompt,
  pendingApprovals,
  pipeline,
  prospectRun,
  workspace,
}: {
  connectedCount: number
  onRunPrompt: (prompt: string) => Promise<void>
  pendingApprovals: ApprovalItem[]
  pipeline: PipelineSnapshot
  prospectRun: ProspectRunSummary
  workspace: WorkspaceSummary
}) {
  return (
    <div className="grid h-full grid-cols-[1.1fr_0.9fr] gap-4 overflow-hidden">
      <div className="grid gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <Badge variant="outline" className="mb-2">
                Overview
              </Badge>
              <CardTitle className="text-2xl">Everything needed to launch this week</CardTitle>
              <CardDescription>{workspace.greeting}</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion}
                variant={suggestion === suggestions[0] ? 'default' : 'outline'}
                onClick={() => onRunPrompt(suggestion)}
              >
                {suggestion}
              </Button>
            ))}
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          {workspace.metrics.map((metric, index) => (
            <Card key={metric.label} className="shadow-none">
              <CardContent className="space-y-2 p-5">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">{metric.label}</span>
                  {index === 0 ? <Users className="h-4 w-4 text-muted-foreground" /> : null}
                  {index === 1 ? <Bot className="h-4 w-4 text-muted-foreground" /> : null}
                  {index === 2 ? <Play className="h-4 w-4 text-muted-foreground" /> : null}
                </div>
                <div className="text-3xl font-semibold tracking-tight">{metric.value}</div>
                <p className="text-sm text-muted-foreground">{metric.caption}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="flex-1 shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Queue summary</CardTitle>
              <CardDescription>What still needs human action before handoff.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3">
            {pendingApprovals.length > 0 ? (
              pendingApprovals.map((approval) => (
                <div key={approval.id} className="flex items-center justify-between rounded-xl border border-border p-4">
                  <div>
                    <p className="font-medium">{approval.title}</p>
                    <p className="text-sm text-muted-foreground">{approval.summary}</p>
                  </div>
                  <Badge variant="warning">{approval.sample_size} samples</Badge>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-4">
                <p className="font-medium">No approval queue yet</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {prospectRun.status === 'completed'
                    ? 'Verify sourced emails, then generate the first personalized batch.'
                    : 'Run Apollo prospecting to source the first contact set.'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Readiness</CardTitle>
              <CardDescription>Minimal signal across pipeline, tools, and approvals.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ReadinessRow label="Pending approvals" value={String(pendingApprovals.length)} tone="warning" />
            <ReadinessRow label="Connected tools" value={String(connectedCount)} tone="default" />
            <ReadinessRow label="Sourced prospects" value={String(prospectRun.deduped_count)} tone={prospectRun.status === 'completed' ? 'success' : 'default'} />
            <ReadinessRow
              label="Emails verified"
              value={String(
                pipeline.contacts.filter(
                  (contact) =>
                    contact.email_verification_status === 'valid' ||
                    contact.email_verification_status === 'risky',
                ).length,
              )}
              tone={
                pipeline.contacts.some(
                  (contact) =>
                    contact.email_verification_status === 'valid' ||
                    contact.email_verification_status === 'risky',
                )
                  ? 'success'
                  : 'default'
              }
            />
            <ReadinessRow label="Drafts generated" value={String(pipeline.contacts.length)} tone={pipeline.contacts.length > 0 ? 'success' : 'default'} />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>ICP questions</CardTitle>
              <CardDescription>The compact strategy seam for onboarding.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {workspace.strategy_questions.map((question) => (
              <div key={question} className="flex items-start gap-2 rounded-xl border border-border bg-secondary/40 p-3 text-sm">
                <ChevronRight className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <span>{question}</span>
              </div>
            ))}
          </CardContent>
        </Card>
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
  const assistantEntry = chatEntries.find((entry) => entry.role === 'assistant')

  return (
    <Card className="flex h-full flex-col shadow-none">
      <CardHeader>
        <div>
          <Badge variant="outline" className="mb-2">
            PipeIQ AI
          </Badge>
          <CardTitle>Your autonomous outbound operator</CardTitle>
          <CardDescription>
            {chatMeta || 'Use the agent to inspect blockers, summarize readiness, or plan the next launch step.'}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {assistantEntry ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="rounded-2xl border border-border bg-secondary/40 p-4">
              <p className="mb-2 text-sm font-medium">Latest prompt</p>
              <p className="text-sm text-muted-foreground">{chatEntries.find((entry) => entry.role === 'user')?.content}</p>
            </div>
            <div className="min-h-0 flex-1 rounded-2xl border border-border bg-background p-4">
              <p className="mb-2 text-sm font-medium">PipeIQ response</p>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{assistantEntry.content}</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 rounded-2xl border border-dashed border-border bg-secondary/30">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Bot className="h-7 w-7" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold">Ask PipeIQ anything</h2>
              <p className="text-sm text-muted-foreground">A minimal desktop AI surface with no overflow-heavy layout.</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((suggestion) => (
                <Button key={suggestion} variant="outline" onClick={() => onSuggestionClick(suggestion)}>
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        <form className="mt-4 grid grid-cols-[1fr_auto] gap-3" onSubmit={onPromptSubmit}>
          <Textarea
            className="h-24 resize-none"
            placeholder="Ask PipeIQ to explain blockers, summarize approvals, or plan launch steps"
            value={chatPrompt}
            onChange={(event) => onPromptChange(event.target.value)}
          />
          <Button className="h-full min-w-28" disabled={isChatPending} type="submit">
            {isChatPending ? 'Running...' : 'Run agent'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function StatusRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Users
  label: string
  value: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span>{label}</span>
      </div>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

function ReadinessRow({
  label,
  tone,
  value,
}: {
  label: string
  tone: 'default' | 'warning' | 'success'
  value: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/30 px-4 py-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <Badge variant={tone === 'warning' ? 'warning' : tone === 'success' ? 'success' : 'outline'}>
        {value}
      </Badge>
    </div>
  )
}

function ReviewNote({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Bot
  title: string
  description: string
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-border p-4">
      <div className="mt-0.5 rounded-lg bg-secondary p-2">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

export default App
