import { execFile } from 'node:child_process'
import { statfs } from 'node:fs/promises'
import { promisify } from 'node:util'
import type { LocalDrive } from '@shared/types'

const exec = promisify(execFile)

export async function localDrives(): Promise<LocalDrive[]> {
  if (process.platform === 'win32') {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); @(Get-CimInstance Win32_LogicalDisk -ErrorAction Stop | Where-Object { $_.DriveType -in 2,3,4 } | Select-Object DeviceID,VolumeName,Size,FreeSpace) | ConvertTo-Json -Compress'
    ], { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 })
    const data = JSON.parse(stdout.trim() || '[]')
    const rows = Array.isArray(data) ? data : [data]
    return rows.map((d): LocalDrive => ({
      root: `${d.DeviceID}\\`, label: d.VolumeName || 'Local disk',
      total: typeof d.Size === 'number' ? d.Size : null,
      free: typeof d.FreeSpace === 'number' ? d.FreeSpace : null
    })).sort((a, b) => a.root.localeCompare(b.root))
  }
  // Other mount points remain selectable through Add folder.
  const fs = await statfs('/')
  return [{ root: '/', label: 'File system', total: fs.blocks * fs.bsize, free: fs.bavail * fs.bsize }]
}
