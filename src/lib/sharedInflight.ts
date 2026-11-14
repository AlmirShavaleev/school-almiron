/**
 * 15.11. Одинаковые запросы, ушедшие одновременно, — один запрос.
 *
 * Утро 14.11: у одного ученика в одну и ту же миллисекунду уходило по три
 * `my_mock_exams` на группу (боковое меню, плашка пробника и раздел курса
 * читают одно и то же каждый сам). Пока первый в пути, остальные ждут его
 * ответ. Ответ НЕ кэшируется: как только запрос завершился, следующий вызов
 * снова идёт в базу — поэтому устаревших данных после сдачи работы не бывает.
 */
const inflight = new Map<string, Promise<unknown>>()

export function shareInflight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined
  if (running) return running
  const p = (async () => {
    try {
      return await load()
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

/** Только для тестов. */
export function __inflightSizeForTests(): number {
  return inflight.size
}
