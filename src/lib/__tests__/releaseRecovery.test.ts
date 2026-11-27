import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('release recovery', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('__ALMIRON_BUILD_ID__', 'build-a')
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('deduplicates checks and confirms a different build only from valid JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ build_id: 'build-b' }))
    vi.stubGlobal('fetch', fetcher)
    const { checkRelease } = await import('@/lib/releaseRecovery')
    const first = checkRelease()
    expect(checkRelease()).toBe(first)
    await expect(first).resolves.toBe('updated')
    expect(fetcher).toHaveBeenCalledTimes(1)
    fetcher.mockResolvedValueOnce(new Response('<html>', { headers: { 'Content-Type': 'text/html' } }))
    await expect(checkRelease()).resolves.toBe('unavailable')
    fetcher.mockResolvedValueOnce(Response.json({ build_id: 'build-a' }))
    await expect(checkRelease()).resolves.toBe('current')
    fetcher.mockRejectedValueOnce(new TypeError('failed to fetch'))
    await expect(checkRelease()).resolves.toBe('offline')
  })

  it('blocks a refresh when any write is unsafe', async () => {
    const { holdDraftReload: hold } = await import('@/lib/studentDrafts')
    const release = hold()
    const callback = vi.fn()
    const { requestPageReload } = await import('@/lib/releaseRecovery')
    expect(requestPageReload(callback)).toBe(false)
    expect(callback).not.toHaveBeenCalled()
    release()
  })

  it('retains text by student and attempt when storage fails and keeps reload blocked', async () => {
    const { clearStudentDraft, readStudentDraft, saveStudentDraft, studentDraftKey, hasUnsafeDrafts } = await import('@/lib/studentDrafts')
    const key = studentDraftKey('homework', 'fake-student', 'attempt-a')
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('blocked') })
    saveStudentDraft(key, 'answer')
    expect(hasUnsafeDrafts()).toBe(true)
    expect(readStudentDraft(key, '')).toBe('answer')
    expect(readStudentDraft(studentDraftKey('homework', 'another-student', 'attempt-a'), '')).toBe('')
    spy.mockRestore()
    clearStudentDraft(key)
    expect(hasUnsafeDrafts()).toBe(false)
  })
})
