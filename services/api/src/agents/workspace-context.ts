import type {
  ApprovalItem,
  CampaignSummary,
  LaunchReadiness,
  MeetingPrepItem,
  OnboardingProfile,
  PipelineSnapshot,
  ProspectRunSummary,
  ReplyQueueItem,
  WorkspaceSummary,
} from '@pipeiq/shared'

import { getRuntimeStore } from '../lib/runtime-store.js'

export type WorkspaceContext = {
  workspace: WorkspaceSummary
  onboarding: OnboardingProfile
  prospectRun: ProspectRunSummary
  pipeline: PipelineSnapshot
  readiness: LaunchReadiness
  campaign: CampaignSummary
  approvals: ApprovalItem[]
  replies: ReplyQueueItem[]
  meetings: MeetingPrepItem[]
}

export function getWorkspaceContext(workspaceId: string): WorkspaceContext {
  const store = getRuntimeStore()
  return {
    workspace: store.getWorkspaceSummary(workspaceId),
    onboarding: store.getOnboarding(workspaceId),
    prospectRun: store.getProspectRun(workspaceId),
    pipeline: store.getPipeline(workspaceId),
    readiness: store.getLaunchReadiness(workspaceId),
    campaign: store.getCampaign(workspaceId),
    approvals: store.listApprovals(workspaceId),
    replies: store.listReplies(workspaceId),
    meetings: store.listMeetings(workspaceId),
  }
}

export function workspaceContextText(context: WorkspaceContext): string {
  const connectedTools = context.workspace.connections
    .filter((connection) => connection.status === 'connected')
    .map((connection) => connection.label)
    .join(', ')

  const pendingApprovals = context.approvals.filter((item) => item.status === 'pending').length
  const pendingReplies = context.replies.filter((item) => item.status === 'pending').length
  const verifiedContacts = context.pipeline.contacts.filter(
    (contact) =>
      contact.email_verification_status === 'valid' ||
      contact.email_verification_status === 'risky',
  ).length
  const launchApprovedContacts = context.pipeline.contacts.filter(
    (contact) => contact.status === 'approved_to_launch',
  ).length

  return [
    `Workspace name: ${context.workspace.name}`,
    `Onboarding progress: ${context.workspace.onboarding_progress}%`,
    `Target customer: ${context.onboarding.target_customer || 'Not set'}`,
    `Value proposition: ${context.onboarding.value_proposition || 'Not set'}`,
    `Pain points: ${context.onboarding.pain_points || 'Not set'}`,
    `CTA: ${context.onboarding.call_to_action || 'Not set'}`,
    `Industries: ${context.onboarding.industries.join(', ') || 'None'}`,
    `Titles: ${context.onboarding.titles.join(', ') || 'None'}`,
    `Company sizes: ${context.onboarding.company_sizes.join(', ') || 'None'}`,
    `Geos: ${context.onboarding.geos.join(', ') || 'None'}`,
    `Connected tools: ${connectedTools || 'None'}`,
    `Prospect run status: ${context.prospectRun.status} (${context.prospectRun.deduped_count} deduped prospects)`,
    `Verified contacts: ${verifiedContacts}`,
    `Launch-approved contacts: ${launchApprovedContacts}`,
    `Pending approvals: ${pendingApprovals}`,
    `Campaign status: ${context.campaign.status}`,
    `Pending replies: ${pendingReplies}`,
    `Meetings queued: ${context.meetings.length}`,
    `Launch blockers: ${context.readiness.blockers.join(' | ') || 'None'}`,
    `Next action: ${context.readiness.next_action}`,
  ].join('\n')
}
