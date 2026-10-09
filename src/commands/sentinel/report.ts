import {Command, Flags} from '@oclif/core'
import {mkdirSync, writeFileSync} from 'node:fs'
import {dirname, resolve} from 'node:path'
import {assess, getGitChanges, renderMarkdown} from '../../lib.js'

export default class SentinelReport extends Command {
  static description =
    'Write the release risk assessment to a review file. Read only inputs, local file output.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --story US-0000024 --dir ./my-repo',
    '<%= config.bin %> <%= command.id %> --files force-app/main/default/classes/Foo.cls --output ./risk.md --json',
  ]

  static flags = {
    story: Flags.string({char: 's', description: 'Copado user story ID scoping the assessment.'}),
    dir: Flags.string({char: 'd', description: 'Git working tree to read local changes from.', default: '.'}),
    files: Flags.string({description: 'Comma separated file paths for offline use, skips git.'}),
    output: Flags.string({char: 'o', description: 'Report file path.'}),
    format: Flags.string({description: 'Report file format.', options: ['md', 'json'], default: 'md'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON summary.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SentinelReport)
    const storyId = (flags.story as string | undefined) ?? null
    const dir = resolve(process.cwd(), (flags.dir as string) ?? '.')
    const filesFlag = (flags.files as string | undefined) ?? null
    const format = ((flags.format as string) ?? 'md') as 'md' | 'json'
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
    const stamp = new Date().toISOString().slice(0, 10)
    const outPath = resolve(
      process.cwd(),
      (flags.output as string | undefined) ?? `./sentinel-report-${stamp}.${format}`,
    )
    mkdirSync(dirname(outPath), {recursive: true})
    const body =
      format === 'json'
        ? JSON.stringify(a, null, 2)
        : renderMarkdown(a, storyId ?? 'none')
    writeFileSync(outPath, body, 'utf8')

    if (asJson) {
      this.log(JSON.stringify({status: 'complete', score: a.score, band: a.band, readiness: a.readiness, file: outPath}, null, 2))
    } else {
      this.log(`Sentinel report: score ${a.score} (${a.band}), ${a.readiness}. Written to ${outPath}.`)
    }
  }
}
