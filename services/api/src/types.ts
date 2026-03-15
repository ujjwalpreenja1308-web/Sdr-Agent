import type { JWTPayload } from 'jose'

export type AuthClaims = JWTPayload & {
  org_id?: string
  organization_id?: string
  workspace_id?: string
  app_metadata?: {
    org_id?: string
    [key: string]: unknown
  }
  user_metadata?: {
    org_id?: string
    [key: string]: unknown
  }
}

export type AppEnv = {
  Variables: {
    accessToken: string
    claims: AuthClaims
    orgId: string
    userId: string
  }
}
