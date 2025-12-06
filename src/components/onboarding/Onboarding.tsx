import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Shield,
  Cloud,
  MapPin,
  FolderPlus,
  ChevronLeft,
  Check,
  Loader2,
  CloudRain,
  Sparkles,
  SlidersHorizontal,
  Sun,
  Moon,
  Monitor
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { open } from '@tauri-apps/plugin-shell'
import { api } from '@/lib/tauri'
import { useAppStore, useUIStore } from '@/lib/store'

interface OnboardingProps {
  onComplete: () => void
}

type StepId = 'welcome' | 'setup-mode' | 'google' | 'location' | 'backup-set' | 'complete'
type SetupMode = 'default' | 'custom'

const steps: { id: StepId; title: string; description: string; icon: any }[] = [
  {
    id: 'welcome',
    title: 'Welcome to Sentry',
    description: 'Your intelligent backup guardian',
    icon: Shield,
  },
  {
    id: 'setup-mode',
    title: 'Choose Your Setup',
    description: 'Start fast with defaults or bring your own keys',
    icon: SlidersHorizontal,
  },
  {
    id: 'google',
    title: 'Connect Google Drive',
    description: 'Securely store your backups in the cloud',
    icon: Cloud,
  },
  {
    id: 'location',
    title: 'Enable Weather Alerts',
    description: 'Automatic backups during severe weather',
    icon: MapPin,
  },
  {
    id: 'backup-set',
    title: 'Create Your First Backup',
    description: 'Choose what to protect',
    icon: FolderPlus,
  },
  {
    id: 'complete',
    title: 'All Set!',
    description: 'You\'re ready to start protecting your data',
    icon: Sparkles,
  },
]

