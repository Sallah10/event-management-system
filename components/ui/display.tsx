import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

/* ─── TABS ────────────────────────────────────────────────────────────────────
   A plain controlled component rather than a Radix Tabs root. Two reasons: the
   queues it appears in have no arrow-key behaviour worth the extra DOM, and
   the underline indicator is the only visual that survived the redesign — a
   pill background made the tab row look like a segmented control, which it is
   not. It still obeys the tab pattern: roving `aria-selected`, `role="tablist"`,
   and arrow-key navigation. */
function Tabs({
  className,
  ...props
}: React.ComponentProps<"div"> & {
  value: string
  onValueChange: (value: string) => void
  items: readonly { value: string; label: React.ReactNode; count?: number }[]
  "aria-label": string
}) {
  const { value, onValueChange, items, ...rest } = props

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0
    if (delta === 0) return
    event.preventDefault()
    const index = items.findIndex((item) => item.value === value)
    const next = items[(index + delta + items.length) % items.length]
    if (next) onValueChange(next.value)
  }

  return (
    <div
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn("flex gap-1 overflow-x-auto border-b border-line", className)}
      {...rest}
    >
      {items.map((item) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onValueChange(item.value)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-small font-medium transition-colors duration-[var(--duration-quick)]",
              selected
                ? "border-ink text-ink"
                : "border-transparent text-ink-soft hover:border-line-strong hover:text-ink"
            )}
          >
            {item.label}
            {typeof item.count === "number" ? (
              <span
                data-numeric
                className={cn(
                  "rounded-pill px-1.5 py-0.5 text-micro font-semibold",
                  selected ? "bg-ink text-paper" : "bg-paper-sunk text-ink-soft"
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* ─── TABLE ──────────────────────────────────────────────────────────────────
   Four hand-rolled tables in the product, none of which agreed on row height,
   alignment or how a numeric column should line up. This is the one version. */
function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        data-slot="table"
        className={cn("w-full border-collapse text-left text-small", className)}
        {...props}
      />
    </div>
  )
}

function THead({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead className={cn("border-b border-line", className)} {...props} />
}

function TH({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "px-3 py-2.5 text-eyebrow font-semibold whitespace-nowrap text-ink-faint",
        className
      )}
      {...props}
    />
  )
}

function TBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TR({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-line/70 transition-colors duration-[var(--duration-instant)] hover:bg-paper-sunk/60",
        className
      )}
      {...props}
    />
  )
}

function TD({ className, ...props }: React.ComponentProps<"td">) {
  return <td className={cn("px-3 py-3 align-middle", className)} {...props} />
}

/* ─── ALERT ──────────────────────────────────────────────────────────────────
   Seven hand-rolled banners, one of which used `text-orange-500` on white —
   about 2.9:1, which fails AA for body text. Every banner now leads with an
   icon as well as a colour, so the meaning survives a monochrome printout and
   a screen reader. */
const alertVariants = cva("flex gap-3 rounded-lg border p-4 text-small", {
  variants: {
    tone: {
      info: "border-line bg-paper-sunk text-ink",
      positive: "border-positive/30 bg-positive/8 text-ink",
      caution: "border-caution/35 bg-caution/10 text-ink",
      critical: "border-critical/35 bg-critical-wash text-ink",
    },
  },
  defaultVariants: { tone: "info" },
})

const ALERT_ICON = {
  info: "text-ink-soft",
  positive: "text-positive",
  caution: "text-caution",
  critical: "text-critical",
} as const

function Alert({
  className,
  tone = "info",
  icon: Icon,
  title,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & {
    icon?: React.ComponentType<{ className?: string }>
    title?: React.ReactNode
  }) {
  return (
    <div
      data-slot="alert"
      data-tone={tone}
      role={tone === "critical" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      {Icon ? <Icon className={cn("mt-px size-4 shrink-0", ALERT_ICON[tone!])} /> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-1", "text-ink-soft")}>{children}</div> : null}
      </div>
    </div>
  )
}

/* ─── STAT ───────────────────────────────────────────────────────────────────
   A number with a label. The counters update live during check-in, so the
   digits are tabular and the label sits under the figure rather than beside it
   — beside it, the value jumps as it grows. */
function Stat({
  className,
  label,
  value,
  hint,
  tone,
  ...props
}: React.ComponentProps<"div"> & {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  tone?: "default" | "positive" | "caution" | "critical"
}) {
  const toneClass = {
    default: "text-ink",
    positive: "text-positive",
    caution: "text-caution",
    critical: "text-critical",
  }[tone ?? "default"]

  return (
    <div data-slot="stat" className={cn("flex flex-col gap-0.5", className)} {...props}>
      <p
        data-numeric
        className={cn("font-display text-h2 leading-none tabular-nums", toneClass)}
      >
        {value}
      </p>
      <p className="text-small text-ink-soft">{label}</p>
      {hint ? <p className="text-micro text-ink-faint">{hint}</p> : null}
    </div>
  )
}

/* ─── SPINNER ────────────────────────────────────────────────────────────────
   The three loading states in the product were a bare `animate-spin` SVG with
   `aria-label="Loading"` on the `<svg>` element — which is not a labellable
   role, so screen readers announced nothing. This announces properly and holds
   its box so the layout does not jump when it resolves. */
function Spinner({
  className,
  label = "Loading",
  ...props
}: React.ComponentProps<"span"> & { label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2", className)} {...props}>
      <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
      <span className="sr-only">{label}</span>
    </span>
  )
}

/* ─── EMPTY STATE ────────────────────────────────────────────────────────────
   Every empty list in this product previously rendered a blank panel. A named
 * empty state tells the person whether they are looking at a broken query or
   genuinely nothing yet. */
function EmptyState({
  className,
  icon: Icon,
  title,
  children,
  action,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "flex flex-col items-center gap-2 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center",
        className
      )}
      {...props}
    >
      {Icon ? <Icon className="size-5 text-ink-faint" /> : null}
      <p className="text-body font-medium text-ink">{title}</p>
      {children ? <div className="measure text-small text-ink-soft">{children}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export {
  Alert,
  EmptyState,
  Spinner,
  Stat,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Tabs,
  alertVariants,
}
