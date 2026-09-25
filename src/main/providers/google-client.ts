/** Accept the Desktop app JSON downloaded by Google Cloud without manual editing. */
export interface GoogleClientConfig {
  clientId: string
  clientSecret: string
}

export function parseGoogleClient(value: unknown): GoogleClientConfig {
  if (!value || typeof value !== 'object') throw new Error('Choose the JSON file for a Google Desktop app client.')
  const raw = value as Record<string, unknown>
  if (raw.web) throw new Error('This is a Web client. Download a Desktop app client from Google Cloud instead.')
  const installed = raw.installed as Record<string, unknown> | undefined
  const clientId = installed?.client_id ?? raw.clientId
  const clientSecret = installed?.client_secret ?? raw.clientSecret
  if (typeof clientId !== 'string' || !/^[a-zA-Z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId.trim()) ||
      typeof clientSecret !== 'string' || !clientSecret.trim()) {
    throw new Error('The JSON file is missing a valid Google client ID or client secret.')
  }
  return { clientId: clientId.trim(), clientSecret: clientSecret.trim() }
}
