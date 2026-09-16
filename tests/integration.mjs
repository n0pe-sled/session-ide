/**
 * Host-half integration check for dsh-session-ide: exercises the real
 * IdeFileManager against a temp workspace — list/read/write round-trips,
 * containment (path traversal + symlink escape), binary detection, caps,
 * and the disabled/read-only switches.
 *
 * Run with: node tests/integration.mjs (after `pnpm build`; imports lib/index.js)
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IdeFileManager } from '../lib/index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-ide-'))
await writeFile(join(root, 'a.txt'), 'hello')
await mkdir(join(root, 'sub'))
await writeFile(join(root, 'sub', 'b.md'), '# hi')
await writeFile(join(root, 'ignored.txt'), 'x')

const base = { enabled: true, writable: true, maxReadBytes: 1024 * 1024, maxWriteBytes: 1024 * 1024, ignore: ['ignored.txt'] }
const ctx = { sessions: { get: () => ({ header: { cwd: root } }) } }
const mgr = new IdeFileManager(ctx, base)

// List: directories first, then files, ignore applied, root '' works.
const list = await mgr.list({ sessionId: 's', path: '' })
assert.deepEqual(list.entries.map(entry => entry.name), ['sub', 'a.txt'])
assert.equal(list.path, '')

// List a subdirectory.
const sub = await mgr.list({ sessionId: 's', path: 'sub' })
assert.deepEqual(sub.entries.map(entry => entry.name), ['b.md'])

// Read round-trip.
const read = await mgr.read({ sessionId: 's', path: 'a.txt' })
assert.equal(read.content, 'hello')
assert.equal(read.binary, false)
assert.equal(read.size, 5)

// Write existing file.
const written = await mgr.write({ sessionId: 's', path: 'a.txt', content: 'bye' })
assert.equal(written.size, 3)
assert.equal((await mgr.read({ sessionId: 's', path: 'a.txt' })).content, 'bye')

// Create a new file (parent exists).
await mgr.write({ sessionId: 's', path: 'new.txt', content: 'x' })
assert.equal((await mgr.read({ sessionId: 's', path: 'new.txt' })).content, 'x')

// Binary detection.
await writeFile(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]))
assert.equal((await mgr.read({ sessionId: 's', path: 'bin.dat' })).binary, true)

// Containment: no traversal, no absolute paths, symlinked escape.
await assert.rejects(() => mgr.read({ sessionId: 's', path: '../etc/passwd' }), /path-outside-workspace/)
await assert.rejects(() => mgr.read({ sessionId: 's', path: '/etc/passwd' }), /path-outside-workspace/)
await assert.rejects(() => mgr.read({ sessionId: 's', path: 'a/../../etc/passwd' }), /path-outside-workspace/)
await symlink('/etc/passwd', join(root, 'evil'))
await assert.rejects(() => mgr.read({ sessionId: 's', path: 'evil' }), /path-outside-workspace/)

// Not found / not a directory.
await assert.rejects(() => mgr.read({ sessionId: 's', path: 'missing.txt' }), /not-found/)
await assert.rejects(() => mgr.list({ sessionId: 's', path: 'a.txt' }), /not-a-directory/)

// Size cap and write cap.
await writeFile(join(root, 'big.txt'), '0123456789')
const tiny = new IdeFileManager(ctx, { ...base, maxReadBytes: 4 })
await assert.rejects(() => tiny.read({ sessionId: 's', path: 'big.txt' }), /too-large/)
const smallWrite = new IdeFileManager(ctx, { ...base, maxWriteBytes: 4 })
await assert.rejects(() => smallWrite.write({ sessionId: 's', path: 'a.txt', content: '012345' }), /too-large/)

// Disabled and read-only switches.
const off = new IdeFileManager(ctx, { ...base, enabled: false })
await assert.rejects(() => off.list({ sessionId: 's', path: '' }), /disabled/)
const ro = new IdeFileManager(ctx, { ...base, writable: false })
await assert.rejects(() => ro.write({ sessionId: 's', path: 'a.txt', content: 'nope' }), /readonly/)

await rm(root, { recursive: true, force: true })
console.log('integration ok')
