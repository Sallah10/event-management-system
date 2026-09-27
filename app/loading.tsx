import { BRAND } from "@/config/branding";
import { Spinner } from "@/components/ui/display";

/**
 * The pending state for every route that takes more than a moment.
 *
 * There was no `loading.tsx` in the product, so a slow dashboard showed a blank
 * white screen until the data arrived, and three different hand-rolled spinners
 * lived in three different components. This is one, it announces itself, and it
 * holds its height so the layout does not jump when the content replaces it.
 */
export default function Loading() {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col justify-center bg-paper px-5 py-20 sm:px-8"
    >
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        <p className="rule eyebrow">{BRAND.shortName}</p>
        <Spinner className="text-ink-soft" label={`Loading ${BRAND.shortName}`} />
        <p className="text-small text-ink-soft">Loading…</p>
      </div>
    </main>
  );
}
