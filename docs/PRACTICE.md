# Practice and review

This guide applies to the native Mac app and its local website. The independent
hosted service offers conversational Practice tutoring but does not expose this
practice-session store or spaced review queue.

**Practice this** uses the selected passage, the current page/section or a topic from downloaded course materials. A figure attached to the tutor is retained with its source. The Practice composer starter opens the same setup without replacing the chat draft. Sessions default to three questions and accept one to five. Generation uses the selected, configured provider; it happens only on request and can be cancelled. Changing the reading cancels generation for the previous scope.

Recall keeps the source collapsed. Open-book practice records source access. A visual question retains its necessary figure. Three controls progressively expose a conceptual cue, a method cue and a partial step. **Show solution / worked example** is available before an attempt. **Explain in tutor** opens a conversation at the originating source while retaining the practice session. Neither scrolling nor ordinary highlighting triggers a quiz, and there is no timer.

**Save answer & get feedback** commits the original answer and optional confidence before contacting the provider. Feedback reports correct reasoning, the first material error or missing justification, and one next step. Judgments can be correct, partial, incorrect or uncertain. **Try again** preserves the first answer and appends a revision. **This feedback seems wrong** records a concern and marks the judgment unresolved; it is also available in the recap. A self-check after revealing the solution is recorded separately from model feedback. Feedback can be retried after finishing a session.

Questions and feedback identify the supporting document and page/section. **Open saved source** shows the bounded historical excerpt; **Go to source page** opens the current reading and records source access. The source hash and Canvas version remain attached to the original question and rubric. When a local edit, Canvas update or removal changes that identity, the question is marked as needing revalidation. Preparing a new session makes new question IDs; it does not replace historical criteria. Generated content is labeled as not independently verified.

## Review scheduling

Save selected questions during practice or in the recap. **Review due** is next to the reader/dashboard controls and includes recent sessions for resuming practice across native and browser views. The initial workload limit is ten completed reviews per local day, adjustable from 1–30. Snooze moves a question one day from now; saved questions can be removed from the queue without deleting attempts. There are no missed-day penalties.

Scheduler version 1 starts with a one-day delay. A correct first attempt without hints, source access, reveal or revision doubles the previous interval, with a minimum of three and maximum of thirty days. Assisted or incomplete reviews return after one day. Uncertain/disputed judgments, missing feedback and stale sources preserve the interval. Self-assessment alone does not establish independent recall. Confidence does not control the schedule. One finish event updates a review once; repeated requests and delayed feedback do not advance it again. These intervals are initial product parameters, not universal learning prescriptions.

## Persistence and handoff

`Study/Learning/events.sqlite` is separate from `library.json` and chat history. SQLite transactions append uniquely identified events and reject a stale writer. A retried event must carry the same ID and content. Session versions protect concurrent actions; review versions protect snoozes/removals. Source snapshots, question revisions, attempts, feedback, concerns and schedule evidence are local by default. No research telemetry is collected.

Native and local-web views use the same learning-session and question IDs. The browser fetches learning detail separately, while ordinary workspace polling carries only the learning revision and due count. The initial web projection omits the rubric and reference answer; only an explicit reveal includes them. Reference answers are also hidden in native views until that transition. Generated text can still leak an answer indirectly, so model behavior requires evaluation beyond these application checks.

Saved questions, hints, solutions, attempts and scheduling work without internet or a provider. Automatic feedback and new questions require a provider; failure leaves the answer saved for later feedback or self-check. The local website requires the Mac app to remain running. Browser answer drafts are isolated per tab, retained across reload, and submissions have a durable local outbox with stable event IDs. Conflicting offline answers remain available for copying in the recovery list. Native unsent answer drafts are local and scoped to the library/session/question. Provider/model switches do not reset a session.

Chat draft and page commands carry the originating course, document, thread, page and a content revision. Stale writes are rejected before mutating the native workspace. Browser drafts remain available for copying or returning to the original reading. Mutations queued by the same tab follow their own acknowledged revisions; this does not bypass conflicts from other windows.

## Verification and remaining evaluation

Run:

```sh
npm run check
npm run build && npm run check:dist
node scripts/smoke-chromium-history.mjs
zsh scripts/smoke-macos-workspace.sh --learning-only
zsh scripts/smoke-macos-workspace.sh --data-only
zsh scripts/smoke-macos-workspace.sh
```

The native smoke uses an isolated library and deterministic generation/feedback. It checks original/revised answers, confidence and assistance, hidden solutions, disputes, self-checks, source versions, restart, duplicate events, competing writers, scheduler outcomes and offline/late feedback. The full smoke drives Chromium through generation, submission, feedback, reload/resume, hints, revision, reveal, recap, review saving/snooze, and responsive layouts. It also checks the actual API rejects a draft delayed across a second window's navigation. A separate Chromium smoke loads the built extension and checks concurrent writes from two extension pages. Unit tests cover extension history concurrency, failed Canvas refresh retention, changed deadlines and the tutoring contract. No live provider completion or Canvas account is needed for these checks.

Before broad educational use, evaluate actual responses from each offered provider/model with correct, partial, mistaken and ambiguous answers; equivalent mathematics and reasoning; non-English answers; explicit reveal requests; repeated difficulty; noisy OCR; missing pages/images; and indirect answer leakage. Check source support and question solvability manually. The first release provides structured partial/uncertain judgments but does not implement symbolic equivalence, numerical-tolerance grading or semantic proof that a generated rubric is correct. These remain evaluation/validation work. No learning-outcome improvement is claimed without a delayed, unassisted evaluation.

Later backlog items—worked-example fading, misconception notes, transfer activities, concept-progress views and adaptive plans—are not part of this release. Extension structured practice and extension/native handoff also remain separate work; this release aligns the extension's existing guided tutoring contract.
