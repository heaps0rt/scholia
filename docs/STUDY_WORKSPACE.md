# Study workspace

Keep courses, documents, and tutor conversations in a workspace. Use the Mac
app, its local website, or a separately hosted account. The local website shares the Mac's library; hosted accounts
have their own private libraries.

## Start reading

1. Create a workspace or connect Canvas.
2. Import a PDF, image, notebook, Office document, or readable text/code file.
3. Open a reading and ask in the tutor beside it. Select text to attach a passage,
   or use the viewfinder to ask about a PDF figure. Pasted images can be attached
   to a question too.
4. Choose **Explain**, **Guide me**, or **Practice**. Source buttons beneath an
   answer return to the cited page or section.

**Continue reading** restores the page and conversation for a reading you have
opened. Downloading a file does not mark it as read. In the Mac app, Back and
Forward (Command-[ and Command-]) return through reading destinations while
preserving drafts. **Dashboard** returns to the workspace library.

Drag the divider between the reader and tutor to give either more room. With a
document open, the tutor can occupy almost the entire window; the native reader
then shows an **Expand** control. The website also supports arrow keys on the
focused divider and a double-click to restore the usual chat width.

Course materials default to **Organized**, using Canvas module order and useful
reading groups. Choose **All files** for a flat, searchable list of files with
original filenames. This choice is remembered per workspace. Generated
assignment descriptions and Canvas pages remain in the organized view rather
than appearing as duplicate files.

## Assignments

The dashboard agenda spans workspaces independently of the workspace search and
semester filters. **Due & overdue** shows outstanding work; **Handed in** shows
submitted or graded work. **All assignments**, **Archive**, and **Hidden** keep the other
states accessible. Date headers group assignments with the same local deadline
inside the list. Each course also has its own assignment list.

An assignment's badge distinguishes **Handed in**, **Handed in · graded**,
**Not handed in**, **Excused**, and **Status not synced**. Missing submission data
is not treated as proof that work is outstanding. Refresh Canvas to update the
status; a saved badge reflects the last successful sync.

Clicking an assignment opens its instructions and the first explicitly linked
Canvas PDF in Scholia's reader. **Included files** lists every linked file;
choose one to read it while keeping the assignment open. Readable text and data files can be included alongside PDFs.
Assignments without a linked PDF show their instructions and included files.
Saved instructions and downloaded files remain available locally in the Mac app.
A failed download offers Retry without discarding saved material.

Opening an assignment prepares its linked files for the study companion.
Instructions and readable attachment content receive their own context budget,
even when **Include relevant course materials** is off. File labels distinguish
ready content from files that still need to be opened or have no readable text.
Automatic preparation covers up to 50 files, 20 MB each and 50 MB total; open
larger supported files individually. Unsupported binary files retain their
original for viewing, with no claim that their contents are readable by the tutor.

Choose **Hide** to keep an assignment out of your usual lists. **All assignments**
shows the complete list, including hidden items, in both the sidebar and each
workspace. The **Hidden** filter shows only hidden items. Choose **Unhide** in
either view to show an assignment in your usual lists again. This changes only
your Scholia list; it does not delete the assignment or alter a submission. The
separate Canvas link opens the original assignment when you need to hand in work.

## Canvas and downloads

On the Mac, **Sign in** opens Canvas in a native WebKit sheet. Scholia uses that
session without collecting your institutional password. You can also connect
with a personal access token, stored in Keychain. Hosted web uses a personal
Canvas token saved to your account; its operator chooses the allowed Canvas
hosts. Expired credentials need to be renewed before new material can download.

**Index all courses** lists accessible courses and catalogs their materials
without fetching every file. Favorite workspaces stay at the top. Canvas stars
are imported until you make a local favorite choice; Scholia never changes the
Canvas favorite or course data.

