# Practice and review

Structured practice runs in the Mac app and its local website. The independent
hosted service offers conversational **Practice** tutoring but does not use the
native session store or spaced review queue.

## Start a session

Choose **Practice this** for a selected passage, the current page or section,
or a topic from downloaded course materials. A selected figure stays with its
source. The Practice starter opens the same setup without replacing your chat
draft.

Sessions default to three questions and accept one to five. Your selected
provider generates them on request. Generation can be cancelled; changing the
reading cancels generation for the previous source.

Recall practice keeps the source collapsed. Open-book practice records when you
consult it. Questions that need a figure retain it. Hints reveal a concept, a
method, then a partial step. **Show solution / worked example** is available
before answering. **Explain in tutor** opens a conversation at the source while
keeping the session. There is no timer.

## Answers and feedback

**Save answer & get feedback** saves your original answer and optional confidence
before requesting feedback. Feedback identifies correct reasoning, the first
substantial error or missing justification, and a next step. It can mark an
answer correct, partial, incorrect, or uncertain.

**Try again** appends a revision and keeps the first attempt. **This feedback
seems wrong** records a concern and leaves the judgment unresolved. You can
self-check after revealing the solution or retry feedback later, including
after finishing the session.

Each question keeps its document, page/section, source hash, and Canvas version.
**Open saved source** shows the historical excerpt; **Go to source page** opens
the current reading and records source access. An edit, Canvas update, or removal
can mark an old question as needing revalidation. A new session creates new
questions rather than changing the old criteria.

Generated questions and feedback are not independently verified. Check source
support and solvability, especially for ambiguous answers, noisy OCR, missing
figures, or mathematical equivalence. The app does not provide symbolic grading
or proof that a generated rubric is correct.

## Review schedule

Save questions during practice or in the recap. **Review due** includes saved
questions and recent sessions. The default limit is ten completed reviews per
local day, adjustable from 1–30. Snooze delays a question by one day. Removing a
question from the queue keeps its attempts.

Scheduler version 1 uses these rules:

| Result                                                         | Next interval                                      |
| -------------------------------------------------------------- | -------------------------------------------------- |
| Newly saved question                                           | One day                                            |
| Correct first attempt, without help or revision                | Double the previous interval, limited to 3–30 days |
| Assisted or incomplete review                                  | One day                                            |
| Uncertain/disputed judgment, missing feedback, or stale source | Keep the existing interval                         |

Hints, source access, revealing the solution, and revisions count as assistance.
Confidence and self-assessment alone do not establish independent recall. Each
finish event updates the schedule once; retries and delayed feedback do not
advance it again. These are product defaults, not a claim about learning outcomes.

## Saving and recovery

Practice events live in `Study/Learning/events.sqlite`, separate from the library
and chat history. SQLite transactions check session versions and stable event
IDs so retries cannot duplicate attempts or overwrite a stale session.
Native and local-web views use the same session and question IDs.

Saved questions, hints, solutions, attempts, and scheduling work without a
provider. New questions and automatic feedback need one. A failed request leaves
your answer saved for later feedback or self-check.

The local website needs the Mac app running. Browser drafts are kept per tab
across reloads; submissions use a local outbox. Conflicting answers remain in a
recovery list for copying. Native drafts are scoped to the library, session,
and question. Switching provider or model does not reset a session.

Solutions and rubrics are omitted from the initial browser response and hidden
in native views until revealed. This does not guarantee that generated hints
cannot give away an answer.

## Development checks

```sh
npm run smoke:macos:workspace -- --learning-only
npm run smoke:macos:workspace -- --data-only
npm run smoke:macos:workspace
```

Fixtures cover attempts, revisions, hints, disputes, source changes, restart,
concurrent writers, scheduling, and delayed feedback. The full smoke also checks
the local website in Chromium. These tests use deterministic providers; live
model quality still needs separate evaluation. See [Contributing](../CONTRIBUTING.md)
for the rest of the checks.
