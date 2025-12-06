import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value = 0, ...props }, ref) => {
  const numericValue = typeof value === "number" ? value : 0
  const clamped = Math.min(Math.max(numericValue, 0), 100)

  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-3 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
      {...props}
    >
      <motion.div
        className="absolute inset-0 rounded-full bg-primary"
        initial={{ width: `${clamped}%` }}
        animate={{ width: `${clamped}%` }}
        transition={{ type: "spring", stiffness: 160, damping: 25, mass: 0.6 }}
      />
    </ProgressPrimitive.Root>
  )
})
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
