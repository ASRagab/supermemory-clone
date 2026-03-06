import { homedir } from 'node:os'
import { relative, resolve } from 'node:path'

import type { InstallerRunSummary, ParsedCliArgs } from './types.js'

function isProjectMcpReady(summary: InstallerRunSummary): boolean {
  return (
    summary.mcp.scope === 'project' &&
    (summary.mcp.status === 'registered' || summary.mcp.status === 'match')
  )
}

function displayTargetDir(cwd: string, targetDir: string): string {
  const resolvedHome = resolve(homedir())
  if (targetDir === resolvedHome) {
    return '~'
  }

  if (targetDir.startsWith(`${resolvedHome}/`)) {
    return `~/${relative(resolvedHome, targetDir)}`
  }

  const relativeTarget = relative(cwd, targetDir)
  if (!relativeTarget) {
    return '.'
  }

  if (relativeTarget.startsWith('.')) {
    return relativeTarget
  }

  return `./${relativeTarget}`
}

export function renderSuccessOutput(args: ParsedCliArgs, summary: InstallerRunSummary): string {
  const lines = ['Install complete.', '', 'Next:']
  let step = 1
  const resolvedCwd = resolve(args.cwd)
  const resolvedTargetDir = resolve(args.targetDir)

  if (resolvedCwd !== resolvedTargetDir) {
    lines.push(`  ${step}. cd ${displayTargetDir(resolvedCwd, resolvedTargetDir)}`)
    step += 1
  }

  if (args.mode === 'agent' || args.mode === 'full') {
    if (isProjectMcpReady(summary)) {
      lines.push(`  ${step}. Open Claude in this directory`)
      step += 1
    } else if (args.mcpScope) {
      lines.push(`  ${step}. Re-run MCP registration after fixing Claude CLI access`)
      step += 1
    }
  }

  if (args.mode === 'full' && isProjectMcpReady(summary)) {
    lines.push(`  ${step}. Ask Claude to use supermemory_add`)
  }

  if (summary.apiStarted && summary.apiHostPort && (args.mode === 'api' || args.mode === 'full')) {
    lines.push('', 'API health:', `  curl http://localhost:${summary.apiHostPort}/health`)
  }

  if (args.skipApiKeys) {
    lines.push('', 'API keys were skipped, so extraction quality will be limited until you add them.')
  }

  return `${lines.join('\n')}\n`
}
