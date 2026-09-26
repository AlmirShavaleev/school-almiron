/**
 * §228. Общие выдуманные данные для тестов страницы пробника и проверки
 * работы: группа из четырёх, шаблон на 5 номеров (1–3 — первая часть).
 */
export const TPL = { id: 't1', title: 'ЕГЭ математика, профиль', subject: 'math', exam_type: 'ege', year: 2027, max_points: [1, 1, 1, 2, 3], part1_last: 3, score_scale: null }
const MIN = 60_000

export function examRow(startOffsetMin: number | null) {
  const starts = startOffsetMin == null ? null : new Date(Date.now() + startOffsetMin * MIN).toISOString()
  return {
    id: 'ex1', title: 'Пробник №4', date: starts ?? '2026-10-03T07:00:00.000Z', group_id: 'g1', template_id: 't1',
    starts_at: starts, duration_minutes: 235, photo_grace_minutes: 15, condition_path: 'ex1/condition/1_v.pdf', solution_path: 'ex1/solution/1_s.pdf',
    groups: { name: '11А профиль', course_id: 'c1' }, mock_exam_templates: TPL,
  }
}

const stu = (id: string, name: string) => ({ student_id: id, students: { id, profile_id: `p-${id}`, profiles: { full_name: name } } })
export const ROSTER = [stu('a', 'Гарипов Тимур'), stu('b', 'Белов Артём'), stu('c', 'Зайцев Роман'), stu('d', 'Каримова Алсу')]

const cells = (id: string, pts: (number | null)[], auto: boolean[] = []) =>
  pts.flatMap((p, i) => (p == null ? [] : [{ student_id: id, task_number: i + 1, points: p, auto_points: auto[i] ? p : null }]))

/** a — ждёт проверки (первая часть по ключу), b — проверено, c — не писал, d — частично (№5). */
export function scoresAfter() {
  return [
    ...cells('a', [1, 0, 1, null, null], [true, true, true]),
    ...cells('b', [1, 1, 1, 2, 3], [true, true, true]),
    ...cells('d', [1, 1, 0, 1, null], [true, true, true]),
  ]
}
export function sheetsAfter() {
  const t = new Date(Date.now() - 60 * MIN).toISOString()
  return [
    { student_id: 'a', answers: ['5', '7', '0,5'], submitted_at: t },
    { student_id: 'b', answers: ['5', '8', '0,5'], submitted_at: t },
    { student_id: 'd', answers: ['5', '8', '1'], submitted_at: null },
  ]
}
export const PHOTOS = [
  { id: 'ph1', student_id: 'a', storage_path: 'ex1/photos/a/1_p1.jpg', file_name: 'p1.jpg', position: 0 },
  { id: 'ph2', student_id: 'a', storage_path: 'ex1/photos/a/2_p2.jpg', file_name: 'p2.jpg', position: 1 },
]
export function resultsAfter() {
  return [
    { student_id: 'a', score: 2, part1_score: 2, part2_score: 0, notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null },
    { student_id: 'b', score: 8, part1_score: 3, part2_score: 5, notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null },
    { student_id: 'd', score: 3, part1_score: 2, part2_score: 1, notified_at: null, notified_score: null, notified_part1_score: null, notified_part2_score: null },
  ]
}
export const KEY = ['5', '8', '0,5']

export interface Db {
  exam: Record<string, unknown>
  tables: Record<string, unknown[]>
  rpcCalls: { fn: string; args: Record<string, unknown> }[]
}

/** Узкий поддельный клиент: select/eq/maybeSingle/then по таблице, rpc — в журнал. */
export function fakeSupabase(db: () => Db) {
  const from = (table: string) => {
    const c: Record<string, unknown> = {
      select: () => c, eq: () => c, order: () => c, in: () => c,
      maybeSingle: () => Promise.resolve({
        data: table === 'mock_exams' ? db().exam : table === 'mock_exam_answer_keys' ? { answers: KEY } : null, error: null,
      }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: db().tables[table] ?? [], error: null }).then(res, rej),
    }
    return c
  }
  return {
    from,
    rpc: (fn: string, args: Record<string, unknown>) => {
      db().rpcCalls.push({ fn, args })
      if (fn === 'notify_mock_exam_results') return Promise.resolve({ data: { sent: (args.p_student_ids as string[]).length, telegram: 0, already: 0, no_result: 0, no_profile: 0, rows: [] }, error: null })
      return Promise.resolve({ data: { changed_cells: 0 }, error: null })
    },
    storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://x/y' }, error: null }) }) },
  }
}
