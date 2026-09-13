import { useState } from 'react'
import { Layers, AlertTriangle, Loader2, RefreshCw } from 'lucide-react'
import { useTopicTemplateLink } from '@/hooks/useTopicTemplateLink'

/**
 * Полоса про каркас на окне темы (§172).
 *
 * В каркасе — «изменения видны в N классах: …», чтобы владелец знал, куда
 * уезжает его правка, ещё до того как нажмёт. В классе — «тема из каркаса»,
 * чтобы не искать, почему материал не правится.
 *
 * Ниже — расхождения, которые синхронизация не смогла повторить. Правка
 * каркаса не откатывается никогда, поэтому единственный честный способ о них
 * сказать — показать здесь, а не промолчать.
 */
export function TopicTemplateBanner({ topicId }: { topicId: string }) {
  const { link, busy, error, repeat } = useTopicTemplateLink(topicId)
  const [done, setDone] = useState(false)

  const nothingToSay = !link.is_template && !link.source_topic_id && link.issues.length === 0
  if (nothingToSay) return null

  return (
    <div className="space-y-2">
      {link.is_template && (
        <div
          data-testid="template-banner"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-indigo-50 px-3 py-2 text-sm text-indigo-900"
        >
          <Layers size={14} className="shrink-0 text-indigo-600" />
          {link.copies.length === 0 ? (
            <span>Каркас курса · копий курса пока нет</span>
          ) : (
            <span>
              Каркас курса · изменения видны в {link.copies.length}{' '}
              {plural(link.copies.length, 'классе', 'классах', 'классах')}:{' '}
              <span className="text-indigo-700">{link.copies.map(c => c.course).join(', ')}</span>
            </span>
          )}
        </div>
      )}

      {!link.is_template && link.source_topic_id && (
        <div
          data-testid="reflection-banner"
          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <Layers size={14} className="shrink-0 text-amber-600" />
          <span>
            Тема из каркаса{link.source_course ? ` «${link.source_course}»` : ''} — материалы и задачи
            меняются в нём, здесь они только показываются.
          </span>
        </div>
      )}

      {link.issues.length > 0 && (
        <div
          data-testid="template-issues"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={14} className="shrink-0 text-amber-600" />
            Не удалось повторить в классах
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-800">
            {link.issues.map(i => (
              <li key={i.id}>
                {i.course}: {i.detail ?? i.kind}
              </li>
            ))}
          </ul>

          {link.is_template && (
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                data-testid="template-repeat"
                disabled={busy}
                onClick={() => { void repeat().then(ok => setDone(ok)) }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                Повторить
              </button>
              {done && !busy && <span className="text-xs text-amber-700">Повторено</span>}
            </div>
          )}

          {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
        </div>
      )}
    </div>
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
