const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateCustomerCode(randomValues = (array) => crypto.getRandomValues(array)) {
  const bytes = randomValues(new Uint8Array(6))
  const suffix = [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('')
  return `SP-${suffix}`
}

export function normalizeCustomerCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '-')
}

export function normalizeUruguayPhone(value) {
  const raw = String(value || '').trim()
  const digits = raw.replace(/\D/g, '')
  let normalized = ''
  if (raw.startsWith('+')) normalized = `+${digits}`
  else if (digits.length === 11 && digits.startsWith('598')) normalized = `+${digits}`
  else if (digits.length === 9 && digits.startsWith('0')) normalized = `+598${digits.slice(1)}`
  else if (digits.length === 8) normalized = `+598${digits}`
  else normalized = `+${digits}`

  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) {
    throw new Error('Ingresá un teléfono válido, por ejemplo 099 123 456.')
  }
  return normalized
}

export const accessStatusLabel = {
  pending: 'Pendiente de activación',
  active: 'Acceso activo',
  suspended: 'Acceso suspendido',
}
