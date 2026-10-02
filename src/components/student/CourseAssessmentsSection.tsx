import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, ClipboardCheck } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatSpan } from '@/lib/mockExamLive'
import {
  BLOCK_TAG, assessmentBlocks, assessmentItems, liveItems, mskHm, pendingItems, readCollapsed, rowView,
  safeStorage, storeCollapsed, type AssessmentBlock, type AssessmentItem, type BlockKey, type MyAssessments, type Tone,
} from '@/lib/courseAssessments'

/**
 * §241. Раздел «Контрольные, самостоятельные и пробники» у ученика — над
 * программой курса, вместо прежнего блока «Пробники» (§224).
 *
 * Собирается сам (`my_course_assessments`): все темы курса с типом
 * проверочная/контрольная и все пробники группы. Внутри — блоки по ТИПАМ со
 * сводкой в заголовке; блок сворачивается (запоминается в localStorage).
 * Внутри блока — по дате, новые сверху. Идущая сейчас работа — ещё и строкой
 * над блоками с одной кнопкой «Продолжить» / «Начать»; если идёт пробник и
 * сверху уже стоит его баннер (§224.2), кнопку не дублируем (`primaryInBanner`).
 *
 * §259 (решение владельца 02.10): в разделе — только то, что ещё ждёт ученика
 * (`pendingItems`: работа до начала или идёт и не сдана, пробник до начала или
 * идёт). Прошедшее — написана, проверена, пропущена, итог пробника — сюда не
 * попадает; график пробников (прошлые итоги) и лист результата из раздела
 * убраны. Строка ведёт на работу: пробник — `/my-course/:group/mock/:id`,
 * КР — страницу темы.
 *
 * Раздела нет вовсе, если ничего не ждёт.
 */
export function CourseAssessmentsSection({ data, groupId, now, primaryInBanner = false }: {
  data: MyAssessments
  groupId: string
  /** «Сейчас» по часам базы — одно с баннером пробника. */
  now: number
  primaryInBanner?: boolean
}) {
  const navigate = useNavigate()
  const items = useMemo(() => pendingItems(assessmentItems(data, now)), [data, now])
  const blocks = useMemo(() => assessmentBlocks(items, now), [items, now])
  const live = useMemo(() => liveItems(items), [items])
  const [collapsed, setCollapsed] = useState<Set<BlockKey>>(() => readCollapsed(safeStorage(), groupId))

  if (items.length === 0) return null

  const toggle = (key: BlockKey) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      storeCollapsed(safeStorage(), groupId, next)
      return next
    })
  }

  const workPath = (i: AssessmentItem) => i.block === 'mock'
    ? `/my-course/${groupId}/mock/${i.mock.id}`
    : `/my-course/${groupId}/topic/${i.work.topic_id}`

  const onRow = (i: AssessmentItem) => navigate(workPath(i))

  // Идущий пробник уже стоит баннером наверху страницы — его строку не повторяем.
  const strips = live.filter(i => !(primaryInBanner && i.block === 'mock'))

  return (
    <section data-testid="assessments-section" aria-labelledby="assessments-title" className="flex flex-col gap-3">
      <h2 id="assessments-title" className="flex items-center gap-2 text-base font-extrabold text-primary-900">
        <ClipboardCheck size={17} className="shrink-0 text-primary-600" aria-hidden />
        Контрольные, самостоятельные и пробники
      </h2>

      {strips.map((i, idx) => (
        <LiveStrip key={i.key} item={i} to={workPath(i)} now={now} primary={idx === 0 && !primaryInBanner} />
      ))}

      {blocks.map(block => (
        <Block
          key={block.key}
          block={block}
          collapsed={collapsed.has(block.key)}
          onToggle={() => toggle(block.key)}
          now={now}
          onRow={onRow}
        />
      ))}
    </section>
  )
}

const TAG_CLS: Record<BlockKey, string> = {
  mock: 'bg-gold-300 text-gold-900',
  control: 'bg-primary-900 text-white',
  check: 'bg-primary-100 text-primary-800',
}

function Tag({ block }: { block: BlockKey }) {
  return (
    <span className={cn('min-w-[40px] shrink-0 rounded-md px-1.5 py-1 text-center text-[10.5px] font-extrabold leading-none', TAG_CLS[block])}>
      {BLOCK_TAG[block]}
    </span>
  )
}

