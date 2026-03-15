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
    <div className="grid h-full grid-cols-[0.95fr_1.05fr] gap-4 overflow-hidden">
      <div className="grid h-full grid-rows-[0.82fr_1.18fr] gap-4">
        <Card className="shadow-none">
          <CardHeader>
            <div>
              <Badge variant="outline" className="mb-2">
                Meetings
              </Badge>
              <CardTitle>Prep follows positive signal, not guesswork</CardTitle>
              <CardDescription>
                Once replies are approved, PipeIQ turns them into meeting context and next-step prep.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <MetricTile label="Meetings booked" value={String(campaign.meetings_booked)} />
            <MetricTile label="Positive replies" value={String(campaign.positive_replies)} />
            <MetricTile label="Prep docs" value={String(meetings.length)} />
            <MetricTile label="Campaign mode" value={campaign.mode.toUpperCase()} />
          </CardContent>
        </Card>

        <Card className="shadow-none">
          <CardHeader>
            <div>
              <CardTitle>Prep principles</CardTitle>
              <CardDescription>What the meeting agent should already know before the call.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <PrepRule
              icon={CalendarClock}
              title="Carry thread context"
              description="The meeting prep should inherit the reason they replied, not reset the conversation."
            />
            <PrepRule
              icon={FileText}
              title="Anchor on objections"
              description="The brief should include likely objections and the proof points to use in the meeting."
            />
            <PrepRule
              icon={CalendarClock}
              title="Stay operational"
              description="Every prep doc should tell the founder what to say first, not just summarize the account."
            />
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-none">
        <CardHeader>
          <div>
            <CardTitle>Meeting prep queue</CardTitle>
            <CardDescription>Generated prep briefs that are ready before the founder joins the call.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          {meetings.length > 0 ? (
            meetings.map((meeting) => (
              <div key={meeting.id} className="rounded-2xl border border-border bg-secondary/20 p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{meeting.contact_name}</p>
                    <p className="text-sm text-muted-foreground">{meeting.company}</p>
                  </div>
                  <Badge variant={meeting.status === 'booked' ? 'success' : 'warning'}>
                    {meeting.status.replace('_', ' ')}
                  </Badge>
                </div>

                <p className="mb-3 text-sm text-muted-foreground">
                  Scheduled for {new Date(meeting.scheduled_for).toLocaleString()}
                </p>

                <div className="rounded-xl border border-border bg-background p-3">
                  <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Prep brief
                  </p>
                  <div className="space-y-2">
                    {meeting.prep_brief.map((point) => (
                      <p key={point} className="text-sm">
                        {point}
                      </p>
                    ))}
                  </div>
                </div>

                <p className="mt-3 text-sm text-muted-foreground">{meeting.owner_note}</p>
              </div>
            ))
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-secondary/20 p-6 text-sm text-muted-foreground">
              Meeting prep appears after interested replies are approved.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-secondary/20 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
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
