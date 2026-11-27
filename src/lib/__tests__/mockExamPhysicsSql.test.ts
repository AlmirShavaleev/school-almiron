import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let db: PGlite

beforeAll(async () => {
  db = new PGlite()
  await db.exec('create role authenticated; create role anon;')
  await db.exec(readFileSync(path.resolve(import.meta.dirname, '../../../supabase/migrations/20261126084414_mock_exam_physics_partial_scores.sql'), 'utf8'))
}, 20_000)

afterAll(async () => db?.close())

async function score(task: number, key: string, answer: string | null) {
  const { rows } = await db.query<{ points: number | null }>(
    'select public.score_mock_exam_physics_partial($1, $2, $3) as points', [task, key, answer],
  )
  return rows[0].points
}

describe('частичный балл ЕГЭ по физике', () => {
  it.each([
    ['145', '5 4 1', 2],
    ['145', '245', 1],
    ['145', '1452', 1],
    ['145', '45', 1],
    ['145', '25', 0],
    ['145', '111', 0],
    ['13', '11', 1],
    ['13', '2', 0],
    ['13', null, 0],
  ])('множественный выбор, ключ %s, ответ %s → %s', async (key, answer, expected) => {
    for (const task of [5, 9, 14, 18]) expect(await score(task, key, answer)).toBe(expected)
  })

  it.each([
    ['32', '32', 2],
    ['32', '12', 1],
    ['32', '31', 1],
    ['32', '23', 0],
    ['32', '321', 0],
    ['32', '3', 0],
    ['32', '-32', 0],
    ['33', '13', 1],
  ])('позиционный ответ, ключ %s, ответ %s → %s', async (key, answer, expected) => {
    for (const task of [6, 10, 15, 17]) expect(await score(task, key, answer)).toBe(expected)
  })

  it('оставляет задание 11 обычной проверке и пропускает неподдерживаемый ключ', async () => {
    expect(await score(11, '2,5', '2,5')).toBeNull()
    expect(await score(6, '34 43', '34')).toBeNull()
  })
})
