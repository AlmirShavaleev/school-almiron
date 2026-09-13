import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * §172. Полоса про каркас на окне темы.
 *
 * Владелец должен видеть, куда уедет его правка, ДО того как нажмёт, а в классе
 * — почему материал не правится здесь. И то, что синхронизация не смогла
 * повторить, обязано быть видно: правку каркаса мы не откатываем никогда,
 * значит молчать о расхождении нельзя.
 */

const rpcSpy = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (fn: string, args: unknown) => rpcSpy(fn, args) },
}))

import { TopicTemplateBanner } from '@/components/courseProgram/TopicTemplateBanner'

const TEMPLATE_LINK = {
  is_template: true,
  source_topic_id: null,
  source_course: null,
  copies: [
    { topic_id: 't-10a', course: 'Физика ЕГЭ 10А' },
    { topic_id: 't-11a', course: 'Физика ЕГЭ 11А класс' },
    { topic_id: 't-26', course: 'Физика ЕГЭ 2026-2027 Ученики' },
  ],
  issues: [],
}

describe('Полоса каркаса (§172)', () => {
  beforeEach(() => {
    rpcSpy.mockReset()
    rpcSpy.mockResolvedValue({ data: TEMPLATE_LINK, error: null })
  })

  it('в каркасе перечисляет классы, которые это увидят', async () => {
    render(<TopicTemplateBanner topicId="tpl-1" />)

    const banner = await screen.findByTestId('template-banner')
    expect(banner).toHaveTextContent('изменения видны в 3 классах')
    expect(banner).toHaveTextContent('Физика ЕГЭ 10А')
    expect(banner).toHaveTextContent('Физика ЕГЭ 2026-2027 Ученики')
  })

  it('каркас без копий говорит об этом прямо, а не молчит', async () => {
    rpcSpy.mockResolvedValue({ data: { ...TEMPLATE_LINK, copies: [] }, error: null })
    render(<TopicTemplateBanner topicId="tpl-1" />)

    expect(await screen.findByTestId('template-banner')).toHaveTextContent('копий курса пока нет')
  })

  it('в классе объясняет, что тема из каркаса', async () => {
    rpcSpy.mockResolvedValue({
      data: { is_template: false, source_topic_id: 'tpl-1', source_course: 'Физика ЕГЭ Шаблон', copies: [], issues: [] },
      error: null,
    })
    render(<TopicTemplateBanner topicId="copy-1" />)

    const banner = await screen.findByTestId('reflection-banner')
    expect(banner).toHaveTextContent('Тема из каркаса «Физика ЕГЭ Шаблон»')
  })

  it('обычная тема без каркаса не рисует ничего', async () => {
    rpcSpy.mockResolvedValue({
      data: { is_template: false, source_topic_id: null, source_course: null, copies: [], issues: [] },
      error: null,
    })
    const { container } = render(<TopicTemplateBanner topicId="plain" />)

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('расхождения видно списком, «Повторить» зовёт синхронизацию', async () => {
    rpcSpy.mockImplementation((fn: string) => {
      if (fn === 'topic_template_link') {
        return Promise.resolve({
          data: {
            ...TEMPLATE_LINK,
            issues: [{
              id: 'i1', kind: 'kept_with_answers', course: 'Физика ЕГЭ 10А',
              detail: 'Задача убрана из каркаса, но по ней уже есть ответы (1) — осталась в классе',
            }],
          },
          error: null,
        })
      }
      return Promise.resolve({ data: {}, error: null })
    })

    render(<TopicTemplateBanner topicId="tpl-1" />)

    const issues = await screen.findByTestId('template-issues')
    expect(issues).toHaveTextContent('Физика ЕГЭ 10А')
    expect(issues).toHaveTextContent('уже есть ответы (1)')

    fireEvent.click(screen.getByTestId('template-repeat'))

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('template_sync_topic', { p_template_topic_id: 'tpl-1' }))
  })
})
