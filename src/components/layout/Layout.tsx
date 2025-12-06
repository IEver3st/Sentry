import { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { 
  LayoutDashboard, 
  FolderArchive, 
  Calendar, 
  Cloud, 
  Settings,
  Menu,
  Shield,
  ChevronLeft
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useUIStore } from '@/lib/store'
import { cn } from '@/lib/utils'

type View = 'dashboard' | 'backup-sets' | 'schedules' | 'cloud' | 'settings'

export interface LayoutProps {
  children: ReactNode
  currentView: View
  onViewChange: (view: View) => void
}

const navItems = [
  { id: 'dashboard' as View, label: 'Dashboard', icon: LayoutDashboard },
  { id: 'backup-sets' as View, label: 'Backup Sets', icon: FolderArchive },
  { id: 'schedules' as View, label: 'Schedules', icon: Calendar },
  { id: 'cloud' as View, label: 'Cloud Storage', icon: Cloud },
  { id: 'settings' as View, label: 'Settings', icon: Settings },
]

export function Layout({ children, currentView, onViewChange }: LayoutProps) {
  const { sidebarOpen, setSidebarOpen } = useUIStore()

  return (
    <TooltipProvider>
      <div className="flex h-screen bg-background">
        {/* Sidebar */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarOpen ? 240 : 70 }}
          transition={{ duration: 0.2 }}
          className="relative flex flex-col border-r bg-card"
        >
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 py-5">
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <motion.span
              initial={false}
              animate={{ opacity: sidebarOpen ? 1 : 0 }}
              className="font-bold text-xl"
            >
              Sentry
            </motion.span>
          </div>

          <Separator />

          {/* Navigation */}
          <ScrollArea className="flex-1 py-4">
            <nav className="space-y-1 px-3">
              {navItems.map((item) => {
                const isActive = currentView === item.id
                const Icon = item.icon

                return (
                  <Tooltip key={item.id} delayDuration={0}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => onViewChange(item.id)}
                        className={cn(
                          "flex items-center gap-3 w-full px-3 py-2.5 rounded-lg transition-colors",
                          isActive 
                            ? "bg-primary text-primary-foreground" 
                            : "hover:bg-muted text-muted-foreground hover:text-foreground"
                        )}
                      >
                        <Icon className="w-5 h-5 flex-shrink-0" />
                        <motion.span
                          initial={false}
                          animate={{ 
                            opacity: sidebarOpen ? 1 : 0,
                            display: sidebarOpen ? 'block' : 'none'
                          }}
                          className="text-sm font-medium whitespace-nowrap overflow-hidden"
                        >
                          {item.label}
                        </motion.span>
                      </button>
                    </TooltipTrigger>
                    {!sidebarOpen && (
                      <TooltipContent side="right">
                        {item.label}
                      </TooltipContent>
                    )}
                  </Tooltip>
                )
              })}
            </nav>
          </ScrollArea>

          {/* Toggle button */}
          <div className="p-3 border-t">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="w-full justify-center"
            >
              {sidebarOpen ? (
                <ChevronLeft className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </Button>
          </div>
        </motion.aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto">
          <div className="p-6">
            {children}
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}
