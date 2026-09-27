import { describe, expect, it, vi } from 'vitest'
import {
  buildTrainingSubtopics, compareSubtopicCodes, onlyEgeTrack, subtopicsForStudent, TRAINING_ROLES,
  type TrainingItemRow,
} from '@/lib/training'

const row = (code: string | null, section: string | null, position: number, extra: Partial<TrainingItemRow> = {}): TrainingItemRow => ({
  id: `${code}-${section}`, topic_id: 't', kind: 'file', title: null, storage_path: `t/${code}-${position}.pdf`,
  file_name: null, size_bytes: null, position, is_visible: true, section, subtopic_code: code, subtopic_title: `Подтема ${code}`,
  ...extra,
})
const all = (code: string) => TRAINING_ROLES.map(r => row(code, r.section, r.position))

describe('buildTrainingSubtopics', () => {
  it('группирует по подтеме, сортирует по кодификатору, делит на «урок» и «дом»', () => {
    const list = buildTrainingSubtopics([...all('1.10'), ...all('1.4.2').reverse(), ...all('1.9')])
    expect(list.map(s => s.code)).toEqual(['1.4.2', '1.9', '1.10'])
    const s = list[0]
    expect(s.title).toBe('Подтема 1.4.2')
    expect(s.lesson.map(i => i.label)).toEqual(['Теория', 'Список задач', 'Рабочий лист', 'Решения'])
    expect(s.home.map(i => i.label)).toEqual(['ДЗ · список задач', 'ДЗ · рабочий лист', 'ДЗ · решения'])
    expect(s.total).toBe(7)
  })

  it('строки без подтемы, без файла или с чужой рубрикой пропускаются', () => {
    const list = buildTrainingSubtopics([
      row(null, 'theory', 0), row('1.1', 'notes', 0), row('1.1', 'tasks', 1, { storage_path: null }), row('1.1', 'theory', 0),
    ])
    expect(list).toHaveLength(1)
    expect(list[0].total).toBe(1)
  })

  it('скрытые учителем помечаются, ученику не показываются; скрытый файл тоже', () => {
    const list = buildTrainingSubtopics([...all('1.14'), ...all('1.15'), row('1.17', 'theory', 0, { is_visible: false })], ['1.15'])
    expect(list.map(s => [s.code, s.hidden])).toEqual([['1.14', false], ['1.15', true], ['1.17', false]])
    const student = subtopicsForStudent(list)
    expect(student.map(s => s.code)).toEqual(['1.14'])
  })
})

describe('compareSubtopicCodes', () => {
  it('1.14 < 1.17 < 1.18, 1.2 < 1.10, 2.15 < 2.15.1 < 2.16', () => {
    expect(['1.18', '2.16', '1.10', '2.15.1', '1.14', '1.2', '2.15', '1.17'].sort(compareSubtopicCodes))
      .toEqual(['1.2', '1.10', '1.14', '1.17', '1.18', '2.15', '2.15.1', '2.16'])
  })
})

describe('onlyEgeTrack', () => {
  it('добавляет к запросу фильтр track = ege и возвращает тот же построитель', () => {
    const q = { eq: vi.fn(function (this: unknown) { return this }) }
    expect(onlyEgeTrack(q)).toBe(q)
    expect(q.eq).toHaveBeenCalledWith('track', 'ege')
  })
})
