import { Hono } from 'hono'

import { listWorkspacesForOrg, resolvePrimaryWorkspaceForOrg } from '../lib/supabase.js'
import type { AppEnv } from '../types.js'

export const authRoutes = new Hono<AppEnv>()

authRoutes.get('/auth/me', async (c) => {
  const orgId = c.get('orgId')
  const primaryWorkspace = await resolvePrimaryWorkspaceForOrg(orgId)
  const workspaces = await listWorkspacesForOrg(orgId)

  return c.json({
    user_id: c.get('userId'),
    org_id: orgId,
    workspace_id: primaryWorkspace.id,
    workspaces: workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
    })),
    claims: c.get('claims'),
  })
})
