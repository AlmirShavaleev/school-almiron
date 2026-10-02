import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { cn } from '@/utils/cn'
import { homeActions, type HomeActionTone, type StudentTodo } from '@/lib/studentTodo'
import { extraLinks } from '@/lib/studentHome'

/**
 * §254. Кнопки-счётчики главной вместо длинных списков дел.
 *
 * Счёт — из того же `studentTodo`, что и раньше (одно определение
 * «просрочено/срок»); каждая кнопка ведёт на страницу ДЗ сразу нужным списком
 * (`/my-homework?show=…`). Кнопка с нулём не рисуется. «Без срока»,
 * «Тестирования» и «Новое открылось» — не кнопками, а строкой ссылок под ними:
 * они не горят, но потеряться не должны.
 */

const TONE: Record<HomeActionTone, string> = {
  bad:  'bg-verdict-bad-tint text-verdict-bad-ink',
  warn: 'bg-verdict-part-tint text-verdict-part-ink',
  soon: 'bg-primary-50 text-primary-700',
  ok:   'bg-verdict-ok-tint text-verdict-ok-ink',
}

export function HomeActions({ todo, loading, error }: { todo: StudentTodo; loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div data-testid="home-actions-loading" className="platform-surface rounded-2xl px-4 py-5 text-center text-sm text-graphite-400">
        Собираем, что сдать…
      </div>
    )
  }
  if (error) {
    return <div className="rounded-2xl bg-verdict-bad-tint px-4 py-3 text-sm text-verdict-bad-ink">{error}</div>
  }

  const actions = homeActions(todo)
  const extras = extraLinks(todo)

  return (
    <div className="space-y-2.5" data-testid="home-actions">
      {todo.isClear && (
        <div data-testid="student-todo-clear" className="rounded-2xl bg-verdict-ok-tint px-4 py-3 text-sm font-semibold text-verdict-ok-ink">
          Всё сдано, новых заданий нет
        </div>
      )}
      {actions.length > 0 && (
        <div className={cn(
          'grid grid-cols-1 gap-2.5',
          actions.length === 4 ? 'md:grid-cols-2 2xl:grid-cols-4' : 'md:grid-cols-3',
        )}>
          {actions.map(a => (
            <Link
              key={a.show}
              to={a.href}
              data-testid={`home-action-${a.show}`}
              className={cn(
                'group grid min-h-[76px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl px-4 py-3.5',
                'transition-transform hover:-translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 motion-reduce:transition-none',
                TONE[a.tone],
              )}
            >
              <span className="min-w-[1.4ch] text-center text-[2rem] font-extrabold leading-none tabular-nums">{a.count}</span>
              <span className="min-w-0">
                <span className="block text-[15px] font-bold leading-snug text-graphite-950">{a.title}</span>
                <span className="block truncate text-[13px] text-graphite-600">{a.caption}</span>
              </span>
              <ArrowRight size={20} strokeWidth={2.5} aria-hidden className="shrink-0" />
            </Link>
          ))}
        </div>
      )}
      {extras.length > 0 && (
        <div data-testid="home-extras" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 px-1 text-[13px] text-graphite-500">
          {extras.map((e, i) => (
            <span key={e.key} className="inline-flex min-w-0 max-w-full items-center">
              {i > 0 && <span aria-hidden className="mr-1.5 text-graphite-300">·</span>}
              {e.href
                ? <Link to={e.href} className="truncate font-medium text-primary-700 hover:underline">{e.text}</Link>
                : <span className="truncate">{e.text}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
