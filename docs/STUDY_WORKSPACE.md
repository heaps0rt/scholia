# Study workspace

Keep readings, course materials, and tutor conversations together. The Mac app
and its local website share a library. Hosted accounts keep a separate library
on their server.

## Start reading

1. Create a workspace or connect Canvas.
2. Import a PDF, image, notebook, Office document, or readable text/code file.
3. Open it and ask in the tutor pane. Select a passage or capture a PDF figure
   to attach it to a question.
4. Choose **Explain**, **Guide me**, or **Practice**. Source buttons beneath an
   answer return to the cited page or section.

A selected passage can be sent without an extra comment. **Open in chat** moves
it into the sidebar while keeping your draft. Background downloads do not block
these controls.

**Continue reading** restores the page and conversation. Downloading a file does
not mark it as read. On Mac, Back/Forward (Command-[ / Command-]) preserves drafts
as you move between readings. **Dashboard** returns to the library.

Drag the reader/tutor divider to resize the panes. On the website, arrow keys
adjust a focused divider and double-click restores the usual width. On Mac, you
can also resize or hide the left course library; its width is remembered.

## Course conversations and materials

**Ask about this course** opens a conversation without selecting a document.
It uses saved course details, material titles, assignment status, and relevant
excerpts from downloaded readings. **Whole course** identifies this scope.
Reading, assignment, and course conversations keep separate drafts. Unopened
files contribute metadata only; incomplete catalogs and missing text are noted.

For supported models, the reasoning selector beside the model applies to later
questions. It is available in native, local-web, and hosted chats.

**Organized** follows Canvas modules, page sections, and folders. Files linked
from a teaching page stay with that page. **All files** shows original filenames
in a flat searchable list. The choice is saved per workspace. Where Canvas
provides no grouping, document headings, sampled text, and metadata help organize
saved files. Ambiguous files stay under **Documents**. Classification is local
and cached with the file.

Saved Canvas HTML keeps its structure and hyperlinks. **Original page** and
**Reading view** offer two views. Known course links open saved documents in
Scholia, downloading them if needed; **Open source** opens Canvas. Scripts and
active embedded content do not run. Old imports can recover known file links
and refresh their HTML on opening, while preserving local edits.

Use **Search files** or Command-K / Ctrl-K to search names and passages in one
workspace or across the library. Search uses downloaded text without a model
call. See [Search](SEARCH.md) for query syntax and limits.

## Assignments and feedback

**Assignments** opens a page across all workspaces. **All assignments** includes
upcoming and overdue work, submitted work awaiting a grade, graded work, excused
items, and hidden assignments. Courses have their own lists too. **Due & overdue**,
**Handed in**, **Graded**, **Archive**, and **Hidden** provide narrower views.

Badges distinguish **Handed in · awaiting grade**, **Graded**, **Not handed in**,
**Excused**, and **Status not synced**. Missing submission data does not establish
that work is outstanding. While the workspace is open, status and posted grades
refresh about every two minutes; **Refresh status** checks immediately. Failed
checks retain the last successful result and retry later. These checks do not
download the course library.

Grades may be points, percentages, letters, or complete/incomplete. Unpublished
grades are hidden. An earlier attempt's grade does not mark a new submission as
graded. **Feedback available** identifies posted reviewer comments, attachments,
media, or rubric assessments for the current attempt. Your own comments and
older-attempt feedback do not trigger it.

The assignment's **Feedback** section shows comments, authors, dates, and rubrics.
Open attachments in the document reader. Saved feedback and opened files remain
available offline on Mac. Older comments are labelled by attempt. Media links
open in Canvas. Failed refreshes retain saved feedback; a successful empty
response removes feedback Canvas has deleted.

On Mac, the **Status** menu can mark local progress as handed in, graded, or graded
with feedback. These choices survive refreshes and never change Canvas. **Use
Canvas status** clears the local correction.

Opening an assignment shows its instructions and first linked PDF. **Included
files** lists other linked documents; switch files while keeping the assignment
open. On Mac, **Focus PDF + chat** gives the reader more room and **Assignment
overview** restores instructions and the library. Both keep your page, chat,
and draft. The website remembers whether each assignment's file list is collapsed.

