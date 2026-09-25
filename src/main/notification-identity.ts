import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'

/** Windows resolves the toast sender separately from the notification's body icon. */
export async function registerNotificationIdentity(appId: string, iconPath: string): Promise<void> {
  // Explorer cannot read inside ASAR, even though Electron's image loader can.
  const externalIcon = iconPath.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2')
  await access(externalIcon)
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${appId}`
  for (const [name, value] of [['DisplayName', 'Sentry'], ['IconUri', externalIcon]]) {
    await new Promise<void>((resolve, reject) => {
      execFile('reg.exe', ['add', key, '/v', name, '/t', 'REG_SZ', '/d', value, '/f'],
        { windowsHide: true, timeout: 5000 }, (error) => error ? reject(error) : resolve())
    })
  }
}
