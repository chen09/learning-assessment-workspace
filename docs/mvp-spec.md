# Learning Assessment Workspace MVP Specification

## 1. Product outcome

The product helps a family turn learning goals, worksheets, textbook pages, and
course material into structured exercises. A parent confirms every generated
question set before assignment. A child completes the work digitally or on
paper, receives AI-assisted feedback only after the full set is graded, corrects
wrong or uncertain answers, and later receives transparent spaced review.

The first release is a responsive web application and installable PWA. It is not
a native app and does not promise complete offline operation.

## 2. Tenancy, identities, and language

- A family is the top-level tenant.
- A family has up to four equal full-permission parents or guardians.
- A parent may belong to multiple isolated families and explicitly switches the
  current family.
- Parents authenticate with optional email/password, email OTP or magic link,
  Google, or LINE. Matching verified email addresses are one account.
- A LINE account without email must verify an email before family access.
- WeChat Login is not in the MVP.
- A child is a profile, not a standalone authentication account. The profile has
  a nickname, grade or learning stage, preferred UI language, and six-digit PIN.
- Five failed child PIN attempts lock child entry for five minutes.
- Every parent has an independent six-digit management PIN for leaving child
  mode on a shared device.
- Interface language is selected per member from Chinese, Japanese, and English.
  Question content always remains in its original language.
- Existing parents invite another parent by email. Invitations expire after
  seven days and successful acceptance joins the family immediately.

## 3. Question-set creation

The structured `QuestionSet` is the product source of truth. PDFs, images, and
audio are private sources, previews, or printable output.

A parent can:

1. Describe a learning goal and ask AI to generate questions, optionally using
   private source material.
2. Import ordered PDF, PNG, or JPEG pages and either convert existing exercises
   or generate similar exercises from course material.
3. Upload a paper that has already been completed by a child. The system first
   creates a reviewable extraction draft; after a parent confirms question
   boundaries, points, and scoring references, it creates a real `QuestionSet`,
   submitted `Attempt`, and learning record for the selected child.

Imports may contain a complete worksheet, textbook pages, an answer section, or
multiple knowledge points. Irrelevant pages can be excluded. Cross-subject
content becomes separate drafts. Answer pages are private references and are
never shown to a child.

Uploaded textbook pages and their exercises form a reusable private source
bundle. The system preserves their unit, knowledge points, examples, difficulty
progression, file roles, and provenance so the same family can generate
different question sets later without treating the generated worksheet as the
original source. Cross-family sharing copies structured knowledge metadata and
reviewed generated questions by default. Raw source files can be shared only
after an explicit confirmation that the uploader has redistribution rights.

AI drafts question text, type, answer or reference answer, points, rubric,
primary and secondary knowledge tags, and difficulty. Difficulty choices are
reinforcement, standard, challenge, and adaptive mix; difficulty is not measured
only by calculation volume.

Every generated or imported draft enters `needs_review`. A parent can reprocess,
replace, or delete flagged questions and must confirm the final structured set
before assigning or printing it.

Confirmed knowledge blueprints can also generate private variants at
reinforcement, standard, challenge, or explicit competition difficulty. The
system varies conceptual demands, representation, and reasoning steps rather
than merely increasing calculation volume. Generated variants follow the same
parent-review and assignment flow as every other question set.

## 4. Question and response types

Supported response types:

- single-choice and multiple-choice;
- typed fill-in and longer text;
- reorderable word tokens;
- on-screen handwriting;
- one or more ordered photos;
- basic listening with choice or typed response.

Math non-choice questions default to handwriting or photo. English fill-in and
writing accept typing or handwriting. Question figures support zoom. Mathematics
uses typeset textbook-style notation.

Listening audio is either family-uploaded or provider-generated. Practice allows
normal and 0.85x playback. Exam playback is normal speed with a configurable
replay limit. A transcript is hidden, shown only after submission, or always
shown according to the question. Speech recording and pronunciation scoring are
not part of the MVP.

## 5. Child work

Children can use:

- a continuous worksheet layout;
- a focused one-question layout;
- a printed A4 worksheet.

The handwriting canvas provides a black pen, two widths, pressure support where
available, eraser, undo, redo, confirmed clear, a subtle grid or white
background, vertically expanding pages, and an optional new page.

Photos support direct camera or gallery selection, preview, rotation, cropping,
clarity warning, multiple ordered pages, replacement, and deletion before
submission.

Answers save continuously. A short-lived local retry queue protects unsynced
work during a temporary network interruption; it is purged after synchronization,
submission, logout, or expiry. Complete offline work is not guaranteed.

An optional exam mode has a total timer, no pause, configurable listening replay,
answer review, and automatic final submission at timeout. Ordinary work shows
progress without a general timer.

## 6. Printing and paper capture

A confirmed question set can generate a deterministic A4 document:

- English and choice questions have inline answer areas.
- Math calculation and proof questions use numbered grid answer zones.
- Each page includes assignment/page identity, corner registration marks, and a
  versioned answer-zone map.