Linked files are prepared for the tutor with a separate context budget, even
when **Include relevant course materials** is off. Automatic preparation covers
up to 50 files, 20 MB each and 50 MB total. Labels distinguish ready text from
pending or unreadable files. Open larger supported files individually; unsupported
binary originals remain available without being treated as readable context.

**Hide** removes an assignment from ordinary lists, not from Canvas. **All
assignments** and **Hidden** retain it; choose **Unhide** to restore it. Use the
Canvas link to submit work.

## Exam planner

Open **Exam dates** on Mac or the website. The extension's **Exam planner** opens
the study website configured in its settings. Start the Mac's **Open in Browser**
first when using the local website.

**Manage dates** lets you add dates manually, paste exam rows, or import a text,
CSV/TSV, or ICS file on the website. Review course, component, date, and time
fields before **Save plan**. Dates that have not been announced can stay incomplete.
Saving checks for changes from another window; reload before retrying a conflict.

### Studentweb import

On Mac, **Sign in to Studentweb** opens a temporary WebKit window. Sign in yourself
and stay on the opening page. Scholia reads visible rows in **Kommende hendelser /
Upcoming events**. It does not open active-course pages, expand hidden details,
or submit registration forms. The local website can open this Mac importer;
reload the saved plan afterward. Hosted accounts use paste/file import.

Each visible row remains a separate exam component, including release times,
hand-in deadlines, and periods. **Review exams** shows the imported row count and
lets you correct fields. A direct refresh replaces earlier Studentweb entries
in the preview, retaining manual entries and choices for matching exams. Dates
missing from the opening page do not carry forward. Save to apply the refresh.
Paste/file imports instead retain existing selections and skip identical dates.

The importer requires the upcoming-events table and a year in the relevant date
or assessment field. It skips hidden content, registration deadlines, result
dates, and unrelated text. It does not guess missing dates or durations. Only
course and exam fields reach the planner, not names, student numbers, grades,
or raw page content. Closing the window discards its temporary website data.
If Studentweb markup changes, use paste import and review it manually.

### Choose exams

**Course selection** includes selected and set-aside courses. Expand a course to
choose individual components. **Select all**, **Clear selection**, and individual
changes support **Undo last change**. Date cards compare overlapping exams and
show what a **Keep [course]** choice would set aside.

Only selected exams are checked. Known overlapping intervals are collisions;
incomplete times on overlapping dates are possible collisions. Back-to-back
intervals do not overlap. Times use **Europe/Oslo**. Overnight and multi-day exams
need an end date.

Use **Mark timing flexible** when you can arrange a time with the professor.
The original date stays visible but stops participating in overlap checks. Oral
exams default to flexible; **Use fixed timing** restores checking and survives
matching imports. A flexible label is a reminder to make the arrangement.
Selected courses with complete or flexible timing and no fixed overlap are
automatically favorited; favorites you set manually are preserved.

**Recommend exams** sends your interests, background, requirements, workload,
and reviewed schedule to your selected model. The app checks suggestions against
known courses and timing, keeping all components of chosen courses. It cannot
invent dates or add courses. Review the explanation, then choose **Use this
selection**; undo restores the previous plan. Editing the plan or request
invalidates an older suggestion.

Scholia does not register for or withdraw from exams. Verify dates and practical
requirements in Studentweb or the official course page.

## Canvas and course updates

On Mac, **Sign in** and **Reconnect Canvas** first check saved credentials.
A WebKit sheet opens only when a new login is needed. Canvas-host cookies are
stored in device-only Keychain; SSO cookies are excluded. **Disconnect** clears
the archived session and Canvas cookies. You can also use a personal access
token. Hosted accounts use a token and the operator's allowed Canvas hosts.

