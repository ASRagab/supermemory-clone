export type InstallMode = 'agent' | 'api' | 'full'
export type McpScope = 'project' | 'user' | 'local'
export type InstallerStdio = 'inherit' | 'pipe'

export interface ParsedCliArgs {
  mode: InstallMode
  targetDir: string
  envFile?: string
  skipApiKeys: boolean
  mcpScope?: McpScope
  skipDocker: boolean
  skipApiStart: boolean
  runtimeVersion: string
  sourcePath?: string
  update: boolean
  cwd: string
}

export interface RuntimeTarball {
  cleanup: () => void
  sourceType: 'npm' | 'local'
  specifier: string
  tarballPath: string
}

export interface RuntimePackageMetadata {
  name: string
  version: string
}

export interface InstallerRunSummary {
  action: 'install' | 'update'
  installMode: InstallMode
  installDir: string
  envFile?: string
  apiHostPort?: string
  apiStarted: boolean
  connectivityOk: boolean
  mcp: {
    scope?: McpScope
    status: string
  }
  flags: {
    skipDocker: boolean
    skipApiKeys: boolean
    skipApiStart: boolean
    apiKeysWereSkipped: boolean
  }
}

export interface InstallManifest {
  installerVersion: string
  runtimeVersion: string
  installMode: InstallMode
  targetDir: string
  mcpScope?: McpScope
  installedAt: string
}

export interface CliIo {
  stderr: (message: string) => void
  stdout: (message: string) => void
}
