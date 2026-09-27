import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * One button, six variants, and no transform on hover.
 *
 * The previous version hovered with `hover:scale-[1.02]` and lifted cards with
 * `whileHover={{ y: -8 }}`. On a settings desk used for eight hours that is
 * noise, and applied to a settings screen it is how a product comes to look
 * generated. Feedback is now carried by colour and border weight, which is
 * quieter and survives being looked at for a long time.
 *
 * `outline-none` is deliberately absent: the focus ring is defined once in
 * globals.css against `:focus-visible`, so a button dropped anywhere in the
 * product is keyboard-navigable without this file being involved.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-small font-medium transition-colors duration-[var(--duration-quick)] ease-[var(--ease-out-quint)] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-critical aria-invalid:ring-critical/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Ink on paper. The default, and the one that should win most of the
        // time — a screen with one obvious action beats a screen with three
        // equally loud ones.
        default: "bg-ink text-paper hover:bg-ink-soft",
        // The one reserved action on a screen: submit a paper, confirm an
        // unflag, award a place. Rationed deliberately.
        accent: "bg-amber text-ink hover:bg-amber-deep hover:text-paper",
        outline:
          "border border-line-strong bg-transparent text-ink hover:border-ink hover:bg-paper-sunk",
        secondary: "bg-paper-sunk text-ink hover:bg-line/60",
        ghost: "text-ink-soft hover:bg-paper-sunk hover:text-ink",
        critical: "bg-critical text-white hover:brightness-110",
        "critical-outline":
          "border border-critical/40 text-critical hover:bg-critical-wash",
        link: "text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink",
      },
      size: {
        default: "h-10 px-4 has-[>svg]:px-3.5",
        sm: "h-8 gap-1.5 px-3 text-small has-[>svg]:px-2.5",
        lg: "h-12 px-6 text-body has-[>svg]:px-5",
        icon: "size-10",
        "icon-sm": "size-8",
        "icon-lg": "size-12",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
