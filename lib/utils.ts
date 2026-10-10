import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The palette and the type scale are custom, which means tailwind-merge does not
 * know them, which means it guesses - and it guessed wrong.
 *
 * `text-` means two different things: a size (`text-small`) and a colour
 * (`text-paper`). tailwind-merge ships knowing the default scale (`text-sm`,
 * `text-lg`) and the default palette, so for anything it does not recognise it
 * assumes "colour" and treats every unknown `text-*` as competing for the same
 * property. The button builds its classes as
 *
 *     base      text-small
 *     variant   bg-ink text-paper
 *     size      … text-body
 *
 * so `text-sm`, `text-paper` and `text-body` were all read as one group and only
 * the last survived. Every button lost its `text-paper` on a `bg-ink` surface:
 * near-black text on a near-black button. The classes were all present in the
 * stylesheet - the merge step was deleting them before they reached the DOM.
 *
 * Registering the two groups explicitly gives tailwind-merge the distinction it
 * cannot infer. Sizes now conflict with sizes, colours with colours, and the two
 * no longer eat each other.
 *
 * Keep this in step with the `--text-*` and `--color-*` names in
 * `app/globals.css`. A token added there and not here reintroduces the bug for
 * that token only, which is the kind of failure that looks like a rendering
 * glitch rather than a missing entry in a config object.
 */

const FONT_SIZES = [
  "micro",
  "eyebrow",
  "small",
  "body",
  "lead",
  "h4",
  "h3",
  "h2",
  "h1",
  "display",
];

const COLORS = [
  "ink",
  "ink-soft",
  "ink-faint",
  "paper",
  "paper-sunk",
  "surface",
  "line",
  "line-strong",
  "amber",
  "amber-deep",
  "amber-wash",
  "positive",
  "caution",
  "critical",
  "critical-wash",
];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
      "text-color": [{ text: COLORS }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
