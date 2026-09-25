import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as Tooltip from '@radix-ui/react-tooltip'
import { MotionConfig } from 'motion/react'
import './styles.css'
import { App } from './App'
import { useApp } from './lib/store'

// The main process passes the saved theme in the URL so the first frame (the boot sequence) is already in the right colors.
const params = new URLSearchParams(location.search)
const theme = params.get('theme')
const accent = params.get('accent')
if (theme && /^[a-z]+$/.test(theme)) document.documentElement.dataset.theme = theme
if (accent && /^[a-z]+$/.test(accent)) document.documentElement.dataset.accent = accent

function Root() {
  const reduce = useApp((s) => s.settings?.reduceMotion ?? false)
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'user'}>
      <Tooltip.Provider>
        <App />
      </Tooltip.Provider>
    </MotionConfig>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)