A child may mix digital and paper answers within one assignment. Whole uploaded
pages retain capture order. The processing worker identifies the page,
perspective-corrects it, and crops answers by the printed zone map. If page
recognition fails, the UI asks for page correction or per-question upload.

Parents may also upload a completed external worksheet without an existing
assignment or printed zone map. The original answer scan is stored privately and
immutably as a response artifact. The worker separates printed material from
student work and proposes question units, answer regions, scores, knowledge
tags, and references. Nothing is graded or added to history until a parent
confirms that draft.

The product never destructively erases handwriting from the original scan. A
clean worksheet is a separately generated, reviewable A4 rendering based on the
confirmed structure. Red-pencil marks are another separate derived overlay that
can be hidden, displayed, or downloaded.

## 7. Submission and grading

- A child may submit the current answered question for asynchronous grading and
  continue the remaining questions. That response becomes immutable and its
  result appears inline when ready.
- A child may submit the full assignment at any time. Unanswered questions are
  recorded as incorrect, and all responses become immutable.
- Corrections and retries are new attempts linked to the original.
- The complete result page appears only after the full-assignment grading job
  ends; a single-question submission does not complete the attempt.
- AI receives opaque identifiers, the relevant question/rubric, answer, and
  media only. It never receives family or child identity.
- For a completed external worksheet, AI returns per-question evidence,
  confidence, feedback in the member's selected language, and normalized red
  annotation coordinates. The server validates the response and computes totals;
  AI does not own the final score calculation.
- A failed job retries a limited number of times, then allows a parent retry.

Per-question outcomes are:

- `correct`;
- `incorrect`;
- `uncertain`;
- `needs_parent_review`.

Unreadable or uncertain work is never automatically wrong. Two unresolved
attempts require parent review. A parent can request redo, award full or partial
credit, or ignore the item, with an optional child-visible comment. The parent's
decision is authoritative for score and learning records.

Correct answers are collapsed on the result page. Wrong and uncertain items lead.
The first incorrect attempt gives a hint without the answer. After a genuine
unsuccessful correction, the product shows key steps or a reference answer and
asks the child to acknowledge understanding. Three consecutive failures create
reinforcement work and a parent attention marker.

## 8. Review and learning rules

Each question has one primary knowledge tag for mastery and optional secondary
tags. Concept or method errors reinforce the skill. Careless errors keep the
same level with accuracy practice. Unreadable answers do not change mastery.

The deterministic initial schedule is same-day correction followed by
1/3/7/14/30-day variant review. An error resets the next interval to one day.
Two independent standard successes allow a challenge item; challenge success
lengthens the interval.

Daily review is limited to ten questions or about fifteen minutes. Missed review
is rescheduled without unlimited accumulation. Parent assignments take priority.
Children see neutral “today’s review” language, may skip for the day, and do not
see that a review exists because of an earlier error.

## 9. Parent experience and history

The parent dashboard leads with child cards and current status. Parents can:

- create, import, review, confirm, assign, print, withdraw unstarted work, and
  explicitly stop started work without deleting saved answers;
- add a short in-app assignment note;
- review full results, uncertain grading, correction progress, and history;
- manage family members, invitations, child profiles, and language;
- submit rights-cleared generated question sets to the public-library queue.

The child home leads with continue/today's work and a complete pending list.
Parent and child history show completed sets, dates, scores, review requirements,
and correction status. Advanced mastery charts are deferred.

## 10. Public question library

Only rights-cleared, structured, AI-generated question sets can be submitted.
Raw PDFs, images, audio, answer scans, child work, and personal data are never
public. Submission requires an explicit rights and privacy confirmation.

Submissions enter an admin review queue. Published items are anonymous and
searchable by metadata. A family copies a published item; it never references a
mutable public original. Admin can unpublish or replace an item. Existing copies
remain unchanged and show a revision notice. Parents can privately report
correctness, suitability, or copyright concerns.

## 11. Retention, deletion, and communication

Data is retained by default. Parent deletion removes live visibility immediately,
allows recovery for thirty days, then purges database records and online media.
A sole parent must transfer control or delete the family before deleting their
account.

External email is restricted to authentication, password reset, invitation, and
security confirmation. The MVP sends no learning reminders, marketing mail, or
browser push notifications.

## 12. Technical and privacy boundaries

- The browser uses only Supabase publishable configuration.
- Business data is family-scoped and protected by RLS plus API authorization.
- Source files, responses, audio, and derived media use separate private buckets.
- Service-role, database, LINE, SMTP, and AI credentials are server-only.
- AI behavior is exposed through typed provider-neutral contracts. CI uses a
  deterministic fixture adapter. The first controlled visual adapter may use a
  private runner's Codex CLI session and receives only an identity-free rendered
  answer image plus the relevant question and rubric.
- The frontend is a static Next.js export on Cloudflare Pages.
- FastAPI and a single-concurrency worker run in Docker behind
  `api.study.hypnochunk.com`.

## 13. Explicitly deferred

- Native mobile applications and complete offline guarantees.
- WeChat Login.
- Speech recording and pronunciation scoring.
- Formal teacher/school roles.
- Complex predictive recommendations and advanced visual analytics.
- A local model stack.
