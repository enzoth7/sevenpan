import assert from 'node:assert/strict'
import {
  ACCESS_CODE_PATTERN,
  generateAccessCode,
  hashAccessCode,
  normalizeAccessCode,
} from '../supabase/functions/_shared/accessCode.ts'

const generated = generateAccessCode()
assert.match(generated, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}(?:-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}){2}$/)
assert.match(normalizeAccessCode(generated), ACCESS_CODE_PATTERN)
assert.equal(normalizeAccessCode(' 7k4m-p9q2 xr6t '), '7K4MP9Q2XR6T')
assert.equal(
  await hashAccessCode('7K4M-P9Q2-XR6T'),
  await hashAccessCode('7k4mp9q2xr6t'),
)
assert.match(await hashAccessCode(generated), /^[a-f0-9]{64}$/)

console.log('Manual access codes: OK')
