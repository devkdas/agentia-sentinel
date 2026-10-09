import {execFileSync} from 'node:child_process'

export function runAgentia(args: string[], timeoutMs = 60_000): string {
  return execFileSync('agentia', args, {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore', 'pipe', 'pipe']})
}

export function runLocal(cmd: string, args: string[], cwd: string, timeoutMs = 30_000): string {
  return execFileSync(cmd, args, {encoding: 'utf8', timeout: timeoutMs, cwd, stdio: ['ignore', 'pipe', 'pipe']})
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

export function rowsOf(parsed: any): any[] {
  if (!parsed || typeof parsed !== 'object') return []
  const r = parsed?.result ?? parsed
  if (Array.isArray(r)) return r
  for (const key of ['data', 'builds', 'jobs', 'runs', 'stories', 'items']) {
    if (Array.isArray((r as Record<string, unknown>)?.[key])) return (r as Record<string, unknown>)[key] as any[]
  }
  return []
}

export interface ClassifiedFile {
  path: string
  status: string
  type: string
  weight: number
}

const TYPE_RULES: Array<{re: RegExp; type: string; weight: number}> = [
  {re: /\.profile-meta\.xml$/i, type: 'Profile', weight: 4},
  {re: /\.permissionset-meta\.xml$/i, type: 'PermissionSet', weight: 4},
  {re: /\.flow-meta\.xml$/i, type: 'Flow', weight: 3},
  {re: /\.trigger-meta\.xml$/i, type: 'ApexTrigger', weight: 3},
  {re: /\.cls$/i, type: 'ApexClass', weight: 3},
  {re: /\.object-meta\.xml$/i, type: 'CustomObject', weight: 2},
  {re: /\.field-meta\.xml$/i, type: 'CustomField', weight: 2},
  {re: /\.js$/i, type: 'LWC', weight: 2},
  {re: /\.labels-meta\.xml$/i, type: 'CustomLabels', weight: 1},
  {re: /\.(md|txt)$/i, type: 'Docs', weight: 0},
]

export function classifyFile(path: string, status = 'M'): ClassifiedFile {
  for (const rule of TYPE_RULES) {
    if (rule.re.test(path)) return {path, status, type: rule.type, weight: rule.weight}
  }
  return {path, status, type: 'Other', weight: 1}
}

export interface GitChanges {
  isRepo: boolean
  files: Array<{path: string; status: string}>
}

export function getGitChanges(dir: string): GitChanges {
  try {
    const out = runLocal('git', ['status', '--porcelain=v1'], dir)
    const files: Array<{path: string; status: string}> = []
    for (const line of out.split('\n')) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const status = trimmed.slice(0, 2).trim() || 'M'
      let path = trimmed.slice(3).trim()
      const arrow = path.indexOf(' -> ')
      if (arrow >= 0) path = path.slice(arrow + 4)
      if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
      files.push({path, status})
    }
    return {isRepo: true, files}
  } catch {
    return {isRepo: false, files: []}
  }
}

export interface StoryInfo {
  found: boolean
  id: string | null
  title: string
  status: string
}

export function resolveStory(storyId: string | null): StoryInfo {
  if (!storyId) return {found: false, id: null, title: '', status: 'unknown'}
  try {
    const rows = rowsOf(JSON.parse(runAgentia(['cicd', 'work', 'list', '--page-size', '100', '--json'])))
    const needle = storyId.toLowerCase()
    const hit = rows.find((s) => {
      if (typeof s === 'string') return s.toLowerCase().includes(needle)
      return [s?.id, s?.name, s?.title, s?.apiName].some((v) => str(v).toLowerCase().includes(needle))
    })
    if (!hit || typeof hit !== 'object') {
      return {found: false, id: storyId, title: '', status: 'unknown'}
    }
    return {
      found: true,
      id: storyId,
      title: str((hit as Record<string, unknown>).title ?? (hit as Record<string, unknown>).name),
      status: str((hit as Record<string, unknown>).status),
    }
  } catch {
    return {found: false, id: storyId, title: '', status: 'unreachable'}
  }
}

export function referenceScan(dir: string, names: string[], isRepo: boolean): Array<{name: string; referencedBy: number}> {
  if (!isRepo || names.length === 0) return []
  const out: Array<{name: string; referencedBy: number}> = []
  for (const name of names.slice(0, 5)) {
    try {
      const hits = runLocal('git', ['grep', '-l', '--', name, '.', ':!package-lock.json'], dir)
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l !== '')
      out.push({name, referencedBy: hits.length})
    } catch {
      out.push({name, referencedBy: 0})
    }
  }
  return out
}

export interface Factor {
  name: string
  points: number
  reason: string
}

export interface Assessment {
  story: StoryInfo
  files: ClassifiedFile[]
  gitRepo: boolean
  factors: Factor[]
  score: number
  band: string
  readiness: string
  next: string
  missing: string[]
  references: Array<{name: string; referencedBy: number}>
  businessAreas: string[]
}

function bandOf(score: number): string {
  if (score < 25) return 'LOW'
  if (score < 50) return 'MODERATE'
  if (score < 75) return 'HIGH'
  return 'CRITICAL'
}

const AREA_HINTS: Array<{re: RegExp; area: string}> = [
  {re: /account/i, area: 'Accounts'},
  {re: /opportunit/i, area: 'Opportunities'},
  {re: /lead/i, area: 'Leads'},
  {re: /contact/i, area: 'Contacts'},
  {re: /credit/i, area: 'Billing'},
  {re: /profile|permissionset/i, area: 'Access control'},
  {re: /flow/i, area: 'Automation'},
]

export function assess(input: {storyId: string | null; rawFiles: Array<{path: string; status: string}>; gitRepo: boolean; dir: string}): Assessment {
  const files = input.rawFiles.map((f) => classifyFile(f.path, f.status))
  const story = resolveStory(input.storyId)
  const factors: Factor[] = []
  const missing: string[] = []

  const n = files.length
  if (n === 0) {
    factors.push({name: 'breadth', points: 0, reason: 'No changed files detected.'})
  } else if (n <= 3) {
    factors.push({name: 'breadth', points: 5, reason: `${n} changed file${n === 1 ? '' : 's'} is a narrow blast radius.`})
  } else if (n <= 10) {
    factors.push({name: 'breadth', points: 12, reason: `${n} changed files widen the review surface.`})
  } else {
    factors.push({name: 'breadth', points: 20, reason: `${n} changed files is a broad change, review carefully.`})
  }

  const maxWeight = files.reduce((m, f) => Math.max(m, f.weight), 0)
  const hot = files.filter((f) => f.weight >= 3)
  if (maxWeight >= 4) {
    const kinds = [...new Set(files.filter((f) => f.weight >= 4).map((f) => f.type))].join(', ')
    factors.push({name: 'sensitive-types', points: 20, reason: `${kinds} changes affect access or automation directly.`})
  } else if (maxWeight === 3) {
    const kinds = [...new Set(hot.map((f) => f.type))].join(', ')
    factors.push({name: 'sensitive-types', points: 12, reason: `${kinds} changes carry logic or flow risk.`})
  } else if (n > 0) {
    factors.push({name: 'sensitive-types', points: 6, reason: 'Only low weight metadata changed.'})
  }

  const destructive = files.filter((f) => f.status === 'D' || /destruct/i.test(f.path))
  if (destructive.length > 0) {
    factors.push({name: 'destructive', points: 15, reason: `${destructive.length} deletion or destructive marker needs a second pair of eyes.`})
  }

  if (!story.found) {
    factors.push({name: 'story-linkage', points: 8, reason: 'No linked story found, change floats without tracking.'})
    missing.push('No linked Copado story, link one before promoting.')
  }

  factors.push({name: 'test-context', points: 5, reason: 'No test evidence is wired into this report.'})
  missing.push('No test evidence connected, run the related suite before promoting.')
  missing.push('Dependency data is local references only, confirm with a blast map for shared classes.')

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0))
  const band = bandOf(score)
  const readiness = band === 'LOW' ? 'ready' : band === 'MODERATE' ? 'ready with the listed tests' : 'not ready'
  const next =
    band === 'LOW'
      ? 'Proceed with the normal promotion workflow.'
      : band === 'MODERATE'
        ? 'Run the recommended tests, then promote.'
        : 'Reduce scope or add tests and approvals before promoting.'

  const apexNames = files
    .filter((f) => f.type === 'ApexClass')
    .map((f) => f.path.split('/').pop()?.replace(/\.cls$/i, '') ?? '')
    .filter((x) => x !== '')
  const references = referenceScan(input.dir, apexNames, input.gitRepo)

  const areas = new Set<string>()
  for (const f of files) {
    for (const hint of AREA_HINTS) {
      if (hint.re.test(f.path)) areas.add(hint.area)
    }
  }

  return {story, files, gitRepo: input.gitRepo, factors, score, band, readiness, next, missing, references, businessAreas: [...areas]}
}

