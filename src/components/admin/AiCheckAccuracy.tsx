import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { accuracyErrorText, accuracyLines, accuracyTotals, type AiAccuracyLine } from '@/lib/aiCheckAccuracy'
import { plural } from '@/lib/plural'
import { cn } from '@/utils/cn'

/**
 * §238. «ИИ-проверка: точность за 7 дней» — вкладка «Учёба» админки.
 *
 * Та же таблица, из которой выведен светофор экрана проверки (34 работы, 336
 * заданий), но по свежим вердиктам: видно, помогли ли правила, без ощущений.
 * Считает база (`ai_check_accuracy`, PENDING_238.sql): последний завершённый
 * черновик ИИ каждой работы против таблицы преподавателя. Хук внутри блока, а
 * не на странице: пока «Учёбу» не открыли, запроса нет.
 */
export function AiCheckAccuracy() {
  const [lines, setLines] = useState<AiAccuracyLine[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // `as any`: функция из PENDING_238 — сгенерированные типы базы её не знают
      // (CLAUDE.md: руками не дописывать).
      const { data, error: err } = await (supabase as any).rpc('ai_check_accuracy')
      if (cancelled) return
      if (err) {
        setError(accuracyErrorText(err))
        return
      }
      setLines(accuracyLines(Array.isArray(data) ? data : []))
    })()
    return () => { cancelled = true }
  }, [])

  const totals = lines ? accuracyTotals(lines) : null

  return (
    <section data-testid="ai-check-accuracy" className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <span className="text-slate-500"><Sparkles size={16} /></span>
          <h3 className="text-sm font-semibold text-graphite-950">ИИ-проверка: точность за 7 дней</h3>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          Черновик ИИ против вашей таблицы проверки — по работам, где за неделю поставлен вердикт.
          Зелёные строки экрана проверки — «верно, ответ совпал».
        </p>
      </div>

      {error ? (
        <p data-testid="ai-check-accuracy-error" className="rounded-xl bg-graphite-50 px-3 py-2 text-sm text-graphite-600">{error}</p>
      ) : !lines ? (
        <p className="py-4 text-center text-sm text-slate-400">Считаем…</p>
      ) : totals && totals.tasks === 0 ? (
        <p data-testid="ai-check-accuracy-empty" className="py-4 text-center text-sm text-slate-400">
          За неделю нет проверенных работ с черновиком ИИ.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-[0.04em] text-slate-400">
                  <th className="border-b border-slate-200 px-2 py-1.5 font-bold">ИИ сказал</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-right font-bold">заданий</th>
                  <th className="border-b border-slate-200 px-2 py-1.5 text-right font-bold">исправлено</th>
                </tr>
              </thead>
              <tbody>
                {lines!.map(line => (
                  <tr key={line.key} data-testid="ai-check-accuracy-row" data-key={line.key}>
                    <td className="border-b border-slate-100 px-2 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0 rounded-[3px]', line.green ? 'bg-verdict-ok' : 'bg-verdict-part')} />
                        {line.label}
                      </span>
                    </td>
                    <td className="border-b border-slate-100 px-2 py-1.5 text-right">{line.tasks}</td>
                    <td className={cn('border-b border-slate-100 px-2 py-1.5 text-right', line.share != null && line.share >= 50 && 'font-semibold')}>
                      {line.share == null ? '—' : `${line.changed} · ${line.share} %`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totals && (
            <p data-testid="ai-check-accuracy-totals" className="mt-2 text-xs text-slate-500">
              {totals.tasks} {plural(totals.tasks, 'задание', 'задания', 'заданий')}
              {totals.greenShare != null && <> · зелёных {totals.greenShare} %</>}
              {' · '}правок в зелёных: {totals.greenChanged}
            </p>
          )}
        </>
      )}
    </section>
  )
}
