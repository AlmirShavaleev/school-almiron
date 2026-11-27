import { describe, expect, it } from 'vitest'
import { classifyChunkFailure, isChunkLoadError, PageChunkError } from '@/lib/lazyPage'

describe('classifyChunkFailure', () => {
  it('understands native import failures without retaining query, hash or remote URLs', () => {
    const url = `${location.origin}/assets/TopicPage-abc.js?access_token=secret#fragment`
    expect(classifyChunkFailure(new Error(`Failed to fetch dynamically imported module: ${url}`)))
      .toEqual({ type: 'chunk_js', resource: '/assets/TopicPage-abc.js' })
    expect(classifyChunkFailure(new Error(
      'error loading dynamically imported module: https://remote.example/assets/TopicPage-abc.js',
    ))).toEqual({ type: 'chunk_js', resource: null })
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading chunk 42 failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('ChunkLoadError'))).toBe(true)
  })

  it('recognizes Vite CSS preload failures', () => {
    const failure = { type: 'chunk_css', resource: '/assets/TopicPage-abc.css' } as const
    expect(classifyChunkFailure(new Error('Unable to preload CSS for /assets/TopicPage-abc.css?k=secret'))).toEqual(failure)
    expect(classifyChunkFailure(new PageChunkError('TopicPage', failure, null))).toEqual(failure)
  })

  it('leaves application exceptions and non-errors alone', () => {
    expect(isChunkLoadError(new TypeError('x is not a function'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
