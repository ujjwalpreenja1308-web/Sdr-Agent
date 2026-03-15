import { CheckCircle2, Save } from 'lucide-react'
import type { ReactNode } from 'react'

import type { ApprovalItem, OnboardingProfile, WorkspaceSummary } from '../lib/api'
import {
  calculateOnboardingProgress,
  type OnboardingListField,
  type OnboardingTextField,
} from '../lib/onboarding'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'
import { Textarea } from './ui/textarea'

type OnboardingPanelProps = {
  connectedCount: number
  onboarding: OnboardingProfile
  onboardingDirty: boolean
  pendingApprovals: ApprovalItem[]
  prospectStatus: 'idle' | 'completed'
  requiredConnections: WorkspaceSummary['connections']
  saving: boolean
  workspace: WorkspaceSummary
  onListChange: (field: OnboardingListField, value: string) => void
  onSave: () => Promise<void>
  onTabChange: (tab: 'overview' | 'integrations' | 'prospects' | 'pipeline') => void
  onTextChange: (field: OnboardingTextField, value: string) => void
}

export function OnboardingPanel({
  connectedCount,
  onboarding,
  onboardingDirty,
  pendingApprovals,
  prospectStatus,
  requiredConnections,
  saving,
  workspace,
  onListChange,
  onSave,
  onTabChange,
  onTextChange,
}: OnboardingPanelProps) {
  const completion = calculateOnboardingProgress(onboarding)

  return (
    <div className="grid h-full grid-cols-[1.15fr_0.85fr] gap-4 overflow-hidden">
      <Card className="h-full shadow-none">
        <CardHeader>
          <div>
            <Badge variant="outline" className="mb-2">
              Phase 1 intake
            </Badge>
            <CardTitle>Capture the strategy before the agents run</CardTitle>
            <CardDescription>
              The PRD starts with a short founder intake. PipeIQ should not prospect, write,
              or route replies against guesswork.
            </CardDescription>
          </div>
          <Badge variant={completion >= 80 ? 'success' : 'warning'}>{completion}% complete</Badge>
        </CardHeader>
        <CardContent className="flex h-[calc(100%-92px)] flex-col">
          <div className="grid flex-1 grid-cols-2 gap-3">
            <Field label="Product name" hint="What are you selling?">
              <Input
                placeholder="PipeIQ"
                value={onboarding.product_name}
                onChange={(event) => onTextChange('product_name', event.target.value)}
              />
            </Field>

            <Field label="Call to action" hint="Meeting, teardown, audit, or another CTA">
              <Input
                placeholder="20-minute outbound teardown"
                value={onboarding.call_to_action}
                onChange={(event) => onTextChange('call_to_action', event.target.value)}
              />
            </Field>

            <Field label="Product description" hint="One compact explanation of the offer">
              <Textarea
                className="h-20 min-h-0 resize-none"
                placeholder="AI-powered outbound platform that finds leads, writes full emails, handles replies, and books meetings."
                value={onboarding.product_description}
                onChange={(event) => onTextChange('product_description', event.target.value)}
              />
            </Field>

            <Field label="Value proposition" hint="How you win versus status quo or alternatives">
              <Textarea
                className="h-20 min-h-0 resize-none"
                placeholder="We replace founder-led outbound and variable-based email templates with fully pre-rendered campaigns."
                value={onboarding.value_proposition}
                onChange={(event) => onTextChange('value_proposition', event.target.value)}
              />
            </Field>

            <Field label="Target customer" hint="Your highest-conviction ICP right now">
              <Textarea
                className="h-20 min-h-0 resize-none"
                placeholder="B2B SaaS founders or first sales hires at pre-seed to Series A companies with no SDR team."
                value={onboarding.target_customer}
                onChange={(event) => onTextChange('target_customer', event.target.value)}
              />
            </Field>

            <Field label="Pain points" hint="What urgency should appear in email one">
              <Textarea
                className="h-20 min-h-0 resize-none"
                placeholder="Outbound depends on the founder, reply handling is manual, and generic sequences hurt sender reputation."
                value={onboarding.pain_points}
                onChange={(event) => onTextChange('pain_points', event.target.value)}
              />
            </Field>

            <Field label="Voice guidelines" hint="How the writing should sound">
              <Input
                placeholder="Direct, specific, founder-level, and never robotic."
                value={onboarding.voice_guidelines}
                onChange={(event) => onTextChange('voice_guidelines', event.target.value)}
              />
            </Field>

            <Field label="Industries" hint="Comma-separated">
              <Input
                placeholder="B2B SaaS, devtools, fintech"
                value={listToCsv(onboarding.industries)}
                onChange={(event) => onListChange('industries', event.target.value)}
              />
            </Field>

            <Field label="Titles" hint="Comma-separated">
              <Input
                placeholder="Founder, CEO, VP Sales, RevOps"
                value={listToCsv(onboarding.titles)}
                onChange={(event) => onListChange('titles', event.target.value)}
              />
            </Field>

            <Field label="Company sizes" hint="Comma-separated">
              <Input
                placeholder="2-30 employees, 31-100 employees"
                value={listToCsv(onboarding.company_sizes)}
                onChange={(event) => onListChange('company_sizes', event.target.value)}
              />
            </Field>

            <Field label="Geographies" hint="Comma-separated">
              <Input
                placeholder="United States, Canada"
                value={listToCsv(onboarding.geos)}
                onChange={(event) => onListChange('geos', event.target.value)}
              />
            </Field>

            <Field label="Exclusions" hint="Who should never be contacted">
              <Input
                placeholder="Agencies, enterprise-only teams, non-English markets"
                value={listToCsv(onboarding.exclusions)}
                onChange={(event) => onListChange('exclusions', event.target.value)}
              />
            </Field>
          </div>

          <div className="mt-4 flex items-center justify-between rounded-2xl border border-border bg-secondary/40 px-4 py-3">
            <div>
              <p className="text-sm font-medium">Progress drives the rest of the build</p>
              <p className="text-sm text-muted-foreground">
                Once this hits 80%+, the workspace is ready for Apollo prospecting and the first
                personalization pass.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                disabled={completion < 80}
                variant="outline"
                onClick={() => onTabChange('integrations')}
                type="button"
              >
                Open integrations
              </Button>
              <Button
                disabled={saving || !onboardingDirty}
                onClick={() => void onSave()}
                type="button"
              >
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Saving...' : onboardingDirty ? 'Save intake' : 'Saved'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid h-full grid-rows-[0.92fr_1fr_1fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Readiness summary</CardTitle>
              <CardDescription>What still blocks the first live launch.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ReadinessRow
              label="Onboarding complete"
              value={`${completion}%`}
              tone={completion >= 80 ? 'success' : 'warning'}
            />
            <ReadinessRow
              label="Connected tools"
              value={String(connectedCount)}
              tone={connectedCount > 0 ? 'success' : 'default'}
            />
            <ReadinessRow
              label="Pending approvals"
              value={String(pendingApprovals.length)}
              tone={pendingApprovals.length > 0 ? 'warning' : 'default'}
            />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Launch checklist</CardTitle>
              <CardDescription>The next three actions the workspace expects.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <ChecklistRow
              done={workspace.onboarding_completed}
              title="Finish founder intake"
              description="Save enough product, ICP, and messaging context to stop using defaults."
            />
            <ChecklistRow
              done={
                requiredConnections.filter((connection) => connection.status === 'connected').length >=
                3
              }
              title="Connect Apollo, Hunter, and Instantly"
              description="These three unlock sourcing, verification, and campaign launch."
            />
            <ChecklistRow
              done={prospectStatus === 'completed'}
              title="Run Apollo prospecting"
              description="Source and enrich the first ICP-matched set before generating drafts."
            />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Current strategy view</CardTitle>
              <CardDescription>This is what the agent will rely on right now.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <StrategyPreviewRow label="Offer" value={onboarding.product_name || 'Not set yet'} />
            <StrategyPreviewRow
              label="ICP"
              value={onboarding.target_customer || 'Target customer is still blank.'}
            />
            <StrategyPreviewRow
              label="Pain points"
              value={onboarding.pain_points || 'Pain points are still blank.'}
            />
            <StrategyPreviewRow
              label="CTA"
              value={onboarding.call_to_action || 'CTA is still blank.'}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Field({
  children,
  hint,
  label,
}: {
  children: ReactNode
  hint: string
  label: string
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
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

function ChecklistRow({
  description,
  done,
  title,
}: {
  description: string
  done: boolean
  title: string
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-border p-3">
      <div
        className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${
          done ? 'bg-emerald-50 text-emerald-700' : 'bg-secondary text-muted-foreground'
        }`}
      >
        <CheckCircle2 className="h-4 w-4" />
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

function StrategyPreviewRow({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-xl border border-border bg-secondary/30 p-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  )
}

function listToCsv(values: string[]) {
  return values.join(', ')
}
