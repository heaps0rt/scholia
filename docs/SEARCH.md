# Needle workspace search

Open **Search files** or press **⌘K** on Mac / **Ctrl+K** in the browser.
Search the current workspace or select **All workspaces**. Choose names and
contents, file names, or contents only. Selecting a content result opens its
page, notebook cell, or document section. The Mac app, its loopback website,
and hosted accounts support the same search contract.

- Words are literal, case-insensitive substrings, combined with AND on one
  page or one file's title/name record. `matrix inverse` finds both on the same
  page; it does not combine unrelated pages to manufacture a match.
- Double quotes preserve a phrase: `"change of basis"`. An unfinished quoted
  phrase works while typing. Punctuation such as `C++`, `x.y`, and `[a-z]`
  stays literal. There is no regex, fuzzy matching, stemming, or synonym expansion.
- Text is normalized with Unicode NFKC, lowercasing, and collapsed whitespace.
  A phrase can cross a line break within a page. Snippets show that normalized
  searchable text. Matching names come first, followed by content matches;
  each file appears once with its earliest matching page. The UI shows up to
  60 files and reports the full count.
- Cloud materials are searchable by name. Download them to search inside.
  Search reads existing extracted text and OCR indexes; it does not start OCR,
  download files, call a model, or send text to a search provider. Files without
  readable text remain discoverable by name. Original-preview placeholder text
  is excluded from evidence.

Workspace search finds literal text. The tutor selects context separately.

## How the retrieval path works

Needle stores names and page text in SQLite and narrows candidates with trigram
fragments before checking the full query.

