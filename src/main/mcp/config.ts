import { app } from 'electron'
import fs from 'fs'
import path from 'path'
import { getMcpServerUrl } from './server'

type McpConfigPaths = {
  claude: string
  codex: string
  url: string
}

export function ensureMcpConfigFiles(): McpConfigPaths {
  const dir = path.join(app.getPath('userData'), 'mcp')
  fs.mkdirSync(dir, { recursive: true })

  const url = getMcpServerUrl()
  const claude = path.join(dir, 'claude-mcp.json')
  const codex = path.join(dir, 'codex-mcp.config.toml')

  fs.writeFileSync(claude, JSON.stringify({
    mcpServers: {
      strata: {
        type: 'http',
        url
      }
    }
  }, null, 2), 'utf8')

  fs.writeFileSync(codex, [
    '[mcp_servers.strata]',
    `url = "${url}"`,
    ''
  ].join('\n'), 'utf8')

  return { claude, codex, url }
}
