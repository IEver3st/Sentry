import { expect, test } from 'bun:test'
import type { DriveFile } from '../src/shared/types'
import { moveSelection, trashSelection } from '../src/main/drive-mutations'

const file = (id: string, parentId: string | null): DriveFile => ({
  id,
  name: id,
  kind: 'other',
  mimeType: 'application/octet-stream',
  size: 1,
  modifiedAt: '',
  createdAt: '',
  parentId,
  starred: false,
  link: null
})

test('partial trash invalidates folders whose earlier items were trashed', async () => {
  const folders: Array<Array<string | null>> = []
  const drive = {
    get: async (id: string) => file(id, id === 'first' ? 'folder-a' : 'folder-b'),
    trash: async (id: string) => { if (id === 'second') throw new Error('permission denied') }
  }

  await expect(trashSelection(['first', 'second'], drive, (ids) => folders.push(ids))).rejects.toThrow('permission denied')
  expect(folders).toEqual([['folder-a']])
})

test('partial move invalidates the destination and source after an earlier move', async () => {
  const folders: Array<Array<string | null>> = []
  const drive = {
    get: async (id: string) => {
      if (id === 'second') throw new Error('file unavailable')
      return file(id, 'source-folder')
    },
    move: async () => file('first', 'destination-folder')
  }

  await expect(moveSelection(['first', 'second'], 'destination-folder', drive, (ids) => folders.push(ids))).rejects.toThrow('file unavailable')
  expect(folders).toEqual([['destination-folder', 'source-folder']])
})
