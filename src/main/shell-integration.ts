import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ShellIntegration } from '@shared/types'

/**
 * "Send to Google Drive" in Windows Explorer, installed per user (HKCU, no admin):
 *  - a right-click verb on files and folders (one Sentry launch per item, batched by the running app)
 *  - a Send to shortcut, which hands every selected item to one launch
 * On Windows 11 the classic verb lives under "Show more options"; Send to is in both menus.
 * Launches carry `--upload <paths…>` and are forwarded to the running Sentry by the single-instance lock.
 */

const VERB = 'SentryUpload'
const KEYS = [`HKCU\\Software\\Classes\\*\\shell\\${VERB}`, `HKCU\\Software\\Classes\\Directory\\shell\\${VERB}`]
const LABEL = 'Send to Google Drive'
export const UPLOAD_FLAG = '--upload'

function sendToPath(): string {
  return join(app.getPath('appData'), 'Microsoft', 'Windows', 'SendTo', 'Google Drive (Sentry).lnk')
}

/** In dev Electron needs the app folder as its first argument; installed builds don't. */
function launcher(): { exe: string; baseArgs: string[] } {
  return { exe: process.execPath, baseArgs: app.isPackaged ? [] : [app.getAppPath()] }
}

function reg(args: string[]): Promise<boolean> {
  return new Promise((resolve) => execFile('reg.exe', args, { windowsHide: true }, (error) => resolve(!error)))
}

export async function shellStatus(): Promise<ShellIntegration> {
  if (process.platform !== 'win32') return { supported: false, contextMenu: false, sendTo: false }
  return { supported: true, contextMenu: await reg(['query', KEYS[0]]), sendTo: existsSync(sendToPath()) }
}

export async function installShellIntegration(iconPath: string): Promise<ShellIntegration> {
  if (process.platform !== 'win32') return shellStatus()
  const { exe, baseArgs } = launcher()
  const quoted = [exe, ...baseArgs].map((a) => `"${a}"`).join(' ')
  // Installed builds carry their icon inside the exe; dev points at the .ico.
  const icon = app.isPackaged ? `"${exe}",0` : iconPath
  for (const key of KEYS) {
    const ok =
      (await reg(['add', key, '/ve', '/d', LABEL, '/f'])) &&
      (await reg(['add', key, '/v', 'Icon', '/d', icon, '/f'])) &&
      (await reg(['add', key, '/v', 'MultiSelectModel', '/d', 'Player', '/f'])) &&
      (await reg(['add', `${key}\\command`, '/ve', '/d', `${quoted} ${UPLOAD_FLAG} "%1"`, '/f']))
    if (!ok) {
      await removeShellIntegration()
      throw new Error('Windows didn’t let Sentry add the right-click option.')
    }
  }
  const linked = shell.writeShortcutLink(sendToPath(), 'create', {
    target: exe,
    args: [...baseArgs.map((a) => `"${a}"`), UPLOAD_FLAG].join(' '),
    icon: app.isPackaged ? exe : iconPath,
    iconIndex: 0,
    description: 'Upload to Google Drive with Sentry'
  })
  if (!linked) throw new Error('Windows didn’t let Sentry add the Send to shortcut.')
  return shellStatus()
}

export async function removeShellIntegration(): Promise<ShellIntegration> {
  if (process.platform !== 'win32') return shellStatus()
  for (const key of KEYS) await reg(['delete', key, '/f'])
  rmSync(sendToPath(), { force: true })
  return shellStatus()
}

/** Paths that follow `--upload` in a launch's argv (Explorer passes one, Send to passes many). */
export function uploadPathsFrom(argv: string[]): string[] {
  const at = argv.indexOf(UPLOAD_FLAG)
  if (at < 0) return []
  return argv.slice(at + 1).filter((a) => a && !a.startsWith('--') && existsSync(a))
}
