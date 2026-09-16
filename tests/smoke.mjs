/**
 * Host-half smoke check for dsh-session-ide (no test framework): stubs the
 * injected services, calls apply(), and asserts the Typert contribution
 * (three endpoints), the receiver surface, and schema defaults.
 *
 * Run with: node tests/smoke.mjs (after `pnpm build`; imports lib/index.js)
 */

import assert from 'node:assert/strict'
import { apply, Config, inject, name, IdeFileManager } from '../lib/index.js'

const calls = {
  contributions: [],
  provided: [],
}

const fakeSessions = {
  get: () => undefined,
}

const fakeTypert = {
  register(contribution) {
    calls.contributions.push(contribution)
    return () => Promise.resolve()
  },
}

const ctx = {
  sessions: fakeSessions,
  typert: fakeTypert,
  provide(key, value) {
    calls.provided.push([key, value])
  },
  get: () => undefined,
}

// Static plugin metadata.
assert.equal(name, 'session-ide')
assert.deepEqual(inject, ['sessions', 'typert'])
assert.equal(typeof Config, 'function') // the schemastery schema is callable
assert.equal(typeof apply, 'function')
assert.equal(typeof IdeFileManager, 'function')

// Schema defaults flow to the resolved config.
const defaults = Config({})
assert.equal(defaults.enabled, true)
assert.equal(defaults.writable, true)
assert.equal(defaults.maxReadBytes, 1024 * 1024)
assert.equal(defaults.maxWriteBytes, 4 * 1024 * 1024)
assert.ok(Array.isArray(defaults.ignore))
assert.deepEqual(Config({ writable: false }), { ...defaults, writable: false })

// Apply with resolved config.
await apply(ctx, defaults)

// Exactly one Typert contribution with the three endpoints and an empty model.
assert.equal(calls.contributions.length, 1, 'exactly one typert contribution')
const [contribution] = calls.contributions
assert.equal(contribution.package, 'dsh-session-ide')
assert.equal(contribution.face, 'host')
assert.deepEqual(contribution.model, { services: [], events: [], objects: [] })
const endpoints = contribution.invocations.map(descriptor => `${descriptor.namespace}/${descriptor.method}`)
assert.deepEqual(endpoints, [
  'sessionIde/list',
  'sessionIde/read',
  'sessionIde/write',
])

// The receiver is provided under the service key with the three verbs.
const receiverEntry = calls.provided.find(([key]) => key === 'sessionIde')
assert.ok(receiverEntry, 'sessionIde receiver is provided')
const receiver = receiverEntry[1]
for (const verb of ['list', 'read', 'write']) {
  assert.equal(typeof receiver[verb], 'function', `receiver.${verb} is callable`)
}
assert.ok(receiver.typertRemote, 'receiver is bound to the typert gateway')

console.log('smoke ok')