export function Onboarding({ onComplete }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [setupMode, setSetupMode] = useState<SetupMode>('default')
  const { setGoogleAuthenticated, setLocation, addBackupSet } = useAppStore()
  const { theme, setTheme } = useUIStore()

  // Google OAuth state
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [authUrl, setAuthUrl] = useState('')
  const [googleError, setGoogleError] = useState<string | null>(null)

  // Location state
  const [detectedLocation, setDetectedLocation] = useState<any>(null)
  const [locationLoading, setLocationLoading] = useState(false)

  // Backup set state
  const [selectedPresets, setSelectedPresets] = useState<string[]>([])
  const presets = [
    { id: 'documents', name: 'Documents', description: 'Personal documents and files' },
    { id: 'photos', name: 'Photos', description: 'Pictures and images' },
    { id: 'desktop', name: 'Desktop', description: 'Desktop files' },
    { id: 'code', name: 'Code Projects', description: 'Source code (excludes node_modules, etc.)' },
  ]

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleGetAuthUrl = async () => {
    if (setupMode === 'custom' && (!googleClientId.trim() || !googleClientSecret.trim())) {
      setGoogleError('Client ID and secret are required for custom setup.')
      return
    }

    setIsLoading(true)
    setGoogleError(null)
    try {
      // Get the auth URL
      const result = await api.getGoogleAuthUrl(
        setupMode === 'custom' ? googleClientId.trim() || undefined : undefined,
        setupMode === 'custom' ? googleClientSecret.trim() || undefined : undefined
      )
      if (!result.success || !result.data) {
        setGoogleError(result.error || 'Unable to start Google authorization. Check your credentials or .env values.')
        setIsLoading(false)
        return
      }

      setAuthUrl(result.data)

      // Start the callback server in the background FIRST
      const serverPromise = api.startOAuthCallbackServer()

      // Then open the browser
      await open(result.data)

      // Wait for the callback server to complete
      const authResult = await serverPromise
      if (authResult.success) {
        setGoogleAuthenticated(true)
        handleNext()
      } else {
        console.error('Auth failed:', authResult.error)
        setGoogleError(authResult.error || 'Authorization failed. Verify the client ID/secret and redirect URI.')
        setAuthUrl('') // Reset to show the form again
      }
    } catch (error) {
      console.error('Failed to authenticate:', error)
      setGoogleError('Could not complete Google authorization. Please verify your client settings or try custom keys.')
      setAuthUrl('') // Reset on error
    }
    setIsLoading(false)
  }

  const handleDetectLocation = async () => {
    setLocationLoading(true)
    try {
      const result = await api.detectLocation()
      if (result.success && result.data) {
        setDetectedLocation(result.data)
        setLocation(result.data)
      }
    } catch (error) {
      console.error('Failed to detect location:', error)
    }
    setLocationLoading(false)
  }

  const handleCreateBackupSets = async () => {
    if (selectedPresets.length === 0) {
      handleNext()
      return
    }

    setIsLoading(true)
    try {
      const homeDir = await api.getHomeDirectory()
      for (const preset of selectedPresets) {
        const result = await api.createBackupSetFromPreset(preset, homeDir)
        if (result.success && result.data) {
          addBackupSet(result.data)
        }
      }
      handleNext()
    } catch (error) {
      console.error('Failed to create backup sets:', error)
    }
    setIsLoading(false)
  }

  const handleComplete = async () => {
    setIsLoading(true)
    try {
      await api.completeOnboarding()
      onComplete()
    } catch (error) {
      console.error('Failed to complete onboarding:', error)
    }
    setIsLoading(false)
  }

  const handleThemeChange = (nextTheme: 'light' | 'dark' | 'system') => {
    setTheme(nextTheme)
    if (nextTheme === 'system') {
      const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
      document.documentElement.classList.toggle('dark', isDark)
      return
    }
    document.documentElement.classList.toggle('dark', nextTheme === 'dark')
  }

  const fadeVariants = {
    enter: {
      opacity: 0,
    },
    center: {
      opacity: 1,
    },
    exit: {
      opacity: 0,
    },
  }

  const StepHeader = ({ icon: Icon, title, description }: { icon: any; title: string; description?: string }) => (
    <div className="text-center space-y-2">
      <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <h2 className="text-2xl font-bold">{title}</h2>
      {description ? <p className="text-muted-foreground">{description}</p> : null}
    </div>
  )

  const WelcomeStep = () => (
    <div className="text-center space-y-6">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', duration: 0.6 }}
        className="mx-auto w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center"
      >
        <Shield className="w-12 h-12 text-primary" />
      </motion.div>
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">Welcome to Sentry</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Sentry keeps your files safe with automated cloud backups, weather-aware
          triggers, and a minimal control panel.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4 pt-4">
        <div className="p-4 rounded-2xl bg-muted/60">
          <Cloud className="w-7 h-7 mx-auto mb-2 text-primary" />
          <p className="text-sm font-medium">Cloud Backup</p>
        </div>
        <div className="p-4 rounded-2xl bg-muted/60">
          <CloudRain className="w-7 h-7 mx-auto mb-2 text-primary" />
          <p className="text-sm font-medium">Weather Alerts</p>
        </div>
        <div className="p-4 rounded-2xl bg-muted/60">
          <Shield className="w-7 h-7 mx-auto mb-2 text-primary" />
          <p className="text-sm font-medium">Auto Protection</p>
        </div>
      </div>
      <Button size="lg" onClick={handleNext} className="w-full mt-2">
        Get Started
      </Button>
    </div>
  )

  const SetupModeStep = () => (
    <div className="space-y-6">
      <StepHeader
        icon={SlidersHorizontal}
        title="Choose your setup style"
        description="Use preconfigured defaults or bring your own OAuth keys"
      />
      <div className="grid grid-cols-1 gap-3">
        <Card
          className={`cursor-pointer transition-all rounded-2xl ${setupMode === 'default'
            ? 'border-primary bg-primary/5'
            : 'hover:border-muted-foreground/60'
            }`}
          onClick={() => setSetupMode('default')}
        >
          <CardContent className="p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Check className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold flex items-center gap-2">
                Use Sentry defaults
                <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">Recommended</span>
              </p>
              <p className="text-sm text-muted-foreground">
                Fastest path. Uses the built-in OAuth credentials and sensible defaults. You can change later.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card
          className={`cursor-pointer transition-all rounded-2xl ${setupMode === 'custom'
            ? 'border-primary bg-primary/5'
            : 'hover:border-muted-foreground/60'
            }`}
          onClick={() => setSetupMode('custom')}
        >
          <CardContent className="p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
              <SlidersHorizontal className="w-5 h-5 text-foreground" />
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Bring your own keys</p>
              <p className="text-sm text-muted-foreground">
                Use your own Google OAuth client and secret. Ideal for advanced setups or restricted environments.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium">Appearance</p>
        <div className="grid grid-cols-3 gap-2">
          <Button
            variant={theme === 'light' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => handleThemeChange('light')}
          >
            <Sun className="w-4 h-4 mr-2" />
            Light
          </Button>
          <Button
            variant={theme === 'dark' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => handleThemeChange('dark')}
          >
            <Moon className="w-4 h-4 mr-2" />
            Dark
          </Button>
          <Button
            variant={theme === 'system' ? 'default' : 'outline'}
            className="rounded-xl"
            onClick={() => handleThemeChange('system')}
          >
            <Monitor className="w-4 h-4 mr-2" />
            System
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">You can change this anytime in Settings.</p>
      </div>

      <Button onClick={handleNext} className="w-full rounded-xl">
        Continue
      </Button>
    </div>
  )

  const GoogleStep = () => (
    <div className="space-y-6">
      <StepHeader
        icon={Cloud}
        title="Connect Google Drive"
        description="Securely store your backups in Google Drive"
      />

      {!authUrl ? (
        <div className="space-y-4">
          {setupMode === 'custom' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="clientId">Google Client ID</Label>
                <Input
                  id="clientId"
                  placeholder="Enter your Google OAuth Client ID"
                  value={googleClientId}
                  onChange={(e) => setGoogleClientId(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientSecret">Google Client Secret</Label>
                <Input
                  id="clientSecret"
                  type="password"
                  placeholder="Enter your Google OAuth Client Secret"
                  value={googleClientSecret}
                  onChange={(e) => setGoogleClientSecret(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Need credentials? Create them in the
                {' '}
                <a
                  href="https://console.cloud.google.com/apis/credentials"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  Google Cloud Console
                </a>
                .
              </p>
            </>
          ) : (
            <Card className="rounded-2xl">
              <CardContent className="p-4 space-y-2">
                <p className="font-medium">Using Sentry defaults</p>
                <p className="text-sm text-muted-foreground">
                  We'll use the preconfigured OAuth client for a quick start. You can switch
                  to custom keys later from Settings.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0 text-primary"
                  onClick={() => setSetupMode('custom')}
                >
                  Prefer custom keys?
                </Button>
              </CardContent>
            </Card>
          )}

          {googleError ? <p className="text-xs text-red-500">{googleError}</p> : null}

          <Button
            onClick={handleGetAuthUrl}
            disabled={isLoading}
            className="w-full rounded-xl"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Connect to Google Drive
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <div className="text-center">
              <p className="font-medium">Waiting for authorization...</p>
              <p className="text-sm text-muted-foreground">
                Complete the sign-in in your browser.
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                The window will close automatically when done.
              </p>
            </div>
          </div>
        </div>
      )}

      <Button
        variant="outline"
        onClick={handleNext}
        className="w-full rounded-xl"
      >
        Skip for now
      </Button>
    </div>
  )

  const LocationStep = () => (
    <div className="space-y-6">
      <StepHeader
        icon={MapPin}
        title="Weather-Based Backups"
        description="Automatically backup when severe weather is near you"
      />

      {!detectedLocation ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground text-center">
            We only use your approximate location to trigger weather-aware backups. Your
            address is never stored or shared.
          </p>
          <Button
            onClick={handleDetectLocation}
            disabled={locationLoading}
            className="w-full rounded-xl"
          >
            {locationLoading ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <MapPin className="w-4 h-4 mr-2" />
            )}
            Detect My Location
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <Card className="rounded-2xl">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <Check className="w-5 h-5 text-green-600" />
                </div>
                <div>
                  <p className="font-medium">Location Detected</p>
                  <p className="text-sm text-muted-foreground">
                    {detectedLocation.city}, {detectedLocation.state}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <p className="text-sm text-muted-foreground text-center">
            You can configure which alerts trigger backups in Settings.
          </p>
        </div>
      )}

      <Button
        variant={detectedLocation ? 'default' : 'outline'}
        onClick={handleNext}
        className="w-full rounded-xl"
      >
        {detectedLocation ? 'Continue' : 'Skip for now'}
      </Button>
    </div>
  )

  const BackupStep = () => (
    <div className="space-y-6">
      <StepHeader
        icon={FolderPlus}
        title="Create your first backup"
        description="Select folders to protect with automatic backups"
      />

      <div className="space-y-3">
        {presets.map((preset) => (
          <Card
            key={preset.id}
            className={`cursor-pointer transition-all rounded-2xl ${selectedPresets.includes(preset.id)
              ? 'border-primary bg-primary/5'
              : 'hover:border-muted-foreground/60'
              }`}
            onClick={() => {
              setSelectedPresets(prev =>
                prev.includes(preset.id)
                  ? prev.filter(p => p !== preset.id)
                  : [...prev, preset.id]
              )
            }}
          >
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selectedPresets.includes(preset.id)}
                  onCheckedChange={() => {
                    setSelectedPresets(prev =>
                      prev.includes(preset.id)
                        ? prev.filter(p => p !== preset.id)
                        : [...prev, preset.id]
                    )
                  }}
                />
                <div className="flex-1">
                  <p className="font-medium">{preset.name}</p>
                  <p className="text-sm text-muted-foreground">{preset.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Button
        onClick={handleCreateBackupSets}
        disabled={isLoading}
        className="w-full rounded-xl"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        {selectedPresets.length > 0
          ? `Create ${selectedPresets.length} Backup Set${selectedPresets.length > 1 ? 's' : ''}`
          : 'Skip for now'
        }
      </Button>
    </div>
  )

  const CompleteStep = () => (
    <div className="text-center space-y-6">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', duration: 0.6 }}
        className="mx-auto w-24 h-24 rounded-3xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
      >
        <Sparkles className="w-12 h-12 text-green-600" />
      </motion.div>
      <div className="space-y-2">
        <h2 className="text-3xl font-bold">You're All Set!</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Sentry is now ready to protect your data. Your backups will run automatically
          based on your schedule and weather conditions.
        </p>
      </div>
      <Button
        size="lg"
        onClick={handleComplete}
        disabled={isLoading}
        className="rounded-xl"
      >
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        Start Using Sentry
      </Button>
    </div>
  )

  const renderStepContent = () => {
    const step = steps[currentStep]
    switch (step.id) {
      case 'welcome':
        return <WelcomeStep />
      case 'setup-mode':
        return <SetupModeStep />
      case 'google':
        return <GoogleStep />
      case 'location':
        return <LocationStep />
      case 'backup-set':
        return <BackupStep />
      case 'complete':
        return <CompleteStep />
      default:
        return null
    }
  }

  return (
    <div className="h-full bg-background flex items-center justify-center p-6">
      <Card className="w-full max-w-xl overflow-hidden rounded-3xl shadow-lg">
        <CardHeader>
          {/* Progress indicators */}
          <div className="flex items-center justify-center gap-2 mb-4">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all ${index === currentStep
                  ? 'w-8 bg-primary'
                  : index < currentStep
                    ? 'w-2 bg-primary/70'
                    : 'w-2 bg-muted'
                  }`}
              />
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              variants={fadeVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.2 }}
            >
              {renderStepContent()}
            </motion.div>
          </AnimatePresence>

          {/* Navigation buttons for middle steps */}
          {currentStep > 0 && currentStep < steps.length - 1 && (
            <div className="flex justify-between mt-6 pt-6 border-t">
              <Button variant="ghost" onClick={handlePrev}>
                <ChevronLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
