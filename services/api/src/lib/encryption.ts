import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { env } from './env.js'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12

function getKey(): Buffer {
  const key = Buffer.from(env.encryptionKey, 'hex')
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must be a 32-byte hex string.')
  }
  return key
}

export function encrypt(text: string): string {
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(payload: string): string {
  const [ivHex, authTagHex, encryptedHex] = payload.split(':')
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted payload format.')
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(),
    Buffer.from(ivHex, 'hex'),
  )
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ])
  return decrypted.toString('utf8')
}
