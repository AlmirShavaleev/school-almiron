import { describe, expect, it } from 'vitest'
import { isAcceptedHomeworkFile, namePastedFile, splitHomeworkFiles } from '@/lib/topicHomework'

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type })
}

describe('отбор файлов работы', () => {
  it('пускает PDF и любые картинки', () => {
    expect(isAcceptedHomeworkFile(file('решение.pdf', 'application/pdf'))).toBe(true)
    expect(isAcceptedHomeworkFile(file('фото.jpg', 'image/jpeg'))).toBe(true)
    expect(isAcceptedHomeworkFile(file('снимок.png', 'image/png'))).toBe(true)
    expect(isAcceptedHomeworkFile(file('c телефона.heic', 'image/heic'))).toBe(true)
  })

  it('не пускает документы и архивы', () => {
    expect(isAcceptedHomeworkFile(file('решение.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'))).toBe(false)
    expect(isAcceptedHomeworkFile(file('всё.zip', 'application/zip'))).toBe(false)
  })

  it('когда браузер не сообщил тип — судит по расширению', () => {
    // Android-галереи и часть браузеров отдают пустой type.
    expect(isAcceptedHomeworkFile(file('скан.pdf', ''))).toBe(true)
    expect(isAcceptedHomeworkFile(file('фото.JPEG', ''))).toBe(true)
    expect(isAcceptedHomeworkFile(file('заметки.txt', ''))).toBe(false)
  })

  it('делит выбранное на подходящее и нет, сохраняя порядок', () => {
    const { accepted, rejected } = splitHomeworkFiles([
      file('a.pdf', 'application/pdf'),
      file('b.zip', 'application/zip'),
      file('c.png', 'image/png'),
    ])
    expect(accepted.map(f => f.name)).toEqual(['a.pdf', 'c.png'])
    expect(rejected.map(f => f.name)).toEqual(['b.zip'])
  })
})

describe('имена вставленных скриншотов', () => {
  it('безымянному снимку из буфера даёт понятное имя с номером', () => {
    // Из буфера скриншот приходит как image.png — и все подряд одинаково.
    expect(namePastedFile(file('image.png', 'image/png'), 0).name).toBe('Снимок экрана 1.png')
    expect(namePastedFile(file('image.png', 'image/png'), 1).name).toBe('Снимок экрана 2.png')
  })

  it('jpeg сокращает до jpg', () => {
    expect(namePastedFile(file('image.jpeg', 'image/jpeg'), 0).name).toBe('Снимок экрана 1.jpg')
  })

  it('осмысленное имя не трогает', () => {
    const f = file('решение задачи 5.png', 'image/png')
    expect(namePastedFile(f, 0)).toBe(f)
  })

  it('сохраняет содержимое и тип', () => {
    const renamed = namePastedFile(file('image.png', 'image/png'), 0)
    expect(renamed.type).toBe('image/png')
    expect(renamed.size).toBe(3)
  })
})
