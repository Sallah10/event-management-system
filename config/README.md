# CONFIG

Two kinds of file live here, and confusing them is how a repository ends up
needing a code change to run somebody else's event.

## Change per deployment (`.env`, no code change)

| File | What it holds | Env vars |
| --- | --- | --- |
| `branding.ts` | Event name, organisation, date, venue, contact address, portal URL, social links, and the palette used by the email and QR code | `EVENT_NAME`, `EVENT_SHORT_NAME`, `EVENT_ORGANISATION`, `EVENT_TAGLINE`, `EVENT_DATE`, `EVENT_VENUE`, `EVENT_ADDRESS`, `EVENT_CONTACT_EMAIL`, `NEXT_PUBLIC_APP_URL`, `SOCIAL_*`, `BRAND_*` |
| `rules.ts` | The rules of the round: seats, courses, pass mark, section lengths, and the status list | `SCHOLARSHIP_SLOTS`, `PASS_MARK_PERCENT`, `OBJECTIVE_*`, `THEORY_*` |
| `course-matrix.ts` | Which courses are on offer, and their downstream LMS ids | none — it is content, see below |

## Content: replace it, keep the file name

These are the *content* of a particular round. They are meant to differ between
events, exactly as the course list does. What they must not do is name the client
they were written for: this repository is published, and the paper describes the
assessment rather than the organisation running it.

### `questions.json` — the objective paper (public)

Shipped to the browser, so it must never contain a `correct` field. Wording refers
to "the assessment day" and "this programme" rather than a named event, which keeps
the bank reusable across rounds without editing the questions themselves.

### `answer-key.json` — the same paper's answers (server only)

Read only by `lib/answer-key.ts`, which is `import "server-only"`. Never import
it from a client component. It shipped to the browser once, which meant every
correct answer for the section that decides who reaches the theory paper was
readable in DevTools.

### Replacing the paper for a new round

Three files have to move together, and the coupling is enforced at import time by
`lib/answer-key.ts`, which throws if the counts disagree:

1. `questions.json` — the questions and options, ids `q1` … `qN`.
2. `answer-key.json` — `{ "q1": "B", … }`, exactly the same ids, no more, no fewer.
3. `rules.ts` — `TOTAL_QUESTIONS` and `PASS_MARK_PERCENT` for the new paper.

The key is **positional**: `q1: "B"` means option B of question one is correct, not
that question one has the answer "B" as text. Rewording a question is therefore
safe, but reordering its options silently re-keys the paper.

A mismatch is a build-time error, not a runtime surprise: candidates are never
marked against a different number of questions than the ones they were shown.
