import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The page frame. Every one of the twenty screens in this product used its own
 * combination of `mx-auto max-w-*` and `px-*`, so the content column was a
 * different width on the dashboard than on the queue and the product read as
 * twenty pages rather than one. This is the single place that is decided.
 *
 * Three widths, named for what they are for rather than how many pixels they
 * are, so a screen picks its measure by content and not by habit.
 */
const WIDTH = {
  /** Forms, confirmations, single-column reading. */
  form: "max-w-lg",
  /** Prose, essays, anything with a measure. */
  prose: "max-w-2xl",
  /** Dashboards, queues, tables. */
  wide: "max-w-6xl",
  /** Nothing scrolls horizontally on a phone. */
  full: "max-w-[80rem]",
} as const

function Page({
  className,
  width = "wide",
  ...props
}: React.ComponentProps<"main"> & { width?: keyof typeof WIDTH }) {
  return (
    <main
      id="main"
      data-slot="page"
      className={cn(
        "mx-auto w-full px-5 py-8 sm:px-8 sm:py-10",
        WIDTH[width],
        className
      )}
      {...props}
    />
  )
}

/**
 * A full-bleed dark panel, used where a screen is the whole viewport. The
 * previous full-height dark surfaces centred a card grid in the middle of the
 * screen with no vertical rhythm; this pins the content to a real baseline
 * instead.
 */
function BleedPage({
  className,
  ...props
}: React.ComponentProps<"main"> & { children: React.ReactNode }) {
  return (
    <main
      id="main"
      data-slot="bleed-page"
      className={cn(
        "flex min-h-dvh w-full flex-col justify-center bg-ink px-5 py-16 text-paper sm:px-8",
        className
      )}
      {...props}
    />
  )
}

/**
 * Page header. `eyebrow` is the small caps line, `title` is the one h1 on the
 * page, `lede` is the optional sentence underneath. Three of the twenty screens
 * previously had no h1 at all, so the heading order started at h2.
 */
function PageHeader({
  className,
  eyebrow,
  title,
  lede,
  actions,
  children,
  ...props
}: React.ComponentProps<"header"> & {
  eyebrow?: React.ReactNode
  title: React.ReactNode
  lede?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-col gap-2">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="font-display text-h1 text-balance text-ink">{title}</h1>
        {lede ? (
          <p className="measure text-lead text-ink-soft text-pretty">{lede}</p>
        ) : null}
        {children}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

/** Vertical rhythm between sections, named so the gap is a decision. */
function Stack({
  className,
  gap = "md",
  ...props
}: React.ComponentProps<"div"> & { gap?: "sm" | "md" | "lg" }) {
  return (
    <div
      className={cn(
        "flex flex-col",
        gap === "sm" && "gap-3",
        gap === "md" && "gap-5",
        gap === "lg" && "gap-8",
        className
      )}
      {...props}
    />
  )
}

export { BleedPage, Page, PageHeader, Stack, WIDTH }
