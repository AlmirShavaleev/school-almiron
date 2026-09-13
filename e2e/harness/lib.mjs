// Harness: fake Supabase over Playwright routes. Lives in gitignored screenshots/.
import fs from 'node:fs'
import path from 'node:path'

export const BASE = 'http://localhost:5199'
export const SB   = 'https://harness.invalid'
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')

export function makeSession(user) {
  const access_token = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({
    sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated',
    exp: 2000000000, iat: 1700000000, session_id: 'sess-' + user.id,
    app_metadata: { provider: 'email' }, user_metadata: user.user_metadata ?? {},
  })}.sig`
  return {
    access_token, refresh_token: 'rt-' + user.id, token_type: 'bearer',
    expires_in: 3600 * 24 * 365, expires_at: 2000000000,
    user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated',
      app_metadata: { provider: 'email' }, user_metadata: user.user_metadata ?? {},
      created_at: '2025-09-01T10:00:00Z', identities: [] },
  }
}

// ── PostgREST-ish query evaluation ───────────────────────────────────────────
function parseVal(v) {
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}
function getPath(row, col) {
  return col.split('.').reduce((o, k) => (o == null ? undefined : o[k]), row)
}
function matches(row, col, expr) {
  const dot = expr.indexOf('.')
  const op = expr.slice(0, dot), raw = expr.slice(dot + 1)
  const v = getPath(row, col)
  switch (op) {
    case 'eq':  return String(v) === raw || v === parseVal(raw)
    case 'neq': return !(String(v) === raw || v === parseVal(raw))
    case 'is':  return raw === 'null' ? v == null : raw === 'not.null' ? v != null : v === parseVal(raw)
    case 'in': {
      const list = raw.replace(/^\(|\)$/g, '').split(',').map(s => s.replace(/^"|"$/g, ''))
      return list.some(x => String(v) === x)
    }
    case 'gt':  return v > parseVal(raw)
    case 'gte': return v >= parseVal(raw)
    case 'lt':  return v < parseVal(raw)
    case 'lte': return v <= parseVal(raw)
    case 'like': case 'ilike': {
      const re = new RegExp('^' + raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*') + '$', op === 'ilike' ? 'i' : '')
      return re.test(String(v ?? ''))
    }
    case 'not': return !matches(row, col, raw)
    case 'cs': case 'cd': case 'ov': return true
    default: return true
  }
}
// split top-level by comma (respecting parens)
function splitTop(s) {
  const out = []; let depth = 0, cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}
// Rename embedded relations to requested aliases: `profile:profiles(...)`, `groups!inner(...)`
function applySelect(row, select) {
  if (!row || !select || select === '*') return row
  const out = { ...row }
  for (const part of splitTop(select)) {
    const m = part.match(/^([\w]+):([\w]+)(![\w]+)?\((.*)\)$/s)
    if (m) {
      const [, alias, rel, , inner] = m
      const src = out[alias] !== undefined ? out[alias] : out[rel]
      if (src !== undefined) {
        out[alias] = Array.isArray(src) ? src.map(r => applySelect(r, inner)) : applySelect(src, inner)
      }
      continue
    }
    const m2 = part.match(/^([\w]+)(![\w]+)?\((.*)\)$/s)
    if (m2) {
      const [, rel, , inner] = m2
      if (out[rel] !== undefined) out[rel] = Array.isArray(out[rel]) ? out[rel].map(r => applySelect(r, inner)) : (out[rel] ? applySelect(out[rel], inner) : out[rel])
      continue
    }
    const m3 = part.match(/^([\w]+):([\w]+)$/)
    if (m3 && out[m3[1]] === undefined) out[m3[1]] = out[m3[2]]
  }
  return out
}

export function makeHandler({ fixtures, session, log, assetsDir }) {
  const seen = new Set()
  const note = (line) => { if (!seen.has(line)) { seen.add(line); log(line) } }
  const json = (route, body, status = 200, headers = {}) =>
    route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-expose-headers': 'content-range, range, x-total-count', ...headers }, body: JSON.stringify(body) })

  return async (route, request) => {
    const url = new URL(request.url())
    const method = request.method()
    if (url.origin !== SB) { note(`EXT ${method} ${url.origin}${url.pathname}`); return route.abort() }
    const p = url.pathname

    // auth
    if (p.startsWith('/auth/v1/user'))   return json(route, session ? session.user : { code: 401, msg: 'no session' }, session ? 200 : 401)
    if (p.startsWith('/auth/v1/token'))  return json(route, session ?? { error: 'invalid_grant', error_description: 'Invalid login credentials' }, session ? 200 : 400)
    if (p.startsWith('/auth/v1/logout')) return json(route, {}, 204)
    if (p.startsWith('/auth/v1/'))       { note(`AUTH ${method} ${p}`); return json(route, {}) }

    // rpc
    if (p.startsWith('/rest/v1/rpc/')) {
      const name = p.slice('/rest/v1/rpc/'.length)
      let body = {}
      try { body = JSON.parse(request.postData() || '{}') } catch {}
      note(`RPC ${name} ${JSON.stringify(body).slice(0, 140)}`)
      const fn = fixtures.rpc?.[name]
      const res = typeof fn === 'function' ? fn(body, url) : (fn ?? null)
      return json(route, res)
    }
    // rest
    if (p.startsWith('/rest/v1/')) {
      const table = p.slice('/rest/v1/'.length)
      const select = url.searchParams.get('select') ?? '*'
      const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset', 'or', 'and'].includes(k))
      const single = (request.headers()['accept'] || '').includes('vnd.pgrst.object')
      const prefer = request.headers()['prefer'] || ''
      note(`${method} ${table} select=${select} ${filters.map(([k, v]) => k + '=' + v).join('&')} ${prefer.includes('count') ? 'COUNT' : ''}`)
      if (method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE') {
        let body = null
        try { body = JSON.parse(request.postData() || 'null') } catch {}
        const rows = Array.isArray(body) ? body : body ? [body] : []
        const withIds = rows.map((r, i) => ({ id: `new-${Date.now()}-${i}`, created_at: new Date().toISOString(), ...r }))
        if (fixtures.onWrite) fixtures.onWrite(table, method, withIds, filters)
        return json(route, single ? (withIds[0] ?? null) : withIds, method === 'POST' ? 201 : 200)
      }
      const src = fixtures.tables?.[table]
      let rows = typeof src === 'function' ? src(url) : (src ?? [])
      rows = rows.filter(r => filters.every(([k, v]) => matches(r, k, v)))
      const order = url.searchParams.get('order')
      if (order) {
        const [col, dir] = order.split('.')
        rows = [...rows].sort((a, b) => (getPath(a, col) > getPath(b, col) ? 1 : getPath(a, col) < getPath(b, col) ? -1 : 0) * (dir === 'desc' ? -1 : 1))
      }
      const total = rows.length
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = url.searchParams.get('limit')
      rows = rows.slice(offset, limit ? offset + Number(limit) : undefined)
      const rangeHdr = request.headers()['range']
      if (rangeHdr) { const [a, b] = rangeHdr.split('-').map(Number); rows = rows.slice(a, b + 1) }
      rows = rows.map(r => applySelect(r, select))
      const headers = {}
      if (prefer.includes('count')) headers['content-range'] = `${offset}-${Math.max(offset + rows.length - 1, 0)}/${total}`
      if (method === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'access-control-expose-headers': 'content-range, range', 'content-type': 'application/json' }, body: '' })
      if (single) {
        if (rows.length === 0) return json(route, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: 'Results contain 0 rows' }, 406)
        return json(route, rows[0], 200, headers)
      }
      return json(route, rows, 200, headers)
    }
    // storage
    if (p.startsWith('/storage/v1/')) {
      const rest = p.slice('/storage/v1/'.length)
      if (method === 'POST' && rest.startsWith('object/sign/')) {
        const objPath = rest.slice('object/sign/'.length)
        let body = {}
        try { body = JSON.parse(request.postData() || '{}') } catch {}
        if (Array.isArray(body.paths)) {
          return json(route, body.paths.map(pp => ({ path: pp, error: null, signedURL: `/object/sign/${objPath}/${pp}?token=t` })))
        }
        return json(route, { signedURL: `/object/sign/${objPath}?token=t` })
      }
      if (method === 'GET' && (rest.startsWith('object/') || rest.startsWith('render/image/'))) {
        const file = pickAsset(rest, assetsDir)
        note(`STORAGE ${rest.split('?')[0]} -> ${path.basename(file)}`)
        return route.fulfill({ status: 200, contentType: file.endsWith('.pdf') ? 'application/pdf' : 'image/png', body: fs.readFileSync(file) })
      }
      if (rest.startsWith('object/list/')) return json(route, [])
      note(`STORAGE ${method} ${rest}`)
      return json(route, {})
    }
    if (p.startsWith('/functions/v1/')) { note(`FN ${method} ${p}`); return json(route, fixtures.functions?.[p.slice('/functions/v1/'.length)] ?? {}) }
    if (p.startsWith('/realtime/')) return route.abort()
    note(`?? ${method} ${p}`)
    return json(route, [])
  }
}

function pickAsset(rest, assetsDir) {
  const lower = rest.toLowerCase()
  if (lower.endsWith('.pdf')) return path.join(assetsDir, 'doc.pdf')
  if (lower.includes('table')) return path.join(assetsDir, 'table.png')
  if (lower.includes('wide') || lower.includes('formula')) return path.join(assetsDir, 'formula.png')
  if (lower.includes('photo') || lower.includes('homework') || lower.includes('submission')) return path.join(assetsDir, 'photo.png')
  return path.join(assetsDir, 'figure.png')
}

export async function newPage(browser, { session, staffProfileId, staffMode, width = 390, height = 844 }) {
  const context = await browser.newContext({
    viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'ru-RU', timezoneId: 'Europe/Moscow',
  })
  await context.addInitScript(({ session, staffProfileId, staffMode }) => {
    try {
      if (session) localStorage.setItem('sb-harness-auth-token', JSON.stringify(session))
      else localStorage.removeItem('sb-harness-auth-token')
      if (staffProfileId) {
        localStorage.setItem('almiron:staff-mode:' + staffProfileId, staffMode || 'admin')
        sessionStorage.setItem('almiron:staff-mode-chosen:' + staffProfileId, '1')
      }
    } catch {}
  }, { session, staffProfileId, staffMode })
  const page = await context.newPage()
  return { context, page }
}

export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d }
