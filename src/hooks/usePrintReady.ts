import { type RefObject, useState, useEffect, useCallback } from 'react'

export interface PrintReadyState {
  ready:    boolean
  total:    number
  loaded:   number
  broken:   string[]
  timedOut: boolean
}

const TIMEOUT_MS = 8000

export function usePrintReady(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[],
): PrintReadyState & { recheck: () => void } {
  const [state, setState] = useState<PrintReadyState>({
    ready: false, total: 0, loaded: 0, broken: [], timedOut: false,
  })
  const [tick, setTick] = useState(0)

  const recheck = useCallback(() => {
    setState(s => ({ ...s, timedOut: false }))
    setTick(n => n + 1)
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const imgs = [...el.querySelectorAll<HTMLImageElement>('img')]
    const total = imgs.length

    if (total === 0) {
      setState({ ready: true, total: 0, loaded: 0, broken: [], timedOut: false })
      return
    }

    let loaded = 0
    const broken: string[] = []
    setState({ ready: false, total, loaded: 0, broken: [], timedOut: false })

    function onDone(src: string, ok: boolean) {
      if (!ok) broken.push(src)
      loaded++
      setState({ ready: loaded >= total, total, loaded, broken: [...broken], timedOut: false })
    }

    imgs.forEach(img => {
      if (img.complete) {
        onDone(img.src, img.naturalWidth > 0)
      } else {
        img.addEventListener('load',  () => onDone(img.src, true),  { once: true })
        img.addEventListener('error', () => onDone(img.src, false), { once: true })
      }
    })

    // Timeout: only show the timeout state while something is still pending.
    // Without this guard, a late timer can flip the UI into the warning state
    // even after every image has already finished loading.
    const timer = setTimeout(
      () => setState(s => (s.ready ? s : { ...s, timedOut: true })),
      TIMEOUT_MS,
    )
    return () => clearTimeout(timer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps])

  return { ...state, recheck }
}
