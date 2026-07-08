import DOMPurify from 'dompurify'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CONFIG: Record<string, any> = {
  ALLOWED_TAGS: [
    'p', 'br', 'span', 'div', 'b', 'i', 'em', 'strong', 'sub', 'sup',
    'ul', 'ol', 'li',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  ],
  ALLOWED_ATTR: ['class', 'src', 'alt', 'width', 'height', 'style', 'colspan', 'rowspan'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
  FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'href', 'action'],
}

export function sanitizeHtml(dirty: string | null | undefined): string {
  if (!dirty) return ''
  return DOMPurify.sanitize(dirty, CONFIG) as string
}
