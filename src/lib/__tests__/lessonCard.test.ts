import { describe, expect, it } from 'vitest'
import {
  bunnyThumbnailUrl, firstVideoGuidByTopic, lessonChips, lessonStatus, tasksPercent, type LessonCardTopic,
} from '@/lib/lessonCard'
import type { TopicSection } from '@/lib/topicMaterialItems'

/** §274. Карточка урока: плашки «что внутри», строка состояния, превью видео. */

const GUID = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0'
const TODAY = '2026-10-08'

const topic = (over: Partial<LessonCardTopic> = {}): LessonCardTopic => ({
  is_open: true, available_from: null, sections: new Set<TopicSection>(),
  hw_id: null, hw_due_at: null, hw_status: null, hw_score: null, hw_max: null,
  test_assignment_id: null, test_status: null, tasks_total: 0, tasks_closed: 0,
  ...over,
})

describe('lessonChips', () => {
  it('учебный порядок: видео → теория → задачи → ДЗ → тест', () => {
    const chips = lessonChips(topic({
      sections: new Set<TopicSection>(['homework', 'notes', 'video', 'solution', 'criteria']),
      tasks_total: 7, hw_id: 'hw', test_assignment_id: 'a1',
    }))
    expect(chips.map(c => c.label)).toEqual(['Видео', 'Конспект', 'Задачи · 7', 'ДЗ', 'Тест'])
  })

  it('задач к уроку нет, но есть рубрика «Задачи» — плашка без числа', () => {
    expect(lessonChips(topic({ sections: new Set<TopicSection>(['theory', 'worksheet_tasks']) })).map(c => c.label))
      .toEqual(['Теория', 'Задачи'])
  })

  it('тренировочный урок: «ДЗ с автопроверкой»', () => {
    expect(lessonChips(topic({ hw_id: 'hw', lesson_format: 'training' })).map(c => c.label)).toEqual(['ДЗ с автопроверкой'])
  })
})

describe('lessonStatus', () => {
  it('закрыта по дате — «Откроется 12 окт»; по тумблеру — «Откроется позже»', () => {
    expect(lessonStatus(topic({ is_open: null, available_from: '2026-10-12' }), TODAY, TODAY))
      .toEqual({ label: 'Откроется 12 окт', tone: 'locked' })
    expect(lessonStatus(topic({ is_open: false, available_from: '2026-10-12' }), TODAY, TODAY))
      .toEqual({ label: 'Откроется позже', tone: 'locked' })
  })

  it('срок ДЗ впереди — «ДЗ до сб, 10 окт»; сегодня; прошёл — «Просрочено»', () => {
    expect(lessonStatus(topic({ hw_id: 'hw', hw_status: 'not_started', hw_due_at: '2026-10-10' }), TODAY)?.label).toBe('ДЗ до сб, 10 окт')
    expect(lessonStatus(topic({ hw_id: 'hw', hw_status: 'draft', hw_due_at: TODAY }), TODAY))
      .toEqual({ label: 'ДЗ до сегодня · черновик', tone: 'warn' })
    expect(lessonStatus(topic({ hw_id: 'hw', hw_status: 'not_started', hw_due_at: '2026-10-03' }), TODAY))
      .toEqual({ label: 'Просрочено · срок был 3 окт', tone: 'bad' })
  })

  it('сдано, вернули, принято с баллом', () => {
    expect(lessonStatus(topic({ hw_id: 'hw', hw_status: 'submitted', hw_due_at: '2026-10-03' }), TODAY)?.label).toBe('Сдано · на проверке')
    expect(lessonStatus(topic({ hw_id: 'hw', hw_status: 'returned' }), TODAY)?.tone).toBe('warn')
    expect(lessonStatus(topic({ hw_id: 'hw', hw_status: 'accepted', hw_score: 4, hw_max: 5 }), TODAY))
      .toEqual({ label: 'ДЗ принято · 4/5', tone: 'done' })
  })

  it('без ДЗ: все задачи решены — «Все задачи решены»; иначе строки нет', () => {
    expect(lessonStatus(topic({ tasks_total: 5, tasks_closed: 5 }), TODAY)?.label).toBe('Все задачи решены')
    expect(lessonStatus(topic({ tasks_total: 5, tasks_closed: 2 }), TODAY)).toBeNull()
    expect(tasksPercent({ tasks_total: 5, tasks_closed: 2 })).toBe(40)
    expect(tasksPercent({ tasks_total: 0, tasks_closed: 0 })).toBeNull()
  })
})

describe('превью видео', () => {
  it('первое видео Bunny по position; YouTube превью не даёт', () => {
    const map = firstVideoGuidByTopic([
      { topic_id: 't1', kind: 'video', url: 'https://www.youtube.com/watch?v=x', position: 0 },
      { topic_id: 't1', kind: 'video', url: `https://iframe.mediadelivery.net/embed/726880/${GUID}`, position: 2 },
      { topic_id: 't1', kind: 'video', url: 'https://iframe.mediadelivery.net/embed/726880/11111111-2222-3333-4444-555555555555', position: 5 },
      { topic_id: 't2', kind: 'file', url: null, position: 0 },
    ])
    expect([...map]).toEqual([['t1', GUID]])
  })

  it('обложка — только при заданном хосте pull-зоны', () => {
    expect(bunnyThumbnailUrl(GUID, 'vz-abc.b-cdn.net')).toBe(`https://vz-abc.b-cdn.net/${GUID}/thumbnail.jpg`)
    expect(bunnyThumbnailUrl(GUID, '')).toBeNull()
    expect(bunnyThumbnailUrl(null, 'vz-abc.b-cdn.net')).toBeNull()
  })
})

describe('§283: своя обложка ролика Bunny', () => {
  const G = '0eaac6de-fdc5-40b5-9b0b-b57329524d83'
  it('имя из file_name, а не thumbnail.jpg; постороннее не пропускаем', async () => {
    const { bunnyThumbnailUrl, videoThumbFile, firstVideoThumbByTopic } = await import('../lessonCard')
    expect(bunnyThumbnailUrl(G, 'vz.b-cdn.net', 'thumbnail_066cab73.jpg')).toBe(`https://vz.b-cdn.net/${G}/thumbnail_066cab73.jpg`)
    expect(bunnyThumbnailUrl(G, 'vz.b-cdn.net', '../x.jpg')).toBe(`https://vz.b-cdn.net/${G}/thumbnail.jpg`)
    expect(videoThumbFile('thumbnail.jpg')).toBe('thumbnail.jpg')
    expect(videoThumbFile('evil?.jpg')).toBeNull()
    const url = `https://iframe.mediadelivery.net/embed/763334/${G}`
    const m = firstVideoThumbByTopic([
      { topic_id: 't1', kind: 'video', url, position: 2, file_name: 'thumbnail_aaaa1111.jpg' },
      { topic_id: 't1', kind: 'video', url, position: 1, file_name: 'thumbnail_066cab73.jpg' },
      { topic_id: 't2', kind: 'video', url, position: 1, file_name: null },
    ])
    expect(m.get('t1')).toBe('thumbnail_066cab73.jpg')
    expect(m.has('t2')).toBe(false)
  })
})
