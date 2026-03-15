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
    <Card className="h-full">
      <CardHeader className="pb-4">
        <div>
          <Badge variant="outline" className="mb-2">
            {connection.category}
          </Badge>
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
      <CardContent className="flex h-[calc(100%-92px)] flex-col gap-3">
        <div className="rounded-xl border border-border bg-secondary/50 p-3 text-xs text-muted-foreground">
          <div>{connection.required_for_phase}</div>
          <div>{connection.mode === 'oauth' ? 'Manual Composio OAuth' : 'API key setup'}</div>
        </div>

        {connection.mode === 'oauth' ? (
          <Button className="mt-auto" disabled={busy} onClick={() => onAuthorize(connection.toolkit)} type="button">
            {busy ? 'Launching...' : connection.status === 'connected' ? 'Reconnect' : 'Authorize'}
          </Button>
        ) : (
          <form
            className="mt-auto grid gap-2"
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
            <Button disabled={busy || !secretHint.trim()} type="submit">
              {busy ? 'Saving...' : 'Save'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
