import { decodeJwt } from 'jose'
import { createMiddleware } from 'hono/factory'

import { createSupabaseUserClient } from '../lib/supabase.js'
import { env } from '../lib/env.js'
import type { AppEnv, AuthClaims } from '../types.js'

function extractToken(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null
  }
  const [scheme, token] = headerValue.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }
  return token
}

function resolveOrgId(claims: AuthClaims): string | null {
  if (typeof claims.org_id === 'string' && claims.org_id.length > 0) {
    return claims.org_id
  }
  if (typeof claims.organization_id === 'string' && claims.organization_id.length > 0) {
    return claims.organization_id
  }
  if (
    claims.app_metadata &&
    typeof claims.app_metadata.org_id === 'string' &&
    claims.app_metadata.org_id.length > 0
  ) {
    return claims.app_metadata.org_id
  }
  if (
    claims.user_metadata &&
    typeof claims.user_metadata.org_id === 'string' &&
    claims.user_metadata.org_id.length > 0
  ) {
    return claims.user_metadata.org_id
  }
  return null
}

export const authMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const token = extractToken(c.req.header('Authorization'))
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Dev auth bypass — ONLY allowed when NODE_ENV is explicitly 'development'
  if (
    process.env.NODE_ENV === 'development' &&
    env.devAuth.bearerToken &&
    token === env.devAuth.bearerToken
  ) {
    const devUserId = env.devAuth.userId
    const devOrgId = env.devAuth.orgId
    const claims: AuthClaims = {
      sub: devUserId,
      org_id: devOrgId,
    }
    c.set('accessToken', token)
    c.set('claims', claims)
    c.set('orgId', devOrgId)
    c.set('userId', devUserId)
    await next()
    return
  }

  const userClient = createSupabaseUserClient(token)
  const userResult = await userClient.auth.getUser(token)
  if (userResult.error || !userResult.data.user) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const claims = decodeJwt(token) as AuthClaims
  const orgId = resolveOrgId(claims)
  if (!orgId) {
    return c.json({ error: 'JWT does not include org_id.' }, 403)
  }

  c.set('accessToken', token)
  c.set('claims', claims)
  c.set('orgId', orgId)
  c.set('userId', userResult.data.user.id)

  await next()
})
