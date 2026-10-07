/**
 * §222b. `check-homework-ai/pdf.ts` — разбор PDF и base64, вынесенные из
 * index.ts для общей работы с check-mock-exam-ai. Рендер (PDFium) в vitest не
 * гоняется; здесь — что разбор берёт текст из file_annotations, шлёт модель
 * разбора от вызывающего и движок явно.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Строкой, чтобы tsc -b не уходил в Deno-код (npm:-импорты рендера).
const PDF_PATH = '../../../supabase/functions/check-homework-ai/pdf.ts'
type ParsePdf = (ai: { apiKey: string; baseUrl: string; parseModel: string }, file: { dataUrl: string; fileName: string; engine: string }) => Promise<{ text: string; pages: number }>
let parsePdf: ParsePdf
let base64: (bytes: Uint8Array) => string

beforeAll(async () => {
  const m = await import(/* @vite-ignore */ PDF_PATH) as { parsePdf: ParsePdf; base64: (b: Uint8Array) => string }
  parsePdf = m.parsePdf
  base64 = m.base64
})

afterEach(() => vi.unstubAllGlobals())

describe('pdf.ts', () => {
  it('parsePdf: модель разбора — от вызывающего, движок — явно, текст — из аннотаций', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'x', annotations: [{ file: { content: [{ type: 'text', text: 'Решение варианта 2' }, { type: 'text', text: 'стр. 2' }] } }] } }],
      }), { status: 200 })
    })
    const r = await parsePdf({ apiKey: 'k', baseUrl: 'https://p.invalid/v1', parseModel: 'cheap/model' }, { dataUrl: 'data:application/pdf;base64,AA==', fileName: 's.pdf', engine: 'cloudflare-ai' })
    expect(r).toEqual({ text: 'Решение варианта 2\n\nстр. 2', pages: 2 })
    expect(calls[0].url).toBe('https://p.invalid/v1/chat/completions')
    expect(calls[0].body).toMatchObject({ model: 'cheap/model', max_tokens: 1, plugins: [{ id: 'file-parser', pdf: { engine: 'cloudflare-ai' } }] })
  })

  it('parsePdf: отказ без текста — исключение с причиной поставщика', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: { message: 'no credits' } }), { status: 402 }))
    await expect(parsePdf({ apiKey: 'k', baseUrl: 'https://p.invalid', parseModel: 'm' }, { dataUrl: 'd', fileName: 'f', engine: 'mistral-ocr' }))
      .rejects.toThrow('no credits')
  })

  it('base64 — без разворота большого массива в аргументы', () => {
    expect(base64(new Uint8Array([104, 105]))).toBe('aGk=')
    expect(base64(new Uint8Array(200_000)).length).toBe(266_668)
  })
})
