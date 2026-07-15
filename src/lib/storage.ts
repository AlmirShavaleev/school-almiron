import { supabase } from '@/lib/supabase'

/**
 * Private-bucket file access helpers.
 *
 * Buckets `homeworks` and `course-materials` are PRIVATE. Files must be served
 * via short-lived signed URLs, never public URLs. Older DB rows may still hold
 * full public URLs in *_url columns; extractStoragePath() normalizes those to a
 * storage path so getSignedFileUrl() can re-sign them on demand.
 */

export type PrivateBucket = 'homeworks' | 'course-materials' | 'lesson-library'

/**
 * Extract the storage object path from a value that may be either:
 *  - a full Supabase public URL (.../object/public/{bucket}/{path})
 *  - a full signed URL (.../object/sign/{bucket}/{path}?token=...)
 *  - an already-bare storage path ({path})
 *
 * Domain-agnostic: parses by the `/object/{public|sign}/{bucket}/` marker so it
 * works regardless of project domain or custom storage host. Returns null for
 * empty input. If the value is already a bare path, it is returned unchanged.
 */
export function extractStoragePath(value: string | null | undefined, bucket: PrivateBucket): string | null {
  if (!value) return null
  const v = value.trim()
  if (!v) return null

  // Full URL for either public or signed object endpoint.
  for (const kind of ['public', 'sign'] as const) {
    const marker = `/object/${kind}/${bucket}/`
    const idx = v.indexOf(marker)
    if (idx !== -1) {
      let path = v.slice(idx + marker.length)
      const q = path.indexOf('?')
      if (q !== -1) path = path.slice(0, q) // drop ?token=... etc.
      return decodeURIComponent(path)
    }
  }

  // Not a recognized storage URL. If it looks like some other absolute URL,
  // we cannot sign it — return as-is and let the caller decide. Otherwise it is
  // already a bare storage path.
  return v
}

/**
 * Create a short-lived signed URL for a private-bucket object.
 * @param path storage path or a full public/signed URL (normalized internally)
 * @param expiresIn seconds the URL stays valid (default 1h)
 */
export async function getSignedFileUrl(
  bucket: PrivateBucket,
  path: string | null | undefined,
  expiresIn = 3600,
): Promise<string | null> {
  const clean = extractStoragePath(path, bucket)
  if (!clean) return null
  // If it's some foreign absolute URL we can't sign, return it untouched.
  if (/^https?:\/\//i.test(clean)) return clean

  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(clean, expiresIn)
  if (error || !data) throw new Error('Не удалось получить ссылку на файл: ' + (error?.message ?? 'unknown'))
  return data.signedUrl
}