function LiveStrip({ item, to, now, primary }: { item: AssessmentItem; to: string; now: number; primary: boolean }) {
  const title = item.block === 'mock' ? item.mock.title : item.work.title
  const ends = item.block === 'mock' ? item.mock.ends_at : item.work.closes_at
  const left = ends ? new Date(ends).getTime() - now : 0
  const started = item.block === 'mock' ? item.mock.has_work : item.work.status === 'draft'
  const action = started ? 'Продолжить' : 'Начать'
  return (
    <Link
      to={to}
      data-testid="assessments-live"
      data-primary={primary ? 'true' : 'false'}
      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-2xl bg-white px-3.5 py-3 shadow-[inset_3px_0_0_#1f55e0,0_4px_14px_rgba(20,32,61,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
    >
      <Tag block={item.block} />
      <span className="min-w-0">
        <b className="block truncate text-[13.5px] text-graphite-900">Идёт: {title}</b>
        <small className="block text-xs text-graphite-600">закроется в {mskHm(ends)} · осталось {formatSpan(left)}</small>
      </span>
      <span
        data-testid={primary ? 'assessments-live-primary' : 'assessments-live-open'}
        className={cn(
          'inline-flex min-h-9 items-center gap-1 whitespace-nowrap rounded-xl px-3 text-[13px] font-bold',
          primary ? 'bg-gradient-to-b from-action-from to-action-to text-white shadow-action' : 'bg-primary-50 text-primary-700',
        )}
      >
        {action}<ChevronRight size={14} aria-hidden />
      </span>
    </Link>
  )
}

function Block({ block, collapsed, onToggle, now, onRow }: {
  block: AssessmentBlock
  collapsed: boolean
  onToggle: () => void
  now: number
  onRow: (i: AssessmentItem) => void
}) {
  const bodyId = `assessments-block-${block.key}`
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(20,32,61,0.05),0_4px_14px_rgba(20,32,61,0.05)]" data-testid="assessments-block" data-block={block.key}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        data-testid="assessments-block-toggle"
        className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-3 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400"
      >
        <Tag block={block.key} />
        <span className="min-w-0">
          <b className="block text-sm font-bold text-primary-900">{block.title} · {block.items.length}</b>
          {block.summary && <small className="block text-xs text-graphite-600" data-testid="assessments-block-summary">{block.summary}</small>}
        </span>
        <ChevronDown size={18} aria-hidden className={cn('text-graphite-500 transition-transform motion-reduce:transition-none', collapsed && '-rotate-90')} />
      </button>
      {!collapsed && (
        <div id={bodyId}>
          <ul>
            {block.items.map(i => <Row key={i.key} item={i} now={now} onClick={() => onRow(i)} />)}
          </ul>
        </div>
      )}
    </div>
  )
}

const RESULT_TONE: Record<Tone, string> = {
  ok: 'text-verdict-ok-ink',
  part: 'text-verdict-part-ink',
  bad: 'text-verdict-bad-ink',
  wait: 'font-bold text-gold-700',
  miss: 'font-bold text-verdict-bad-ink',
  live: 'font-bold text-primary-700',
  muted: 'text-graphite-600',
}

function Row({ item, now, onClick }: { item: AssessmentItem; now: number; onClick: () => void }) {
  const v = rowView(item, now)
  const title = item.block === 'mock' ? item.mock.title : item.work.title
  return (
    <li className="border-t border-slate-100">
      <button
        type="button"
        onClick={onClick}
        data-testid="assessments-row"
        data-phase={item.phase}
        className={cn(
          'grid w-full grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400',
          item.live && 'bg-primary-50 shadow-[inset_3px_0_0_#1f55e0] hover:bg-primary-50',
        )}
      >
        <span className="text-[11.5px] font-bold text-graphite-600" data-testid="assessments-row-date">{v.date}</span>
        <span className="min-w-0">
          <b className="block text-[13.5px] font-semibold leading-snug text-graphite-900">{title}</b>
          {v.sub && <small className="block text-xs text-graphite-600" data-testid="assessments-row-sub">{v.sub}</small>}
        </span>
        <span className="whitespace-nowrap text-right text-xs text-graphite-600" data-testid="assessments-row-result">
          {v.result.kind === 'score' ? (
            <>
              <b className={cn('block text-[15px] font-extrabold tabular-nums text-graphite-900', v.result.tone && RESULT_TONE[v.result.tone])}>{v.result.value}</b>
              {v.result.caption}
            </>
          ) : (
            <span className={RESULT_TONE[v.result.tone]}>{v.result.text}</span>
          )}
        </span>
      </button>
    </li>
  )
}
