import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Cloud,
  Download,
  Trash2,
  ExternalLink,
  HardDrive,
  RefreshCw,
  FileArchive,
  LogOut,
  Loader2,
  CheckCircle2,
  Key
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { api, CloudBackupBundle } from '@/lib/tauri'
import { open } from '@tauri-apps/plugin-shell'
import { join } from '@tauri-apps/api/path'
import { formatBytes, formatDate } from '@/lib/utils'
import { useDownloadStore } from '@/lib/downloads-store'

export function CloudStorage() {
  const [bundles, setBundles] = useState<CloudBackupBundle[]>([])
  const [quota, setQuota] = useState<{ used: number; total: number } | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [selectedBundle, setSelectedBundle] = useState<CloudBackupBundle | null>(null)

  // OAuth connection state
  const [showConnectDialog, setShowConnectDialog] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const { startDownload, completeByPath, failByPath, setPanelOpen } = useDownloadStore()

  useEffect(() => {
    checkAuth()
  }, [])

  const checkAuth = async () => {
    try {
      const auth = await api.isGoogleAuthenticated()
      setIsAuthenticated(auth)
      if (auth) {
        await loadData()
      }
    } catch (error) {
      console.error('Failed to check auth:', error)
    }
    setIsLoading(false)
  }

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [backupsResult, quotaResult] = await Promise.all([
        api.listDriveBackupBundles(),
        api.getDriveQuota()
      ])

      if (backupsResult.success && backupsResult.data) {
        setBundles(backupsResult.data)
      }

      if (quotaResult.success && quotaResult.data) {
        setQuota({ used: quotaResult.data[0], total: quotaResult.data[1] })
      }
    } catch (error) {
      console.error('Failed to load cloud data:', error)
    }
    setIsLoading(false)
  }

  const handleConnect = async () => {
    setIsConnecting(true)
    setConnectionError(null)

    try {
      // Start the OAuth callback server first
      const serverPromise = api.startOAuthCallbackServer()

      // Get the auth URL and open it
      const urlResult = await api.getGoogleAuthUrl(
        clientId.trim() || undefined,
        clientSecret.trim() || undefined
      )
      if (!urlResult.success || !urlResult.data) {
        throw new Error(urlResult.error || 'Failed to get authorization URL')
      }

      // Open the browser for authorization
      await open(urlResult.data)

      // Wait for the OAuth callback
      const result = await serverPromise
      if (!result.success) {
        throw new Error(result.error || 'OAuth authentication failed')
      }

      // Success!
      setShowConnectDialog(false)
      setIsAuthenticated(true)
      await loadData()
    } catch (error) {
      console.error('OAuth connection failed:', error)
      setConnectionError(String(error))
    }
    setIsConnecting(false)
  }

  const handleDisconnect = async () => {
    try {
      const result = await api.disconnectGoogle()
      if (result.success) {
        setIsAuthenticated(false)
        setBundles([])
        setQuota(null)
      }
    } catch (error) {
      console.error('Failed to disconnect:', error)
    }
  }

  const handleDeleteBundle = async (bundle: CloudBackupBundle) => {
    try {
      const manifestDelete = await api.deleteFromDrive(bundle.manifest_file.id)
      const archiveDelete = await api.deleteFromDrive(bundle.archive_file.id)

      if (manifestDelete.success && archiveDelete.success) {
        setBundles(bundles.filter(b => b.manifest.id !== bundle.manifest.id))
      }
    } catch (error) {
      console.error('Failed to delete file:', error)
    }
  }

  const handleDownloadBundle = async (bundle: CloudBackupBundle) => {
    const homeDir = await api.getHomeDirectory()
    const outputDir = await join(homeDir, 'Downloads', 'SentryBackups')
    const archiveTarget = await join(outputDir, bundle.archive_file.name)

    startDownload({
      fileName: bundle.archive_file.name,
      outputPath: archiveTarget,
      source: 'Google Drive',
    })
    setPanelOpen(true)

    try {
      const result = await api.downloadBackupBundle({
        manifestFileId: bundle.manifest_file.id,
        manifestFileName: bundle.manifest_file.name,
        archiveFileId: bundle.archive_file.id,
        archiveFileName: bundle.archive_file.name,
        outputDir,
      })

      if (result.success) {
        completeByPath(archiveTarget)
      } else {
        failByPath(archiveTarget, result.error || 'Download failed')
      }
    } catch (error) {
      console.error('Failed to download file:', error)
      failByPath(archiveTarget, String(error))
    }
  }

  const getDriveLink = (file: CloudBackupBundle['archive_file']) =>
    (file as any).web_view_link ?? (file as any).webViewLink ?? null

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  }

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 }
  }

  const hasQuota = quota && Number.isFinite(quota.used) && Number.isFinite(quota.total)

  if (isLoading && !isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!isAuthenticated) {
    return (
      <>
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="space-y-6"
        >
          <motion.div variants={item}>
            <h1 className="text-3xl font-bold">Cloud Storage</h1>
            <p className="text-muted-foreground">
              Manage your Google Drive backups
            </p>
          </motion.div>

          <motion.div variants={item}>
            <Card>
              <CardContent className="py-16 text-center">
                <Cloud className="w-16 h-16 mx-auto mb-4 text-muted-foreground/50" />
                <h3 className="text-lg font-semibold mb-2">Connect Google Drive</h3>
                <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                  Connect your Google Drive account to store backups in the cloud
                  and access them from anywhere.
                </p>
                <Button onClick={() => setShowConnectDialog(true)}>
                  <Cloud className="w-4 h-4 mr-2" />
                  Connect Google Drive
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        </motion.div>

        {/* Connect Dialog */}
        <Dialog open={showConnectDialog} onOpenChange={setShowConnectDialog}>
          <DialogContent className={connectionError ? "max-w-2xl" : "max-w-lg"}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Key className="w-5 h-5" />
                Connect Google Drive
              </DialogTitle>
              <DialogDescription>
                Enter your Google Cloud OAuth credentials to connect your Google Drive account.
                Leave these empty if you have set GOOGLE_DRIVE_CLIENT_ID and
                GOOGLE_DRIVE_CLIENT_SECRET in your .env.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="clientId">Client ID</Label>
                <Input
                  id="clientId"
                  placeholder="Your Google OAuth Client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  disabled={isConnecting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">Client Secret</Label>
                <Input
                  id="clientSecret"
                  type="password"
                  placeholder="Your Google OAuth Client Secret"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  disabled={isConnecting}
                />
              </div>

              {connectionError && (
                <div className="p-4 rounded-lg bg-destructive/10 border border-destructive/20 space-y-3">
                  <div className="flex items-start gap-2">
                    <div className="shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-destructive" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <div className="flex-1 space-y-2">
                      <p className="font-medium text-destructive text-sm">Connection Failed</p>
                      <div className="text-sm text-muted-foreground whitespace-pre-wrap font-mono text-xs leading-relaxed max-h-48 overflow-y-auto bg-background/50 rounded p-2">
                        {connectionError}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="text-sm text-muted-foreground space-y-2">
                <p className="font-medium">How to get credentials:</p>
                <ol className="list-decimal list-inside space-y-1 text-xs">
                  <li>Go to Google Cloud Console</li>
                  <li>Create or select a project</li>
                  <li>Enable Google Drive API</li>
                  <li>Create OAuth 2.0 credentials</li>
                  <li>Add <code className="px-1 py-0.5 rounded bg-muted">http://localhost:3000</code> as authorized redirect URI</li>
                </ol>
              </div>
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setShowConnectDialog(false)}
                disabled={isConnecting}
              >
                Cancel
              </Button>
              <Button onClick={handleConnect} disabled={isConnecting}>
                {isConnecting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Cloud className="w-4 h-4 mr-2" />
                    Connect
                  </>
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="mx-auto flex w-full max-w-6xl flex-col gap-6"
    >
      {/* Header */}
      <motion.div variants={item} className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Cloud Storage</h1>
          <p className="text-muted-foreground">
            Manage your Google Drive backups
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={loadData} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* Account Status + Storage */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div variants={item}>
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-lg">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Google Drive Connected
              </CardTitle>
              <CardDescription>
                Your account is connected and ready to store backups
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                className="text-destructive hover:text-destructive"
              >
                <LogOut className="w-4 h-4 mr-2" />
                Disconnect Account
              </Button>
            </CardContent>
          </Card>
        </motion.div>

        {hasQuota && (
          <motion.div variants={item}>
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <HardDrive className="w-5 h-5" />
                  Storage Usage
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>{formatBytes(quota.used)} used</span>
                    <span>{formatBytes(quota.total)} total</span>
                  </div>
                  <Progress value={(quota.used / quota.total) * 100} />
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(quota.total - quota.used)} available
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </div>

      {/* Backups list */}
      <motion.div variants={item}>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileArchive className="w-5 h-5" />
              Cloud Backups
            </CardTitle>
            <CardDescription>
              {bundles.length} backup{bundles.length !== 1 ? 's' : ''} with manifests in Google Drive
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bundles.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Cloud className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No backups uploaded yet</p>
                <p className="text-sm">Run a backup to upload files to Google Drive</p>
              </div>
            ) : (
              <div className="space-y-3">
                {bundles.map((bundle) => (
                  <div
                    key={bundle.manifest.id}
                    className="flex flex-col gap-3 p-4 rounded-lg bg-muted/50"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <FileArchive className="w-8 h-8 text-muted-foreground" />
                        <div>
                          <p className="font-medium">Backup {bundle.manifest.id}</p>
                          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                            <span>{formatDate(bundle.manifest.created_at)}</span>
                            <span>•</span>
                            <span>{bundle.manifest.files.length} file(s)</span>
                            <span>•</span>
                            <span>{formatBytes(bundle.manifest.total_size)} total</span>
                            <span>•</span>
                            <span>{formatBytes(bundle.manifest.compressed_size)} compressed</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Backup set: {bundle.manifest.backup_set_id}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {getDriveLink(bundle.archive_file) && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => window.open(getDriveLink(bundle.archive_file)!, '_blank')}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setSelectedBundle(bundle)}
                        >
                          View details
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadBundle(bundle)}
                        >
                          <Download className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteBundle(bundle)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-muted-foreground">Archive size</p>
                        <p className="font-medium">
                          {bundle.archive_file.size
                            ? formatBytes(bundle.archive_file.size)
                            : 'Unknown'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Manifest size</p>
                        <p className="font-medium">
                          {bundle.manifest_file.size
                            ? formatBytes(bundle.manifest_file.size)
                            : 'Unknown'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Retention</p>
                        <p className="font-medium">
                          {bundle.manifest.retention_until
                            ? formatDate(bundle.manifest.retention_until)
                            : 'Not set'}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Files listed</p>
                        <p className="font-medium">{bundle.manifest.files.length}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </motion.div>
      <Dialog open={!!selectedBundle} onOpenChange={(open) => !open && setSelectedBundle(null)}>
        <DialogContent className="max-w-3xl">
          {selectedBundle && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileArchive className="w-5 h-5" />
                  Backup {selectedBundle.manifest.id}
                </DialogTitle>
                <DialogDescription>
                  Created {formatDate(selectedBundle.manifest.created_at)} ·{' '}
                  {selectedBundle.manifest.files.length} file(s) ·{' '}
                  {formatBytes(selectedBundle.manifest.total_size)} total
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Backup set</p>
                    <p className="font-medium">{selectedBundle.manifest.backup_set_id}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Compressed size</p>
                    <p className="font-medium">
                      {formatBytes(selectedBundle.manifest.compressed_size)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Retention</p>
                    <p className="font-medium">
                      {selectedBundle.manifest.retention_until
                        ? formatDate(selectedBundle.manifest.retention_until)
                        : 'Not set'}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Archive file</p>
                    <p className="font-medium break-all">{selectedBundle.archive_file.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Manifest file</p>
                    <p className="font-medium break-all">{selectedBundle.manifest_file.name}</p>
                  </div>
                </div>

                <div className="border rounded-lg p-3 max-h-72 overflow-y-auto">
                  <div className="grid grid-cols-12 text-xs text-muted-foreground pb-2 border-b">
                    <div className="col-span-6">Path</div>
                    <div className="col-span-2 text-right pr-2">Size</div>
                    <div className="col-span-2">Modified</div>
                    <div className="col-span-2">Backed up</div>
                  </div>
                  <div className="divide-y text-sm">
                    {selectedBundle.manifest.files.map((file) => {
                      const path = file.relative_path || file.path
                      return (
                        <div key={path} className="grid grid-cols-12 py-2 items-start">
                          <div className="col-span-6 pr-2 break-all">{path}</div>
                          <div className="col-span-2 text-right pr-2">
                            {formatBytes(file.size)}
                          </div>
                          <div className="col-span-2 text-muted-foreground">
                            {formatDate(file.modified)}
                          </div>
                          <div className="col-span-2 text-muted-foreground">
                            {file.backed_up_at ? formatDate(file.backed_up_at) : '—'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