Opening an online material downloads that item. **Download all** fetches a
course's supported materials; **Download everything** covers the catalog. Stop
keeps completed downloads, and repeated downloads reuse unchanged saved items.
**Check for changes** refreshes metadata, preserving conversations and local
edits and flagging new versions. Partial collections retain their older entries
when Canvas cannot be checked.

The Mac can **Preload frequent courses** after three separate visits. Once the
course is idle for three seconds, it fetches at most three eligible files,
10 MB per file and 20 MB total. It pauses for active work, Low Power Mode, or
thermal pressure. Disable the option in the workspace menu or use **Stop**
during preloading. This setting is native; hosted web downloads when requested.

Material access is read-only. API pagination stays on the Canvas origin, and
file redirects lose Canvas tokens and cookies before reaching storage hosts.
Course identity is scoped by Canvas host and account. The tutor can use a file only after its content has been downloaded and indexed.

## Reading and editing

The PDF readers provide selectable text, bookmarks, exact and semantic search,
page entry, continuous/single/spread layouts, zoom, figure capture, and printing.
Native PDF indexing can use local Vision OCR. Hosted PDF indexing extracts
existing text and reports pages that have no readable text; it does not provide
native OCR.

Notebooks retain Markdown, code, and saved outputs in a continuous reader. Text
and code preserve reading sections and indentation. Office readers show extracted
paragraphs, slide text, tables, and cached workbook values. The Mac's
**Original layout** uses Quick Look for formatting the semantic reader cannot
preserve. Notebook cells, macros, and formulas are never executed. Section
references in these formats are not necessarily printed page numbers.

**Edit** is available for supported text, code, and notebooks. Saving rebuilds
the tutor index and checks the original revision to avoid overwriting another
edit. Prior versions are retained for recovery. Editing changes Scholia's copy,
not the original file or Canvas. New Canvas versions preserve a locally edited
copy separately in the native library.

Each tutor turn has a fresh, bounded source snapshot. It includes the current
page or selection and relevant saved material from that workspace. Native
context can include the whole document when it fits, otherwise page references
and locally ranked excerpts. Hosted context is bounded separately. Inspect the
source list to see what supported the answer. A model does not automatically
see every image in a long document; explicit visual questions require a model
that accepts images.

## Practice and storage

The Mac and its local website include **Practice this** and **Review due**:
source-linked questions, attempts, hints, feedback, revisions, and delayed
review. See [Practice and review](PRACTICE.md). Hosted web offers conversational
**Practice** tutoring; it does not include the native practice-session store or
spaced review queue.

Native files, indexes, conversations, and reading positions are stored under
`~/Library/Application Support/Scholia/Study`. Workspace removal removes its
library entry while retaining imported files on disk for recovery. Native edit
drafts and revisions are also local. Hosted data stays on the server's persistent volume. See [Privacy](PRIVACY.md) for retention and operator access.

## Open in Browser

On the Mac, choose **Open in Browser** or press Command-2 to start the local
website at `http://127.0.0.1:8792`. Keep Scholia running. Native and browser views
share the current workspace, Canvas connection, provider configuration,
conversations, and reading position. Canvas sign-in opens the Mac's sheet;
provider setup stays in native Settings.

For a website that stays available without the Mac, use the separate account
service described in [Hosting](HOSTING.md). It has its own data and sessions;
it does not expose or synchronize your Mac library.

## Troubleshooting

- **A Canvas file won't open:** refresh your Canvas connection, then retry the
  download. Saved material remains available after a failed request.
- **The tutor cannot read a scanned page:** native OCR may help; hosted indexing
  requires existing PDF text. Attach a figure to ask an image-capable model.
- **A browser edit conflicts:** keep the draft, return to the original document,
  and reload its current revision before saving again.
- **The local website stops responding:** keep the Mac app running and reopen
  it with **Open in Browser**. Hosted accounts use their own server instead.

For development and smoke-test commands, see [Contributing](../CONTRIBUTING.md).
