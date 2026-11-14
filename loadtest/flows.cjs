'use strict'
// Browser journey. Importantly, NO clicks on submissions, payment buttons,
// upload controls, answer fields or enrollment widgets.
const { URL } = require('node:url')

const blockedWrites = [
  /\/(rest\/v1\/rpc\/(?:submit_|save_|accept_|course_join|onboarding_|topic_autocheck_check)|functions\/v1\/(?:subscription|payment|checkout))/i,
  /\/(rest\/v1\/(?:topic_homework_attempts|subscription_payments|payment_transactions))/i,
]
const allowedRpcWrites = new Set(['school_presence_touch', 'perf_ingest', 'record_app_visit'])
const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const protectedWritePrefixes = ['/rest/v1/', '/functions/v1/']
function safelyAllowedRequest(request, expectedOrigin, expectedSupabase) {
  const u = new URL(request.url())
  if (u.protocol !== 'https:') return false
  if (u.origin !== expectedOrigin && u.origin !== expectedSupabase) return false
  const method = request.method().toUpperCase()
  if (u.origin === expectedOrigin) return readOnlyMethods.has(method)
  if (u.pathname.startsWith('/auth/v1/')) {
    // login + refresh token permitted ONLY on the verified isolated test Supabase
    return ['/auth/v1/token', '/auth/v1/user', '/auth/v1/authorize', '/auth/v1/logout']
      .some(p => u.pathname === p) || method === 'GET'
  }
  if (readOnlyMethods.has(method)) return true
  if (blockedWrites.some(r => r.test(u.pathname))) return false
  const rpc = /^\/rest\/v1\/rpc\/([^/]+)$/.exec(u.pathname)
  if (rpc && method === 'POST') return !/^(?:submit|save|set|delete|insert|update|accept|join|upload|purchase|pay|add|remove|mark|complete|assign|toggle|cancel|renew|checkout)_/i.test(rpc[1]) &&
    (allowedRpcWrites.has(rpc[1]) || !/^(?:admin|staff|teacher|course_join|topic_autocheck_check)/i.test(rpc[1]))
  if (protectedWritePrefixes.some(p => u.pathname.startsWith(p))) return false
  return false
}
function track(emitter, key, started) {
  emitter.emit('histogram', 'almiron.' + key + '.ms', Date.now() - started)
}
async function openAndWait(page, path, selector, label, emitter, base) {
  const start = Date.now()
  await page.goto(new URL(path, base).href, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator(selector).first().waitFor({ timeout: 50_000, state: 'visible' })
  track(emitter, label, start)
}
async function studentReadOnlyCourseFlow(page, vuContext, events) {
  if (process.env.LOADTEST_ARMED !== 'isolated-20vu') throw Error('Not armed: runner required')
  const expectedOrigin = new URL(process.env.LOADTEST_TARGET_URL).origin
  const expectedSupabase = new URL(process.env.LOADTEST_SUPABASE_URL).origin
  const v = vuContext.vars
  if (!v.email || !v.password || !/^[0-9a-f-]{36}$/i.test(v.groupId) || !/^[0-9a-f-]{36}$/i.test(v.topicId)) throw Error('Invalid test user fixture')
  const denied = []
  let apiCount = 0
  const apiStats = new Map()
  await page.route('**/*', async route => {
    const req = route.request()
    if (!safelyAllowedRequest(req, expectedOrigin, expectedSupabase)) {
      denied.push(req.method() + ' ' + new URL(req.url()).origin + new URL(req.url()).pathname)
      return route.abort('blockedbyclient')
    }
    return route.continue()
  })
  page.on('request', req => {
    try {
      if (new URL(req.url()).origin === expectedSupabase && req.url().includes('/rest/v1/')) {
        apiCount++
        const label = new URL(req.url()).pathname.replace(/^\/rest\/v1\//, '')
        apiStats.set(label, (apiStats.get(label) || 0) + 1)
      }
    } catch { /* ignored */ }
  })
  const base = process.env.LOADTEST_TARGET_URL
  await page.goto(new URL('/login', base).href, { waitUntil: 'domcontentloaded' })
  await page.getByTestId('login-email').fill(v.email)
  await page.getByTestId('login-password').fill(v.password)
  await page.getByTestId('login-submit').click()
  await page.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 45_000 })
  await openAndWait(page, '/my-course', '[data-testid="course-card"]', 'my_courses_ready', events, base)
  const selected = page.locator('[data-testid="course-card"] a[href="' + '/my-course/' + v.groupId + '"]')
  await selected.first().waitFor({ timeout: 20_000 })
  await selected.first().click()
  const startCourse = Date.now()
  await page.getByTestId('course-hero').waitFor({ state: 'visible', timeout: 50_000 })
  track(events, 'course_ready', startCourse)
  const chosen = page.getByTestId('module-card').first()
  await chosen.waitFor({ timeout: 30_000 })
  await chosen.click()
  const lesson = page.locator('a[href="/my-course/' + v.groupId + '/topic/' + v.topicId + '"]').first()
  await lesson.waitFor({ timeout: 30_000 })
  const startTopic = Date.now()
  await lesson.click()
  await page.getByTestId('topic-section-stack').waitFor({ state: 'visible', timeout: 50_000 })
  track(events, 'topic_ready', startTopic)
  // Keep sessions open concurrently; exercise heartbeats/idle-time requests.
  await page.waitForTimeout(75_000)
  await openAndWait(page, '/my-course', '[data-testid="course-card"]', 'return_my_courses_ready', events, base)
  events.emit('counter', 'almiron.api_requests', apiCount)
  for (const [key, count] of apiStats) {
    if (['rpc/school_presence_touch','group_students','rpc/my_course_topic_locks'].includes(key)) {
      events.emit('counter', 'almiron.api.' + key.replace(/\W/g, '_'), count)
    }
  }
  if (denied.length) throw Error('Blocked non-read-only or out-of-scope requests: ' + denied.slice(0,3).join(', '))
}
module.exports = { studentReadOnlyCourseFlow, safelyAllowedRequest }
