import assert from 'node:assert/strict'
import {
  generateCustomerCode,
  normalizeCustomerCode,
  normalizeUruguayPhone,
} from '../src/lib/customerAccess.js'

const deterministicCode = generateCustomerCode((bytes) => {
  bytes.set([0, 1, 2, 3, 4, 5])
  return bytes
})

assert.equal(deterministicCode, 'SP-234567')
assert.match(generateCustomerCode(), /^SP-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/)
assert.equal(normalizeCustomerCode(' sp 8f4k2q '), 'SP-8F4K2Q')

assert.equal(normalizeUruguayPhone('099 123 456'), '+59899123456')
assert.equal(normalizeUruguayPhone('99 123 456'), '+59899123456')
assert.equal(normalizeUruguayPhone('598 99 123 456'), '+59899123456')
assert.equal(normalizeUruguayPhone('+54 9 11 1234 5678'), '+5491112345678')
assert.throws(() => normalizeUruguayPhone('123'), /teléfono válido/i)

console.log('Customer access helpers: OK')
