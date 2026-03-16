import { useState } from 'react'

import type { ConnectionTarget } from '../lib/api'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card'
import { Input } from './ui/input'

type ConnectionCardProps = {
  connection: ConnectionTarget
  busy: boolean
  onAuthorize: (toolkit: string) => Promise<void>
  onSaveApiKey: (toolkit: string, label: string, secretHint: string) => Promise<void>
}

export function ConnectionCard({
  connection,
  busy,
  onAuthorize,
  onSaveApiKey,
}: ConnectionCardProps) {
  const [label, setLabel] = useState(connection.label)
  const [secretHint, setSecretHint] = useState('')

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{connection.label}</CardTitle>
          <CardDescription>{connection.description}</CardDescription>
        </div>
        <Badge
          variant={
            connection.status === 'connected'
              ? 'success'
              : connection.status === 'pending'
                ? 'warning'
                : 'outline'
          }
        >
          {connection.status.replace('_', ' ')}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 pt-0">
        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-muted-foreground">
          <div>{connection.required_for_phase}</div>
          <div className="mt-0.5 text-muted-foreground/70">{connection.mode === 'oauth' ? 'Composio OAuth' : 'API key'}</div>
        </div>

        {connection.mode === 'oauth' ? (
          <Button size="sm" disabled={busy} onClick={() => onAuthorize(connection.toolkit)} type="button">
            {busy ? 'Launching…' : connection.status === 'connected' ? 'Reconnect' : 'Authorize'}
          </Button>
        ) : (
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void onSaveApiKey(connection.toolkit, label, secretHint)
            }}
          >
            <Input value={label} onChange={(event) => setLabel(event.target.value)} />
            <Input
              placeholder="Masked key or account note"
              value={secretHint}
              onChange={(event) => setSecretHint(event.target.value)}
            />
            <Button size="sm" disabled={busy || !secretHint.trim()} type="submit">
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
