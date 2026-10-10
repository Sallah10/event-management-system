"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A select control that looks like this product rather than whichever OS opened
 * the page.
 *
 * The previous control was a native `<select>` with `appearance-none` and an
 * SVG data-URI chevron. The closed control barely passed for styled; the open
 * list was the browser's default menu chrome - no font, no surface token, no
 * idea what brand it belonged to. This is an accessible combobox (Radix) with
 * the theme's surface, border and ink tokens, a lucide chevron, keyboard
 * navigation, and a styled popup that sits above the page (portal) at the
 * trigger's width.
 *
 * It keeps two native behaviours that matter here:
 *   - `name`: serialised into a hidden `<input>`, so server `FormData` works
 *     (the register form reads course/career with `new FormData(form)`).
 *   - `aria-describedby` / `id`: forwards to the trigger, so the Field render
 *     prop still wires label and hint to the control.
 *
 * A `value=""` option is expressed as `placeholder`: "Not sure yet", "Prefer
 * not to say", "Choose one…" show until a real value is picked, and the hidden
 * field submits "" either way, just as the old empty `<option>` did.
 */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  disabled?: boolean;
}

interface SelectProps {
  id?: string;
  name?: string;
  disabled?: boolean;
  className?: string;
  /** Controlled value. */
  value?: string;
  /** Initial value when uncontrolled. */
  defaultValue?: string;
  /** Shown while no value is selected. */
  placeholder?: React.ReactNode;
  onChange?: (value: string) => void;
  "aria-describedby"?: string;
  options: SelectOption[];
}

function Select({
  id,
  name,
  disabled,
  className,
  value,
  defaultValue = "",
  placeholder = "Select an option",
  onChange,
  "aria-describedby": describedBy,
  options,
}: SelectProps) {
  const [internal, setInternal] = React.useState<string | undefined>(defaultValue);
  const isControlled = value !== undefined;
  const selected = isControlled ? (value ?? "") : (internal ?? "");

  const handleValueChange = (next: string) => {
    if (!isControlled) setInternal(next);
    onChange?.(next);
  };

  return (
    <>
      <input
        type="hidden"
        name={name}
        value={selected}
        disabled={disabled}
        aria-hidden="true"
      />
      <SelectPrimitive.Root
        value={isControlled ? value : undefined}
        defaultValue={isControlled ? undefined : defaultValue}
        onValueChange={handleValueChange}
        disabled={disabled}
      >
        <SelectPrimitive.Trigger
          id={id}
          aria-describedby={describedBy}
          data-slot="select"
          className={cn(
            "flex h-11 w-full items-center justify-between gap-2 rounded-md border border-line-strong bg-surface px-3.5 text-body text-ink transition-colors duration-[var(--duration-quick)]",
            "data-[state=open]:border-ink",
            "disabled:cursor-not-allowed disabled:bg-paper-sunk disabled:text-ink-faint",
            className,
          )}
        >
          <SelectPrimitive.Value
            placeholder={placeholder}
            className="truncate text-ink data-[placeholder]:text-ink-faint"
          />
          <SelectPrimitive.Icon className="shrink-0">
            <ChevronDown aria-hidden className="size-4 text-ink-faint" />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal>
          <SelectPrimitive.Content
            position="popper"
            sideOffset={6}
            className="z-50 max-h-[min(60vh,20rem)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-line-strong bg-surface shadow-[0_8px_30px_rgb(0_0_0_/_0.12)]"
          >
            <SelectPrimitive.Viewport className="p-1">
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                  className={cn(
                    "flex w-full cursor-default select-none items-center justify-between gap-3 rounded-sm px-2.5 py-2 text-body text-ink outline-none",
                    "data-[highlighted]:bg-paper-sunk data-[highlighted]:text-ink",
                    "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
                  )}
                >
                  <SelectPrimitive.ItemText className="flex-1 truncate text-left">
                    {option.label}
                  </SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="flex w-4 shrink-0 items-center justify-center">
                    <Check aria-hidden className="size-4 text-amber" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
    </>
  );
}

export { Select };