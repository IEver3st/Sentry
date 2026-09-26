import type { DriveProvider } from './providers/types'

type Changed = (folderIds: Array<string | null>) => void

/** Emit invalidation after every successful batch mutation, including partial batches. */
export async function trashSelection(
  ids: string[],
  drive: Pick<DriveProvider, 'get' | 'trash'>,
  changed: Changed
): Promise<void> {
  const parents = new Set<string | null>()
  let mutated = false
  try {
    for (const id of ids) {
      const file = await drive.get(id)
      await drive.trash(id)
      parents.add(file.parentId)
      mutated = true
    }
  } finally {
    if (mutated) changed([...parents])
  }
}

export async function moveSelection(
  ids: string[],
  parentId: string | null,
  drive: Pick<DriveProvider, 'get' | 'move'>,
  changed: Changed
): Promise<void> {
  const parents = new Set<string | null>([parentId])
  let mutated = false
  try {
    for (const id of ids) {
      if (id === parentId) continue
      const file = await drive.get(id)
      if (file.parentId === parentId) continue
      await drive.move(id, parentId)
      parents.add(file.parentId)
      mutated = true
    }
  } finally {
    if (mutated) changed([...parents])
  }
}
