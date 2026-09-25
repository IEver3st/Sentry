import type { DriveAccount, DriveFile, DriveQuota, FolderListing, ProviderId, ShareLink } from '@shared/types'

export type ProgressFn = (bytesDone: number) => void

/**
 * Everything Sentry needs from a cloud drive. The demo provider implements it
 * against a local folder; the Google provider implements it against Drive v3.
 */
export interface DriveProvider {
  readonly id: ProviderId
  account(): Promise<DriveAccount>
  quota(): Promise<DriveQuota>
  get(id: string): Promise<DriveFile>
  list(folderId: string | null): Promise<FolderListing>
  recent(limit: number): Promise<DriveFile[]>
  search(query: string): Promise<DriveFile[]>
  shared(): Promise<DriveFile[]>
  /** Every non-trashed file the user owns. Used to draw the storage map. */
  allFiles(): Promise<DriveFile[]>
  createFolder(parentId: string | null, name: string): Promise<DriveFile>
  rename(id: string, name: string): Promise<DriveFile>
  trash(id: string): Promise<void>
  /** Re-parent a file or folder. parentId null means My Drive. */
  move(id: string, parentId: string | null): Promise<DriveFile>
  setStarred(id: string, starred: boolean): Promise<DriveFile>
  /** role null removes the public link. */
  setLink(id: string, role: ShareLink['role'] | null): Promise<DriveFile>
  upload(localPath: string, parentId: string | null, name: string, onProgress: ProgressFn, signal: AbortSignal): Promise<DriveFile>
  download(id: string, destPath: string, onProgress: ProgressFn, signal: AbortSignal): Promise<void>
  /** Forget credentials / local state held for this provider. */
  signOut(): Promise<void>
}
