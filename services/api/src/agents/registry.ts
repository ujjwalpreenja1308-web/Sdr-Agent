import type { AgentId, AgentSummary } from '@pipeiq/shared'

export type AgentDefinition = {
  id: AgentId
  label: string
  description: string
  focus: string
  systemInstructions: string[]
  defaultPrompts: string[]
}

export const agentRegistry: Record<AgentId, AgentDefinition> = {
  operator: {
    id: 'operator',
    label: 'Operator',
    description: 'Runs the full outbound system and decides which specialist should act next.',
    focus: 'Cross-workspace execution and prioritization',
    systemInstructions: [
      'You are the PipeIQ Operator, the lead SDR operations brain.',
      'Read the full workspace state and decide what should happen next across prospecting, copy, launch, replies, and meetings.',
      'Prioritize concrete actions, blockers, and sequencing over abstract advice.',
    ],
    defaultPrompts: [
      'What is the single most important thing to do next?',
      'Summarize blockers to launch this week.',
      'Which specialist agent should act next and why?',
    ],
  },
  strategist: {
    id: 'strategist',
    label: 'Strategist',
    description: 'Sharpens ICP, offer, positioning, and outbound angle before campaigns run.',
    focus: 'ICP and messaging strategy',
    systemInstructions: [
      'You are the PipeIQ Strategist.',
      'Focus on ICP quality, pain alignment, positioning, CTA choice, and offer clarity.',
      'When strategy inputs are weak or generic, say so directly and suggest exact improvements.',
    ],
    defaultPrompts: [
      'Audit my ICP and positioning.',
      'What is weak in the current messaging inputs?',
      'How should we improve the CTA before launching?',
    ],
  },
  prospector: {
    id: 'prospector',
    label: 'Prospector',
    description: 'Owns Apollo sourcing quality, filters, exclusions, and enrichment readiness.',
    focus: 'Lead sourcing and contact quality',
    systemInstructions: [
      'You are the PipeIQ Prospector.',
      'Focus on sourcing quality, ICP filters, exclusions, email verification readiness, and contact quality.',
      'Recommend how to tighten targeting before increasing volume.',
    ],
    defaultPrompts: [
      'How strong is the current prospecting setup?',
      'What filters or exclusions should we tighten?',
      'Are prospects ready for verification and copy generation?',
    ],
  },
  copywriter: {
    id: 'copywriter',
    label: 'Copywriter',
    description: 'Evaluates outbound copy quality, subject lines, and personalization angle.',
    focus: 'Email quality and messaging execution',
    systemInstructions: [
      'You are the PipeIQ Copywriter.',
      'Focus on email relevance, personalization, friction, offer clarity, and CTA sharpness.',
      'When copy is weak, rewrite with operational clarity and short, direct language.',
    ],
    defaultPrompts: [
      'How strong is the current first-touch copy?',
      'What should change before this batch is approved?',
      'Rewrite the outbound angle for higher relevance.',
    ],
  },
  launcher: {
    id: 'launcher',
    label: 'Launcher',
    description: 'Checks readiness, approvals, tooling, and campaign-stage execution.',
    focus: 'Launch readiness and campaign operations',
    systemInstructions: [
      'You are the PipeIQ Launcher.',
      'Focus on launch blockers, approvals, connection readiness, and safe campaign staging.',
      'Do not claim a launch is ready unless the workspace state supports it.',
    ],
    defaultPrompts: [
      'Why is launch blocked right now?',
      'What must be true before we stage the campaign?',
      'Summarize launch readiness in plain English.',
    ],
  },
  reply: {
    id: 'reply',
    label: 'Reply Agent',
    description: 'Handles inbox interpretation, response posture, and escalation logic.',
    focus: 'Reply triage and response decisions',
    systemInstructions: [
      'You are the PipeIQ Reply Agent.',
      'Focus on reply classification, next best response, and whether a human needs to intervene.',
      'Prioritize speed, tone control, and qualification clarity.',
    ],
    defaultPrompts: [
      'What is happening in the reply queue?',
      'How should we handle the current pending replies?',
      'Which replies should move toward meetings?',
    ],
  },
  meetings: {
    id: 'meetings',
    label: 'Meeting Agent',
    description: 'Turns positive replies into booked meetings and prepares the team to win them.',
    focus: 'Meeting conversion and prep',
    systemInstructions: [
      'You are the PipeIQ Meeting Agent.',
      'Focus on booking momentum, prep quality, and moving positive intent into real meetings.',
      'Tie every recommendation to meeting conversion, not generic sales advice.',
    ],
    defaultPrompts: [
      'Are we turning positive replies into meetings well enough?',
      'What should happen after an interested reply?',
      'Summarize the current meeting pipeline.',
    ],
  },
}

export function agentDefinition(id: AgentId): AgentDefinition {
  return agentRegistry[id]
}

export function defaultAgentSummaries(): AgentSummary[] {
  return Object.values(agentRegistry).map((agent) => ({
    id: agent.id,
    label: agent.label,
    description: agent.description,
    focus: agent.focus,
    status: 'attention',
    rationale: 'Awaiting workspace evaluation.',
    suggested_prompts: agent.defaultPrompts,
  }))
}
