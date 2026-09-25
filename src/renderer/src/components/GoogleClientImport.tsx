import { useState } from 'react'
import { api, fail, useApp } from '@/lib/store'
import { Button, Spinner } from './ui'

export function GoogleClientImport({ disabled = false }: { disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const importClient = async (): Promise<void> => {
    setBusy(true)
    try { useApp.setState({ status: await api().importGoogleClient() }) }
    catch (error) { fail('Could not import Google client', error) }
    finally { setBusy(false) }
  }
  return <Button size="sm" onClick={importClient} disabled={disabled || busy}>
    {busy && <Spinner size={14} />} Import Google client JSON
  </Button>
}