1. Save each file's metadata and each nonempty page in a persistent SQLite
   index. Use an external-content FTS5 trigram table with `detail=none`, avoiding
   duplicate source text and per-occurrence position storage. SQLite documents
   [trigram indexing and reduced-detail storage](https://www.sqlite.org/fts5.html#the_trigram_tokenizer).
2. Sample at most 24 three-code-point fragments from the query. Consult
   `fts5vocab` for their passage frequencies and select up to three rarest
   sampled fragments. An absent fragment proves there is no match.
3. Intersect their posting lists when the rarest list covers fewer than half
   the passages in scope. Otherwise scan; one- and two-character queries also
   use a scan. This threshold is a heuristic, not an optimality guarantee.
4. Apply workspace and name/content filters and verify **every complete query
   term** using literal substring checks. Fragment collisions or terms in the
   wrong order never become results.
5. Group verified passages by file and return a bounded snippet and navigable
   source, plus coverage and timing information. `candidateUpperBound` reports
   an upper bound on candidate passages, not CPU work or disk reads.

The hosted engine uses up to two lazy workers off the HTTP thread, with a
16-request queue limit and separate index files per account. Each account is
pinned to one worker so its writes stay ordered. A worker retains one hot
account's connection, evicts it when switching accounts, and closes it after
two idle minutes. The Mac implementation owns its connection on a Swift actor
off the UI actor. Authentication, CSRF, and workspace ownership checks apply
to `GET /api/search?q=…&courseID=…&mode=all|files|content`.

The first search prepares text in its scope. Subsequent searches compare file
metadata, index paths, and modification stamps, update only changed files, and
remove records no longer in the library. Scoped searches prepare only that
workspace. Updates are committed in batches of at most 64 files; an interrupted
batch rolls back. Edits, downloads,
renames, and OCR sidecars become visible on the next search; a query already in
flight uses its captured library snapshot. Browser request generations prevent
old query results from replacing newer ones. Disconnects cancel queued work
and cooperatively interrupt active refreshes between files/pages. Native tasks
also check cancellation during indexing. Both search inputs debounce for 35 ms.

## Apple Silicon and memory use

Connections reuse up to 128 prepared statements and cache fragment frequencies
and scope counts. Writes invalidate these caches; `PRAGMA data_version` also
detects other connections' commits. No complete search responses are cached.
WAL, `synchronous=NORMAL`, a 4 MiB SQLite page-cache target, and up to 256 MiB
of memory mapping reduce repeated opening, allocation, and I/O work. The mmap
limit reserves address space, not 256 MiB of pinned RAM. The index is rebuildable
derived data, so loss of a recent cache transaction after a power failure does
not lose original documents.

On Apple Silicon, `ScholiaSearch.c` uses baseline **128-bit ARM NEON** to check
16 possible byte offsets together. It checks first, interior, and last bytes,
then verifies surviving candidates exactly. A SQLite function reads SQLite's
UTF-8 buffers directly; it does not copy each page into Swift. Loads stay within
the supplied lengths. Very repetitive candidates and short tails fall back to
libc; Intel builds use libc. This is a CPU implementation with no GPU setup or
new runtime dependency. The verifier is part of the same literal matching path.

The hosted Node path uses built-in substring search over a lazily materialized
text snapshot for broad queries. Estimated retained text is capped at 64 MiB
per worker, reduced according to available process memory. The estimate charges
twice the UTF-8 byte length plus per-row overhead; it is not a bound on total
process RSS. Only one snapshot is retained per worker, and larger scopes fall
back to a SQLite scan. Native search uses the NEON SQLite predicate instead of
retaining a second text snapshot. Changes invalidate snapshots and absent-gram
caches before the next query.

The worker cap limits competing memory scans and leaves CPU capacity for the
app and document extraction. Scheduling stays with macOS rather than binding
work to particular performance or efficiency cores. More threads are not
automatically faster: the included engine benchmark measures two- and
four-thread Tantivy builds separately.

The index is a disposable cache named `needle-v1.sqlite`: beside `library.json`
on Mac, or under `files/<account>/<account>/` in hosted storage. It contains
searchable document text, has owner-only file permissions, and stays in the
same storage environment as the library. Removing this cache while Scholia is
stopped causes the next search to rebuild it. Keep it in mind when provisioning
hosted disk space: it is additional to original-file quotas.

## Match correctness

Let a normalized passage contain every query term. Every three-character
fragment chosen from those terms must also occur in that passage. Therefore
the passage belongs to every chosen fragment's posting list, so their
intersection cannot exclude it. Sampling fragments changes candidate counts,
not this property. The final literal verification accepts precisely the
passages that a full scan accepts. Short-query and common-query scans apply
that same predicate directly.

Thus, given the same readable index snapshot, the candidate step has no false
negatives and the returned matches have no fragment-induced false positives.
The result limit affects display only, not the reported match count. This says
nothing about OCR accuracy, semantic relevance, unavailable files, or universal
latency superiority. For selective queries, the engine verifies fewer passage
texts; actual speed is an empirical result.

## Reproduce the measurements

```sh
npm run benchmark:search
# Optional: change corpus size/repetitions or save the JSON report.
SEARCH_BENCH_FILES=1200 SEARCH_BENCH_ROUNDS=31 \
  SEARCH_BENCH_OUTPUT=/tmp/needle-benchmark.json npm run benchmark:search

node --test tests/workspace-search.test.js tests/hosted-server.test.js
npm run smoke:macos:search
npm run smoke:chromium:search
npm run test:search:native       # ASan + UBSan, 60,000 matcher comparisons
npm run benchmark:search:native  # SQLite instr / NEON / libc scan kernels

# Optional, isolated SQLite / Tantivy prototype comparison.
mkdir -p dist/verification
SEARCH_BENCH_CORPUS=dist/verification/needle-corpus.json npm run benchmark:search
uv venv --python 3.11 dist/needle-bench-venv
uv pip install --python dist/needle-bench-venv/bin/python \
  -r scripts/search-benchmark-requirements.txt
dist/needle-bench-venv/bin/python scripts/benchmark-search-engines.py \
  --corpus dist/verification/needle-corpus.json \
  --output dist/verification/needle-engine-comparison.json
```

The benchmark creates a deterministic temporary corpus and removes it afterward.
It compares the index with an independent, already-normalized in-memory substring
scan, the same SQLite query forced to scan, and ripgrep where literal queries
are directly comparable. Every timed run checks result identities, page numbers,
and counts against the oracle; ripgrep checks file identities. Timings report
medians and p95 for engine and service calls. Warm service calls include worker
messaging, modification checks, and result construction with a reused SQLite
connection, but exclude HTTP, the UI's 35 ms input debounce, and rendering.
First-query cache fills, fresh-worker startup, and edit visibility are reported
separately. Disk size is measured after checkpointing the WAL. Ripgrep timings
include process startup; its output contains file names rather than page evidence.

The engine comparison uses independent Python processes, the same normalized
corpus, rare-fragment selection, and exact final verification. It checks file
identities, first pages, passage counts, Unicode, and replacement visibility.
It records build time/CPU, index size, process peak RSS, warm p50/p95, and
process-cold startup with a warm filesystem cache. Tantivy's Python API uses
constant-score TopDocs and stored-document decoding; this does not measure an
optimized Rust collector. Neither engine can use token relevance as a substitute
for the literal query contract. The app does not depend on Python or Tantivy.

See [the measured example](SEARCH_BENCHMARK.md) for results including indexing
time, disk usage, and cases where scans win. There is no benchmark against an
embedding system, RAG pipeline, or turbopuffer service here, and no general
speed or relevance claim against them.