export function renderHuman(a: Assessment, storyLabel: string): string[] {
  const lines: string[] = []
  lines.push('Agentia Sentinel')
  lines.push(`Story: ${a.story.found ? `${a.story.id}${a.story.title ? ` (${a.story.title})` : ''}` : storyLabel}`)
  lines.push(`Change: ${a.files.length} file${a.files.length === 1 ? '' : 's'}${a.gitRepo ? '' : ' (offline list, not a git repo)'}`)
  lines.push('')
  lines.push(`Risk Score: ${a.score} / 100`)
  lines.push(`Risk Level: ${a.band}`)
  lines.push('')
  lines.push('Factors:')
  for (const f of a.factors) {
    lines.push(`  +${f.points} ${f.name}: ${f.reason}`)
  }
  if (a.files.length > 0) {
    lines.push('')
    lines.push('Changed files:')
    for (const f of a.files.slice(0, 15)) {
      lines.push(`  ${f.type} ${f.path}`)
    }
    if (a.files.length > 15) lines.push(`  ... and ${a.files.length - 15} more`)
  }
  if (a.references.length > 0) {
    lines.push('')
    lines.push('Local references:')
    for (const r of a.references) {
      lines.push(`  ${r.name} referenced by ${r.referencedBy} file${r.referencedBy === 1 ? '' : 's'}`)
    }
  }
  if (a.businessAreas.length > 0) {
    lines.push('')
    lines.push(`Business areas: ${a.businessAreas.join(', ')}`)
  }
  if (a.missing.length > 0) {
    lines.push('')
    lines.push('Missing validation:')
    for (const m of a.missing) lines.push(`  - ${m}`)
  }
  lines.push('')
  lines.push(`Readiness: ${a.readiness}`)
  lines.push(`Next: ${a.next}`)
  return lines
}

export function renderMarkdown(a: Assessment, storyLabel: string): string {
  const out: string[] = []
  out.push('# Sentinel Release Risk Report')
  out.push('')
  out.push(`Story: ${a.story.found ? a.story.id : storyLabel}`)
  out.push(`Score: ${a.score} / 100 (${a.band})`)
  out.push(`Readiness: ${a.readiness}`)
  out.push('')
  out.push('## Factors')
  for (const f of a.factors) out.push(`- +${f.points} ${f.name}: ${f.reason}`)
  out.push('')
  out.push('## Changed files')
  for (const f of a.files) out.push(`- ${f.type} ${f.path} (${f.status})`)
  if (a.references.length > 0) {
    out.push('')
    out.push('## Local references')
    for (const r of a.references) out.push(`- ${r.name} referenced by ${r.referencedBy} files`)
  }
  if (a.businessAreas.length > 0) {
    out.push('')
    out.push(`Business areas: ${a.businessAreas.join(', ')}`)
  }
  out.push('')
  out.push('## Missing validation')
  for (const m of a.missing) out.push(`- ${m}`)
  out.push('')
  out.push(`Next: ${a.next}`)
  return out.join('\n')
}