Background checks do not prompt for Keychain access. If macOS requires approval,
choose **Allow Keychain access** while continuing to use cached work. Locally
signed builds may need approval again after an update; see
[signing and permissions](../apps/macos/README.md#signing-and-permissions).

**Index all courses** builds the catalog without downloading every file. Canvas
stars become favorites until you make a local choice. Scholia never changes
Canvas favorites or course content.

| Action                             | Result                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Open a material                    | Download that item if needed                                                         |
| Download all / Download everything | Save supported course materials or the full catalog                                  |
| Update content                     | Refresh the catalog and fetch new or changed files, pages, assignments, and syllabus |
| Check for changes                  | Refresh metadata, keeping existing downloads and local edits                         |
| Check for new files                | Discover and queue only file IDs absent from the saved baseline                      |

Linked files are discovered through pages, assignments, modules, and preview
frames, including courses whose Files tab is disabled. Repeated links share one
saved file. Partial or failed catalogs preserve earlier saved material.

On Mac, **Automatically update course content** is initially off. When enabled,
it checks current-semester courses, favorites, and the open course every five
minutes while the native or local-web workspace is open. Assignment status has
its own two-minute schedule.

NTNU MA/TMA courses also check the math wiki for their saved semester. Confirmed
course websites found in announcements, syllabi, pages, or modules can join the
library. Crawls stay within the teaching site or explicitly linked files; public
requests receive no Canvas credentials. A missing archive does not silently
switch to a different semester.

**Automatically update math wiki** is on by default and checks eligible courses
about every two minutes, independently of Canvas credentials. Unchanged pages
and files are reused. Repeated failures back off up to an hour. Missing or
incomplete sites keep saved material and report a warning.

Local publishing-pattern estimates can add a limited number of checks during
likely update times. They use observed changes, not an AI service. Extra checks
are limited to one per hour and two per course/source in 24 hours, with eight
across the workspace. Each source's automatic-update switch controls these too.

### Downloads and recovery

The first file check establishes a baseline without downloading history.
**Check for new files** queues later discoveries, keeping failed or interrupted
items across restarts. It skips already-saved files and local edits; use a full
update for changed versions. Opening a queued file removes it from the queue.

On Mac, bulk downloads default to **Background**. **Prioritize downloads** allows
up to six parallel transfers and pauses preloading. **Done** closes the window
while downloads continue. **Stop** retains completed material and a checkpoint;
**Resume downloads** continues for the same Canvas account after a restart.

Downloaded originals and indexes are validated before replacement. Earlier
originals stay in Revisions. **Verify saved files** checks on-disk integrity and
shows course counts, sizes, and files needing repair. Old files without hashes
remain unchecked until a fresh download establishes one.

Optional **Preload frequent courses** starts after three visits and three idle
seconds, fetching at most three files, 10 MB each and 20 MB total. It pauses for
active work, Low Power Mode, or thermal pressure. Disable it in the workspace
menu. The PDF reader's **Download** button saves a copy of the original PDF.

## Readers, OCR, and editing

PDF readers offer selections, search, bookmarks, page entry, layouts, zoom,
figure capture, printing, and downloads. Native Vision OCR checks scanned or
mixed pages, including stale invisible text layers, without changing the PDF.
Reliable recognition can replace an obsolete text layer in the index. Older
indexes refresh on opening or practice preparation, with resumable progress.
Hosted OCR uses Tesseract when installed; the Docker image includes it.

OCR can misread handwriting and math. Incomplete coverage is reported and
originals remain available. Recognized text feeds search, classification, tutor
context, and practice. Classification does not contact an AI provider.

Notebooks retain Markdown, code, and saved outputs. Office readers extract
paragraphs, slide text, tables, and cached values. Mac **Original layout** uses
Quick Look. Notebook cells, macros, and formulas are never executed. Section
numbers need not match printed page numbers.

**Edit** supports text, code, and notebooks. Saving checks the original revision,
retains earlier versions, and rebuilds the index. It changes Scholia's copy, not
the source file or Canvas. Canvas updates preserve locally edited copies.

Each tutor turn has a limited source snapshot. Inspect its source list to see
which pages or passages were included. Images need an image-capable model;
opening a document does not send every figure automatically.

## Practice, storage, and the local website

**Practice this**, **Practice course**, and **Review due** work in the Mac app,
its local website, and hosted accounts. See [Practice and review](PRACTICE.md).
Native files and learning data live under
`~/Library/Application Support/Scholia/Study`; hosted data lives on the server.
Removing a native workspace retains imported files for recovery. See
[Privacy](PRIVACY.md) for retention details.

**Open in Browser** (Command-2) starts the Mac's website at
`http://127.0.0.1:8792`. Keep the app running. It shares native navigation, files,
conversations, and provider settings. For a website independent of the Mac,
follow [Hosting](HOSTING.md).

For tests and smoke checks, see [Contributing](../CONTRIBUTING.md).
