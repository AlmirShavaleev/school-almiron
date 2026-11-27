import { lazy, type ComponentType } from 'react'

export type ChunkFailure = { type: 'chunk_js' | 'chunk_css'; resource: string | null }

export class PageChunkError extends Error {
  readonly chunk: string
  readonly failure: ChunkFailure

  constructor(chunk: string, failure: ChunkFailure, cause: unknown) {
    super('Page resource failed to load', { cause })
    this.name = 'PageChunkError'
    this.chunk = chunk
    this.failure = failure
  }
}

export function safeAssetResource(candidate: string): string | null {
  try {
    const url = new URL(candidate, window.location.origin)
    if (url.origin === window.location.origin && /^\/assets\/(?:[\w-]+\/)*[\w.-]+\.(?:m?js|css)$/.test(url.pathname)) {
      return url.pathname
    }
  } catch { /* A browser error can omit the URL. */ }
  return null
}

export function classifyChunkFailure(error: unknown): ChunkFailure | null {
  if (error instanceof PageChunkError) return error.failure
  const message = error instanceof Error ? error.message : String(error ?? '')
  const css = /Unable to preload CSS/i.test(message)
  if (!css && !(error instanceof Error && error.name === 'ChunkLoadError') &&
      !/dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \S+ failed/i.test(message)) {
    return null
  }
  const candidate = message.match(/(?:https?:\/\/[^\s"'<>]+|\/assets\/[^\s"'<>]+)/i)?.[0]
  const resource = candidate ? safeAssetResource(candidate) : null
  return { type: css || resource?.endsWith('.css') ? 'chunk_css' : 'chunk_js', resource }
}

export function isChunkLoadError(error: unknown): boolean {
  return classifyChunkFailure(error) !== null
}

export function lazyPage<T extends ComponentType<any>>(name: string, load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load()
    } catch (error) {
      const failure = classifyChunkFailure(error)
      if (!failure) throw error
      throw new PageChunkError(name, failure, error)
    }
  })
}
