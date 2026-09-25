import type { SentryEvents } from '@shared/types'

type Deliver = <K extends keyof SentryEvents>(event: K, payload: SentryEvents[K]) => void

/** Keep current state for an absent UI, without waking it for every chunk or file. */
export class RendererEvents {
  private visible = false
  private ready = false
  private enabled = false
  private pending = new Map<keyof SentryEvents, () => void>()
  private folders = new Set<string | null>()
  private uploads = new Map<string, number>()
  private driveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly deliver: Deliver, private readonly activityChanged: (active: boolean) => void) {}

  get active(): boolean { return this.enabled }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.updateActivity()
  }

  rendererReady(): void {
    this.ready = true
    this.updateActivity(true)
  }

  rendererLoading(): void {
    this.ready = false
    this.updateActivity()
  }

  private updateActivity(force = false): void {
    const active = this.visible && this.ready
    if (!force && active === this.enabled) return
    this.enabled = active
    if (this.driveTimer) clearTimeout(this.driveTimer)
    this.driveTimer = null
    if (this.ready) this.deliver('window-active', active)
    if (active) {
      const pending = [...this.pending.values()]
      this.pending.clear()
      for (const deliver of pending) deliver()
      this.flushDrive()
      for (const [target, count] of this.uploads) this.deliver('external-upload', { target, count })
      this.uploads.clear()
    }
    this.activityChanged(active)
  }

  send<K extends keyof SentryEvents>(event: K, payload: SentryEvents[K]): void {
    if (event === 'drive-changed') {
      for (const folder of (payload as SentryEvents['drive-changed']).folderIds) this.folders.add(folder)
      if (this.active && !this.driveTimer) {
        this.driveTimer = setTimeout(() => {
          this.driveTimer = null
          this.flushDrive()
        }, 250)
      }
    } else if (this.active) {
      this.deliver(event, payload)
    } else if (event === 'external-upload') {
      const { target, count } = payload as SentryEvents['external-upload']
      this.uploads.set(target, (this.uploads.get(target) ?? 0) + count)
    } else {
      this.pending.set(event, () => this.deliver(event, payload))
    }
  }

  private flushDrive(): void {
    if (!this.active || !this.folders.size) return
    const folderIds = [...this.folders]
    this.folders.clear()
    this.deliver('drive-changed', { folderIds })
  }

  dispose(): void {
    if (this.driveTimer) clearTimeout(this.driveTimer)
    this.driveTimer = null
    this.pending.clear()
    this.folders.clear()
    this.uploads.clear()
    this.visible = this.ready = this.enabled = false
    this.activityChanged(false)
  }
}
