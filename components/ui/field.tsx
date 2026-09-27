import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * The form primitives, in one file because they are one decision.
 *
 * These existed as 11 hand-rolled `<input>`s, each with its own height, border,
 * padding and focus treatment. Nine of them set `outline-none` and swapped a
 * border colour on focus, which fires on mouse-press, is invisible at 1px, and
 * means a keyboard user cannot see where they are. All of that is now one
 * `fieldBase` string, and the focus ring comes from globals.css.
 *
 * `Field` wraps label + control + hint + error so a control cannot ship
 * without an accessible name: the label is a real `<label htmlFor>`, and when
 * `hint` or `error` are present they are wired up with `aria-describedby`.
 */
const fieldBase =
  "w-full rounded-md border border-line-strong bg-surface text-body text-ink transition-colors duration-[var(--duration-quick)] placeholder:text-ink-faint disabled:cursor-not-allowed disabled:bg-paper-sunk disabled:text-ink-faint aria-invalid:border-critical aria-invalid:bg-critical-wash/40"

function Input({ className, type = "text", ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldBase,
        // 44px minimum touch target; the previous controls were 36px, below
        // the platform minimum on a phone, which matters because check-in runs
        // on phones.
        "h-11 px-3.5 file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        className
      )}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldBase, "min-h-28 resize-y px-3.5 py-3 leading-relaxed", className)}
      {...props}
    />
  )
}

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="select"
      className={cn(
        fieldBase,
        "h-11 cursor-pointer appearance-none bg-[length:1rem] bg-[right_0.75rem_center] bg-no-repeat pr-10",
        // Inline chevron rather than a wrapper element, so the control keeps a
        // single border and a single focus ring.
        "bg-[image:url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%236b6b73%22 stroke-width=%222%22 stroke-linecap=%22round%22%3E%3Cpath d=%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')]",
        className
      )}
      {...props}
    >
      {children}
    </select>
  )
}

function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn("text-small font-medium text-ink select-none", className)}
      {...props}
    />
  )
}

type FieldProps = {
  label: string
  /** Receives the ids to wire onto the control. */
  children: (ids: { id: string; describedBy?: string }) => React.ReactNode
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
}

/**
 * Label, control, hint and error that cannot come apart.
 *
 * The `render prop` shape is deliberate: passing the ids in means the caller
 * physically cannot forget them, which is the only reliable way to stop
 * shipping an input whose only label is a placeholder.
 */
function Field({ label, children, hint, error, className }: FieldProps) {
  const id = React.useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined

  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-slot="field">
      <Label htmlFor={id}>{label}</Label>
      {children({ id, describedBy })}
      {hint ? (
        <p id={hintId} className="text-small text-ink-soft">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-small font-medium text-critical">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export { Field, Input, Label, Select, Textarea, fieldBase }
