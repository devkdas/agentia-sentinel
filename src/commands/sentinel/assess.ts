import {Command, Flags} from '@oclif/core'
import {resolve} from 'node:path'
import {assess, getGitChanges, renderHuman, runAgentia, str} from '../../lib.js'

const AI_TIMEOUT_MS = 120_000

export default class SentinelAssess extends Command {
  static description =
    'Assess change impact and release risk for a story plus local git changes. Deterministic unless AI narration is requested.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --story US-0000024',
    '<%= config.bin %> <%= command.id %> --story US-0000024 --dir ./my-repo --json',
    '<%= config.bin %> <%= command.id %> --files force-app/main/default/classes/Foo.cls --json',
  ]

  static flags = {
    story: Flags.string({char: 's', description: 'Copado user story ID scoping the assessment.'}),
    dir: Flags.string({char: 'd', description: 'Git working tree to read local changes from.', default: '.'}),
    files: Flags.string({description: 'Comma separated file paths for offline use, skips git.'}),
    'ai-narrate': Flags.boolean({description: 'Ask the operate agent for a plain English impact note. Off by default.', default: false}),
    timeout: Flags.integer({description: 'AI gateway timeout in seconds.', default: 120}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON report.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SentinelAssess)
    const storyId = (flags.story as string | undefined) ?? null
    const dir = resolve(process.cwd(), (flags.dir as string) ?? '.')
    const filesFlag = (flags.files as string | undefined) ?? null
    const asJson = (flags.json as boolean) ?? false

    let rawFiles: Array<{path: string; status: string}>
    let gitRepo: boolean
    if (filesFlag) {
      rawFiles = filesFlag
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .map((p) => ({path: p, status: 'M'}))
      gitRepo = false
    } else {
      const changes = getGitChanges(dir)
      gitRepo = changes.isRepo
      rawFiles = changes.files
    }

    const a = assess({storyId, rawFiles, gitRepo, dir})

    let aiNarration: string | null = null
    if ((flags['ai-narrate'] as boolean) ?? false) {
      const prompt =
        `Summarize this release risk assessment in plain English with an impact paragraph and a test plan. ` +
        `Score ${a.score}/100 (${a.band}). Factors: ${a.factors.map((f) => `${f.name} +${f.points}: ${f.reason}`).join(' ')} ` +
        `Files: ${a.files.map((f) => `${f.type} ${f.path}`).join(', ') || 'none'}.`
      try {
        const timeout = Math.max(30, Math.min(600, (flags.timeout as number) ?? 120))
        const out = runAgentia(['ai', 'agent', 'ask', '-p', prompt, '--agent', 'operate', '--json'], timeout * 1000)
        const parsed = JSON.parse(out)
        const root = (parsed as Record<string, unknown>)?.result ?? parsed
        aiNarration =
          str((root as Record<string, unknown>)?.content) ||
          str((root as Record<string, unknown>)?.answer) ||
          str((root as Record<string, unknown>)?.response) ||
          str((root as Record<string, unknown>)?.text) ||
          (typeof root === 'string' ? root : '')
        if (aiNarration === '') aiNarration = 'Agent returned no readable narration.'
      } catch (error: any) {
        aiNarration = `Agent narration unavailable: ${(error?.message ?? String(error)).split('\n')[0].slice(0, 120)}`
      }
    }

    if (asJson) {
      this.log(JSON.stringify({...a, aiNarration}, null, 2))
      return
    }
    for (const line of renderHuman(a, storyId ?? 'none')) this.log(line)
    if (aiNarration !== null) {
      this.log('')
      this.log('Agent note:')
      this.log(aiNarration)
    }
  }
}
