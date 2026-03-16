import { CalendarClock, FileText } from 'lucide-react'

import type { CampaignSummary, MeetingPrepItem } from '../lib/api'
import { Badge } from './ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'

type MeetingsPanelProps = {
  campaign: CampaignSummary
  meetings: MeetingPrepItem[]
}

export function MeetingsPanel({ campaign, meetings }: MeetingsPanelProps) {
  return (
    <div className="grid h-full grid-cols-[1fr_280px] gap-4 overflow-hidden">
      {/* Meeting prep queue */}
      <Card className="flex h-full flex-col overflow-hidden">
        <CardHeader>
          <CardTitle>Meeting prep queue</CardTitle>
          <CardDescription>Briefings generated after interested replies are approved.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pt-0">
          {meetings.length > 0 ? (
            meetings.map((meeting) => (
              <div key={meeting.id} className="rounded-lg border border-border bg-secondary/10 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{meeting.contact_name}</p>
                    <p className="text-xs text-muted-foreground">{meeting.company}</p>
                  </div>
                  <Badge variant={meeting.status === 'booked' ? 'success' : 'warning'}>
                    {meeting.status.replace('_', ' ')}
                  </Badge>
                </div>

                <p className="mb-2 text-xs text-muted-foreground">
                  {new Date(meeting.scheduled_for).toLocaleString()}
                </p>

                <div className="rounded-md border border-border bg-background px-3 py-2">
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
                    Prep brief
                  </p>
                  <div className="space-y-1">
                    {meeting.prep_brief.map((point) => (
                      <p key={point} className="text-xs">
                        {point}
                      </p>
                    ))}
                  </div>
                </div>

                {meeting.owner_note ? (
                  <p className="mt-2 text-xs text-muted-foreground">{meeting.owner_note}</p>
                ) : null}
              </div>
            ))
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-secondary/20 p-4 text-xs text-muted-foreground">
              Meeting prep appears after interested replies are approved.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Right column */}
      <div className="flex flex-col gap-4 overflow-y-auto">
        {/* Metrics */}
        <Card>
          <CardHeader>
            <CardTitle>Campaign metrics</CardTitle>
            <CardDescription>Pipeline health at a glance.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 pt-0">
            <MetricTile label="Meetings" value={String(campaign.meetings_booked)} />
            <MetricTile label="Positive replies" value={String(campaign.positive_replies)} />
            <MetricTile label="Prep docs" value={String(meetings.length)} />
            <MetricTile label="Mode" value={campaign.mode.toUpperCase()} />
          </CardContent>
        </Card>

        {/* Principles */}
        <Card>
          <CardHeader>
            <CardTitle>Prep principles</CardTitle>
            <CardDescription>What the meeting agent knows before the call.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 pt-0">
            <PrepRule
              icon={CalendarClock}
              title="Carry thread context"
              description="Inherit why they replied — don't reset the conversation."
            />
            <PrepRule
              icon={FileText}
              title="Anchor on objections"
              description="Include likely objections and proof points to use in the meeting."
            />
            <PrepRule
              icon={CalendarClock}
              title="Stay operational"
              description="Tell the founder what to say first, not just an account summary."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-xl font-semibold tracking-tight">{value}</p>
    </div>
  )
}

function PrepRule({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: typeof CalendarClock
  title: string
}) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-border bg-secondary/10 p-3">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-secondary">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div>
        <p className="text-xs font-medium">{title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  )
}
