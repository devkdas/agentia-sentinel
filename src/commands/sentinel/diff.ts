import {Command, Flags} from '@oclif/core'
import {resolve} from 'node:path'
import {classifyFile, getGitChanges} from '../../lib.js'

export default class SentinelDiff extends Command {
  static description =
    'Group changed files by metadata type with risk weights. Fully offline.'

  static examples = [
    '<%= config.bin %> <%= command.id %> --files force-app/main/default/classes/Foo.cls,force-app/main/default/profiles/Admin.profile-meta.xml',
    '<%= config.bin %> <%= command.id %> --dir ./my-repo --json',
  ]

  static flags = {
    files: Flags.string({description: 'Comma separated file paths to classify.'}),
    dir: Flags.string({char: 'd', description: 'Git working tree to read local changes from.'}),
    json: Flags.boolean({char: 'j', description: 'Machine readable JSON output.', default: false}),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(SentinelDiff)
    const filesFlag = (flags.files as string | undefined) ?? null
    const dirFlag = (flags.dir as string | undefined) ?? null
    const asJson = (flags.json as boolean) ?? false

    if (!filesFlag && !dirFlag) {
      const detail = 'Pass --files for a path list or --dir for git changes.'
      if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
      else this.log(detail)
      this.exit(1)
    }

    let raw: Array<{path: string; status: string}>
    if (filesFlag) {
      raw = filesFlag
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '')
        .map((p) => ({path: p, status: 'M'}))
    } else {
      const changes = getGitChanges(resolve(process.cwd(), dirFlag as string))
      if (!changes.isRepo) {
        const detail = `Not a git repo: ${dirFlag}. Pass --files for offline use.`
        if (asJson) this.log(JSON.stringify({status: 'error', detail}, null, 2))
        else this.log(detail)
        this.exit(1)
      }
      raw = changes.files
    }

    const grouped = new Map<string, {weight: number; files: string[]}>()
    for (const f of raw) {
      const c = classifyFile(f.path, f.status)
      const g = grouped.get(c.type) ?? {weight: c.weight, files: []}
      g.files.push(c.path)
      grouped.set(c.type, g)
    }
    const totalWeight = [...grouped.values()].reduce((s, g) => s + g.weight * g.files.length, 0)
    const payload = {
      status: 'complete',
      fileCount: raw.length,
      totalWeight,
      groups: [...grouped.entries()].map(([type, g]) => ({type, weight: g.weight, count: g.files.length, files: g.files.slice(0, 20)})),
    }
    if (asJson) {
      this.log(JSON.stringify(payload, null, 2))
      return
    }
    this.log(`Sentinel diff: ${payload.fileCount} files, total weight ${totalWeight}.`)
    for (const g of payload.groups) {
      this.log(`  ${g.type} (weight ${g.weight}): ${g.count} file${g.count === 1 ? '' : 's'}`)
      for (const f of g.files.slice(0, 5)) this.log(`    - ${f}`)
    }
  }
}
