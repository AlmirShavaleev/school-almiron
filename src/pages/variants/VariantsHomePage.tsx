import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, FileText, Loader2, Users } from 'lucide-react'
import { useVariants } from '@/hooks/useVariants'
import { useVariantPassCounts } from '@/hooks/useVariantAutoBuild'

/**
 * Вход в раздел тестов: четыре экзамена, дальше — свои тесты по каждому.
 *
 * Надпись «профильная» на математике ЕГЭ сознательно не ставится: в каталоге
 * базовой математики нет вообще, поле экзамена одно, и уточнение было бы
 * неправдой. Появится база — появится и надпись.
 */

export interface ExamEntry {
  subject: 'math' | 'physics'
  examType: 'ege' | 'oge'
  title: string
}

export const EXAM_ENTRIES: ExamEntry[] = [
  { subject: 'math',    examType: 'ege', title: 'Математика ЕГЭ' },
  { subject: 'physics', examType: 'ege', title: 'Физика ЕГЭ' },
  { subject: 'math',    examType: 'oge', title: 'Математика ОГЭ' },
  { subject: 'physics', examType: 'oge', title: 'Физика ОГЭ' },
]

export function VariantsHomePage() {
  const navigate = useNavigate()
  const { variants, loading, error, reload } = useVariants()

  const variantIds = useMemo(() => variants.map(v => v.id), [variants])
  const passCounts = useVariantPassCounts(variantIds)

  const stats = useMemo(() => {
    const acc: Record<string, { tests: number; passed: number }> = {}
    for (const entry of EXAM_ENTRIES) {
      acc[`${entry.subject}:${entry.examType}`] = { tests: 0, passed: 0 }
    }
    for (const v of variants) {
      const key = `${v.subject}:${v.exam_type}`
      if (!acc[key]) continue
      acc[key].tests  += 1
      acc[key].passed += passCounts[v.id]?.passed ?? 0
    }
    return acc
  }, [variants, passCounts])

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Тесты</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Выберите экзамен — внутри ваши тесты и сборка новых
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 size={28} className="animate-spin text-primary-600" />
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center text-red-700">
          {error}
          <button onClick={reload} className="ml-2 underline text-sm">Повторить</button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {EXAM_ENTRIES.map(entry => {
            const stat = stats[`${entry.subject}:${entry.examType}`]
            return (
              <button
                key={`${entry.subject}-${entry.examType}`}
                onClick={() => navigate(`/variants/exam/${entry.subject}/${entry.examType}`)}
                className="group bg-white rounded-xl border border-gray-200 p-5 text-left transition-all hover:border-primary-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium text-gray-900">{entry.title}</span>
                  <ChevronRight
                    size={18}
                    className="text-gray-300 group-hover:text-primary-500 flex-shrink-0"
                  />
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <FileText size={12} />
                    {formatTests(stat.tests)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users size={12} />
                    {formatPassed(stat.passed)}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function formatTests(count: number): string {
  if (count === 0) return 'нет тестов'
  return `${count} ${plural(count, 'тест', 'теста', 'тестов')}`
}

export function formatPassed(count: number): string {
  if (count === 0) return 'ещё никто не прошёл'
  return `${count} ${plural(count, 'прохождение', 'прохождения', 'прохождений')}`
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return many
  const mod10 = n % 10
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}
