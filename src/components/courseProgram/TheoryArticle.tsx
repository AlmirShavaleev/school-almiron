import { useEffect, useMemo, useRef, useState } from 'react'
import { escapeHtml, figureUrl } from '@/lib/catalogMarkdown'
import { catalogFiguresBaseUrl, renderCatalogContent } from '@/lib/catalogContent'
import { upgradeMathIn } from '@/lib/katexLoader'
import { boxLabel, parseTheory, type TheoryBlock, type TheoryBoxKind } from '@/lib/theoryMarkdown'
import { cn } from '@/utils/cn'

/**
 * Теория темы страницей (источник и разметка — `theoryMarkdown.ts`).
 *
 * HTML каждого куска строит `renderCatalogContent` — тот же безопасный рендер,
 * что у условий задач: текст экранируется, формулы KaTeX без trust, рисунки
 * только из бакета каталога. KaTeX подгружается лениво и дорисовывает формулы
 * на месте; в ответе «Проверь себя» — когда ответ открыли.
 */

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={cn('catalog-html theory-md', className)} dangerouslySetInnerHTML={{ __html: html }} />
}

const BOX_STYLE: Record<TheoryBoxKind, string> = {
  rule: 'border border-primary-300 bg-primary-50/60',
  example: 'border-l-4 border-gray-300 bg-gray-50',
  remember: 'border-l-4 border-primary-500 bg-primary-50/60',
  trap: 'border-l-4 border-orange-400 bg-orange-50',
}

const LABEL_STYLE: Record<TheoryBoxKind, string> = {
  rule: 'text-primary-700',
  example: 'text-gray-600',
  remember: 'text-primary-700',
  trap: 'text-orange-700',
}

function Figures({ items }: { items: { caption: string; path: string }[] }) {
  const base = catalogFiguresBaseUrl()
  return (
    <div className={cn('my-3 grid gap-4', items.length > 1 && 'sm:grid-cols-2')}>
      {items.map((f, i) => {
        const url = figureUrl(base, f.path.replace(/^fig:/, ''))
        return (
          <figure key={i} className="m-0 text-center">
            {url
              ? <img src={url} alt={f.caption || 'Рисунок'} loading="lazy" decoding="async"
                  className="mx-auto h-auto max-w-full" />
              : <span className="text-sm text-gray-400">Рисунок не найден</span>}
            {f.caption && (
              <figcaption className="mt-1 text-sm leading-snug text-gray-500"
                dangerouslySetInnerHTML={{ __html: escapeHtml(f.caption) }} />
            )}
          </figure>
        )
      })}
    </div>
  )
}

function Block({ block }: { block: TheoryBlock }) {
  switch (block.type) {
    case 'md':
      return <Html html={renderCatalogContent(block.md)} />
    case 'figures':
      return <Figures items={block.items} />
    case 'box': {
      const label = boxLabel(block.box, block.md)
      return (
        <div className={cn('my-3 rounded-xl px-4 py-3', BOX_STYLE[block.box])} data-box={block.box}>
          {label && <div className={cn('mb-1 text-[13px] font-semibold uppercase tracking-wide', LABEL_STYLE[block.box])}>{label}</div>}
          <Html html={renderCatalogContent(block.md)} />
        </div>
      )
    }
    case 'check':
      return <CheckBlock question={block.question} answer={block.answer} />
  }
}

/** «Проверь себя»: ответ открывается по кнопке, формулы в нём дорисовываются после показа. */
function CheckBlock({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) void upgradeMathIn(ref.current) }, [open])
  return (
    <div ref={ref} className="my-3 rounded-xl border border-gray-200 bg-white px-4 py-3" data-box="check">
      <div className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-primary-700">Проверь себя</div>
      <Html html={renderCatalogContent(question)} />
      {answer && (
        <>
          <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
            className="mt-2 rounded-lg border border-primary-200 px-3 py-1.5 text-[15px] font-medium text-primary-700 hover:bg-primary-50">
            {open ? 'Скрыть ответ' : 'Показать ответ'}
          </button>
          {open && <Html html={renderCatalogContent(answer)} className="mt-2 rounded-lg bg-gray-50 px-3 py-2" />}
        </>
      )}
    </div>
  )
}

export function TheoryArticle({ source }: { source: string }) {
  const sections = useMemo(() => parseTheory(source), [source])
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { void upgradeMathIn(ref.current) }, [sections])

  if (!sections.length) return null
  return (
    <article ref={ref} className="theory-article text-base leading-relaxed text-gray-800 sm:text-[17px]" data-testid="theory-article">
      {sections.map((s, i) => (
        <section key={i} className={cn(i > 0 && 'mt-6 border-t border-gray-100 pt-5')}>
          {s.title && <h3 className="mb-3 text-xl font-semibold text-gray-900 sm:text-[22px]">{s.title}</h3>}
          {s.blocks.map((b, j) => <Block key={j} block={b} />)}
        </section>
      ))}
    </article>
  )
}
