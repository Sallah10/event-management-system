import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Status chip. A full pill is correct here and only here - this is the one
 * element in the system that is genuinely a pill, and reserving the shape for
 * it is what lets everything else keep tight corners.
 *
 * Tones are paired with a border, never colour alone, so a status is still
 * legible in a monochrome screenshot and to someone who cannot separate the
 * hues.
 */
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-micro font-semibold [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-ink text-paper [a&]:hover:bg-ink-soft",
        secondary: "border-line bg-paper-sunk text-ink-soft",
        accent: "border-amber/50 bg-amber-wash text-amber-deep",
        positive: "border-positive/30 bg-positive/10 text-positive",
        caution: "border-caution/40 bg-caution/12 text-caution",
        destructive: "border-transparent bg-critical text-white",
        outline: "border-line-strong text-ink [a&]:hover:bg-paper-sunk",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
