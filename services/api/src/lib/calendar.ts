import { executeConnectedTool } from './composio.js'

const GOOGLECALENDAR_CREATE_EVENT = 'GOOGLECALENDAR_CREATE_EVENT'
const GOOGLECALENDAR_FIND_FREE_SLOTS = 'GOOGLECALENDAR_FIND_FREE_SLOTS'

export type CalendarSlot = {
  start: string
  end: string
}

export type CalendarEventResult = {
  id: string | null
  summary: string
  eventUrl: string | null
  hangoutLink: string | null
  raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export async function findGoogleCalendarFreeSlots(params: {
  workspaceId: string
  orgId: string
  timezone?: string
  daysAhead?: number
}): Promise<CalendarSlot[]> {
  const now = new Date()
  const end = new Date(now.getTime() + (params.daysAhead ?? 7) * 24 * 60 * 60 * 1000)

  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: GOOGLECALENDAR_FIND_FREE_SLOTS,
    arguments: {
      items: ['primary'],
      time_min: now.toISOString(),
      time_max: end.toISOString(),
      timezone: params.timezone ?? 'Asia/Calcutta',
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Google Calendar free-slot lookup failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const data = asRecord(raw.data) ?? raw
  const calendars = asRecord(data.calendars) ?? {}
  const slots: CalendarSlot[] = []

  for (const calendar of Object.values(calendars)) {
    const calendarRecord = asRecord(calendar)
    const free = calendarRecord ? asArray(calendarRecord.free) : []
    for (const slot of free) {
      const slotRecord = asRecord(slot)
      const start = asString(slotRecord?.start)
      const endTime = asString(slotRecord?.end)
      if (!start || !endTime) {
        continue
      }
      slots.push({ start, end: endTime })
    }
  }

  return slots
}

export async function createGoogleCalendarEvent(params: {
  workspaceId: string
  orgId: string
  summary: string
  description: string
  attendeeEmail: string
  startDatetime: string
  endDatetime: string
  timezone?: string
}): Promise<CalendarEventResult> {
  const response = await executeConnectedTool({
    workspaceId: params.workspaceId,
    orgId: params.orgId,
    toolSlug: GOOGLECALENDAR_CREATE_EVENT,
    arguments: {
      summary: params.summary,
      description: params.description,
      attendees: [params.attendeeEmail],
      start_datetime: params.startDatetime,
      end_datetime: params.endDatetime,
      timezone: params.timezone ?? 'Asia/Calcutta',
      send_updates: true,
      create_meeting_room: true,
      calendar_id: 'primary',
    },
  })

  if (!response.successful) {
    throw new Error(response.error ?? 'Google Calendar event creation failed.')
  }

  const raw = asRecord(response.data) ?? {}
  const data = asRecord(raw.data) ?? raw
  const event = asRecord(data.response_data) ?? data

  return {
    id: asString(event.id),
    summary: asString(event.summary) ?? params.summary,
    eventUrl: asString(event.htmlLink),
    hangoutLink: asString(event.hangoutLink),
    raw: event,
  }
}
