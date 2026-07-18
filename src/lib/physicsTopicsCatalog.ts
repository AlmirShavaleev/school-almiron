import dryRunPreviewRaw from '../../reports/physics-ege/dry-run-preview.json?raw'

export interface PhysicsTopicCatalogItem {
  id: string
  external_id: number
  title: string
}

const TOPIC_LINE_RE = /^- ([0-9a-f-]+) \| external_id=(\d+) \| (.+)$/i

function parsePhysicsTopicsCatalog(raw: string): PhysicsTopicCatalogItem[] {
  const parsed = JSON.parse(raw) as Array<{
    payload_preview?: { system?: Array<{ text?: string }> }
  }>

  const systemText = parsed[0]?.payload_preview?.system?.[1]?.text ?? ''
  const lines = systemText.split(/\r?\n/)
  const items: PhysicsTopicCatalogItem[] = []

  for (const line of lines) {
    const match = TOPIC_LINE_RE.exec(line.trim())
    if (!match) continue
    items.push({
      id: match[1],
      external_id: Number(match[2]),
      title: match[3],
    })
  }

  return items
}

export const physicsTopicsCatalog = parsePhysicsTopicsCatalog(dryRunPreviewRaw)
