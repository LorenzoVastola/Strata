import path from 'path'

export function assertWithinWorkspace(workspaceRoot: string | null | undefined, targetPath: string): string {
  if (!workspaceRoot) {
    throw new Error('Nessun workspace attivo nel processo principale.')
  }

  const resolvedRoot = path.resolve(workspaceRoot)
  const resolvedTarget = path.resolve(targetPath)

  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('Path fuori dal workspace attivo.')
  }

  return resolvedTarget
}
