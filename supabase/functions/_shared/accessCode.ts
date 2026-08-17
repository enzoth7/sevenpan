const ACCESS_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export const ACCESS_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/

export function normalizeAccessCode(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function generateAccessCode() {
  const bytes = new Uint8Array(12)
  crypto.getRandomValues(bytes)
  const canonical = [...bytes]
    .map((value) => ACCESS_CODE_ALPHABET[value % ACCESS_CODE_ALPHABET.length])
    .join('')
  return canonical.match(/.{1,4}/g)?.join('-') || canonical
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export async function hashAccessCode(value: string) {
  return sha256(normalizeAccessCode(value))
}
