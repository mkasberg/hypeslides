import { describe, expect, it } from 'vitest'
import {
  DAY, HOUR, PRUNE_POLICY, backupFileName, formatStamp, hash16, makeDraft, mergeSnapshots, parseBackupFileName,
  parseDraft, parseSnapshotFileName, parseSnapshotId, parseStamp, recoveryFor, selectPrunable, sha256Hex,
  snapshotFileName, snapshotId,
} from './history'
import type { SnapshotInfo } from './history'
import { createState, restoreVersion } from './commands'

describe('sha256', () => {
  it('matches known vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
    expect(sha256Hex('héllo ✓')).toHaveLength(64)
  })
  it('hash16 is the 16-char prefix', () => {
    expect(hash16('abc')).toBe('ba7816bf8f01cfea')
  })
})

describe('names and stamps', () => {
  const t = Date.UTC(2026, 0, 2, 3, 4, 5, 67)
  it('formats Hype-style UTC stamps and round-trips', () => {
    expect(formatStamp(t)).toBe('20260102-030405-067')
    expect(parseStamp('20260102-030405-067')).toBe(t)
    expect(parseStamp('nope')).toBeNull()
  })
  it('names folder backups like Hype', () => {
    const name = backupFileName('presentation.md', t, 'ba7816bf8f01cfea')
    expect(name).toBe('presentation.md.20260102-030405-067-ba7816bf8f01cfea.bak')
    expect(parseBackupFileName('presentation.md', name)).toEqual({ timestamp: t, hash: 'ba7816bf8f01cfea' })
    expect(parseBackupFileName('other.md', name)).toBeNull()
    expect(parseBackupFileName('presentation.md', 'presentation.md.bak')).toBeNull()
  })
  it('names OPFS snapshots', () => {
    const name = snapshotFileName(t, 'ba7816bf8f01cfea')
    expect(name).toBe('20260102-030405-067-ba7816bf8f01cfea.md')
    expect(parseSnapshotFileName(name)).toEqual({ timestamp: t, hash: 'ba7816bf8f01cfea' })
    expect(parseSnapshotFileName('junk.md')).toBeNull()
  })
  it('validates ids', () => {
    expect(parseSnapshotId(snapshotId('folder', 'a.bak'))).toEqual({ source: 'folder', file: 'a.bak' })
    expect(parseSnapshotId('opfs:../x')).toBeNull()
    expect(parseSnapshotId('other:x')).toBeNull()
    expect(parseSnapshotId('x')).toBeNull()
  })
})

const info = (source: 'opfs' | 'folder', timestamp: number, hash: string): SnapshotInfo => ({
  id: `${source}:${hash}-${timestamp}`, timestamp, size: 1, source, hash,
})

describe('mergeSnapshots', () => {
  it('sorts newest first and dedupes by content, preferring OPFS', () => {
    const merged = mergeSnapshots([
      [info('opfs', 100, 'a'), info('opfs', 300, 'c')],
      [info('folder', 200, 'a'), info('folder', 150, 'b')],
    ])
    expect(merged.map((s) => [s.hash, s.source])).toEqual([['c', 'opfs'], ['b', 'folder'], ['a', 'opfs']])
  })
})

describe('selectPrunable', () => {
  const now = 100 * DAY
  const entry = (age: number) => ({ id: `e${age}`, timestamp: now - age })
  it('keeps everything from the last day', () => {
    const entries = [0, 1000, HOUR, 23 * HOUR].map(entry)
    expect(selectPrunable(entries, now)).toEqual([])
  })
  it('thins older entries to one per hour, then one per day', () => {
    const base = 3 * DAY // aligned to hour boundaries below
    const hourly = [entry(base + 1000), entry(base + 2000), entry(base + HOUR + 5)]
    const daily = [entry(20 * DAY + 10), entry(20 * DAY + 20)]
    const dropped = selectPrunable([...hourly, ...daily], now)
    expect(dropped).toHaveLength(2)
    // The newest of each bucket survives.
    expect(dropped).toContain(`e${base + 2000}`)
    expect(dropped).toContain(`e${20 * DAY + 20}`)
  })
  it('always keeps the newest and caps the count', () => {
    const many = Array.from({ length: PRUNE_POLICY.maxCount + 50 }, (_, i) => entry(i * 1000))
    const dropped = selectPrunable(many, now)
    expect(dropped).toHaveLength(50)
    expect(dropped).not.toContain('e0')
    expect(selectPrunable([entry(200 * DAY)], now)).toEqual([])
  })
})

describe('drafts', () => {
  it('round-trips and rejects damage', () => {
    const d = makeDraft('untitled', 'hello', 'saved', 2, 1, 1234)
    expect(parseDraft(JSON.stringify(d))).toEqual(d)
    expect(parseDraft(JSON.stringify({ ...d, source: 'tampered' }))).toBeNull()
    expect(parseDraft('{not json')).toBeNull()
    expect(parseDraft(JSON.stringify({ ...d, version: 2 }))).toBeNull()
  })
  it('offers recovery only for unsaved drafts, flagging conflicts', () => {
    const d = makeDraft('k', 'edited', 'base', 0, 0, 1)
    expect(recoveryFor(null, 'base')).toBeNull()
    expect(recoveryFor(d, 'edited')).toBeNull()
    expect(recoveryFor(d, 'base')).toEqual({ draft: d, conflict: false })
    expect(recoveryFor(d, 'changed elsewhere')?.conflict).toBe(true)
  })
})

describe('restoreVersion command', () => {
  it('replaces the source as an edit and clamps the selection', () => {
    const s = { ...createState('# A\n\n---\n\n# B\n'), selected: 1, anchor: 1 }
    const next = restoreVersion(s, '# Only\n')
    expect(next.source).toBe('# Only\n')
    expect(next.selected).toBe(0)
  })
})
