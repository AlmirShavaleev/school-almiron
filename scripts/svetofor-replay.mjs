#!/usr/bin/env node
/**
 * §238. Прогон «светофора» на выгрузке с прода — для оркестратора.
 *
 * Вход: JSON-массив строк
 *   { ai_verdict, student_answer, expected_answer, note, teacher_verdict, [attempt_id], [no] }
 * — задания из последнего done-черновика ИИ каждой работы и вердикт
 * преподавателя из topic_homework_review_tasks.
 *
 * Запуск (Node 22.18+ снимает типы с .ts сам; на 22.6–22.17 добавьте
 * --experimental-strip-types):
 *   node scripts/svetofor-replay.mjs rows.json
 *   node scripts/svetofor-replay.mjs rows.json --misses   # + список пропусков
 *   node scripts/svetofor-replay.mjs rows.json --json     # отчёт JSON
 *   cat rows.json | node scripts/svetofor-replay.mjs -
 *   node scripts/svetofor-replay.mjs --demo               # синтетика, проверка самого скрипта
 *
 * Классификация — та же, что на экране проверки: src/lib/reviewTriage.ts
 * (сравнение ответов — compareAnswers из check-homework-ai/findings.ts).
 * Скрипт ничего не пишет и никуда не ходит.
 */
import { readFileSync } from 'node:fs'
import { formatReplay, replay } from '../src/lib/svetoforReplay.ts'

/** Синтетика: по строке на каждый случай светофора. Не данные учеников. */
const DEMO = [
  { ai_verdict: 'correct', student_answer: '12 м/с', expected_answer: '12 м/с', note: '', teacher_verdict: 'correct' },
  { ai_verdict: 'correct', student_answer: 'в 144 раза', expected_answer: '144', note: '', teacher_verdict: 'correct' },
  { ai_verdict: 'correct', student_answer: '0,4', expected_answer: '0.4', note: '', teacher_verdict: 'partial', attempt_id: 'demo-1', no: '3' },
  { ai_verdict: 'correct', student_answer: '50%', expected_answer: '0,5', note: '', teacher_verdict: 'correct' },
  { ai_verdict: 'partial', student_answer: '4π; 3π; 15π/4', expected_answer: '4π; 3π; 15π/4', note: 'Неверный отбор: x=3π не входит в [5π/2; 4π]', teacher_verdict: 'correct' },
  { ai_verdict: 'partial', student_answer: '-3π/2', expected_answer: '-3π/2', note: 'ошибка в отборе: -3π/2 не входит в [-2π; -π/2], закрытый отрезок', teacher_verdict: 'correct' },
  { ai_verdict: 'partial', student_answer: '7π/2', expected_answer: '7π/2', note: 'в ответе ученик включил 7π/2, хотя интервал открытый: (0; 7π/2]', teacher_verdict: 'correct' },
  { ai_verdict: 'partial', student_answer: '-2π', expected_answer: '-2π', note: 'x = -π/2 не входит в [-2π; -π], так как это граница', teacher_verdict: 'partial' },
  { ai_verdict: 'partial', student_answer: '30 Н', expected_answer: '30 Н', note: 'Нет хода решения', teacher_verdict: 'partial' },
  { ai_verdict: 'partial', student_answer: '12', expected_answer: '30', note: 'Ошибка в вычислении', teacher_verdict: 'wrong' },
  { ai_verdict: 'wrong', student_answer: '−3,8', expected_answer: '−4,5', note: '', teacher_verdict: 'wrong' },
  { ai_verdict: 'wrong', student_answer: '7π/4', expected_answer: '7π/4', note: 'Отбор корней неверен: 7π/4 не входит в отрезок [3π/2; 3π]', teacher_verdict: 'correct' },
  { ai_verdict: 'unchecked', student_answer: '', expected_answer: '0,125', note: 'не разобрал почерк', teacher_verdict: 'correct' },
  { ai_verdict: null, student_answer: '5', expected_answer: '5', note: null, teacher_verdict: 'correct' },
]

const args = process.argv.slice(2)
const flags = new Set(args.filter(a => a.startsWith('--')))
const file = args.find(a => !a.startsWith('--'))

let rows
if (flags.has('--demo')) {
  rows = DEMO
} else if (file) {
  const text = readFileSync(file === '-' ? 0 : file, 'utf8')
  rows = JSON.parse(text)
} else {
  console.error('Использование: node scripts/svetofor-replay.mjs <rows.json | -> [--misses] [--json]  |  --demo')
  process.exit(2)
}
if (!Array.isArray(rows)) {
  console.error('Ожидался JSON-массив строк {ai_verdict, student_answer, expected_answer, note, teacher_verdict}')
  process.exit(2)
}

const report = replay(rows)
if (flags.has('--json')) {
  const { misses, ...rest } = report
  console.log(JSON.stringify({ ...rest, misses: misses.map(m => m.input) }, null, 2))
} else {
  console.log(formatReplay(report, { showMisses: flags.has('--misses') }))
}
