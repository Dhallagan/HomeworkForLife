# TODOs

## Optimize listEntriesForDay() with server-side date filter
**What:** Replace the full-table-scan-then-filter pattern in `listEntriesForDay()` (repository.ts:361-367) with a proper `WHERE` clause that filters by date at the SQL level.
**Why:** Currently loads ALL entries from the database and filters client-side in JavaScript. Works fine with <100 entries but will degrade as the life ledger grows to 365+ entries over a year of daily use.
**Pros:** O(1) query per day instead of O(n) full scan. Improves day detail screen load time.
**Cons:** Need to handle timezone correctly in SQL (`date(created_at, 'localtime')`), which is a new pattern in the codebase — all other date filtering uses `isSameCalendarDay()` in JS.
**Context:** Pre-existing debt, not introduced by the Homework for Life feature. The same pattern exists in `listDailySummaries()` which iterates all entries to build daily aggregates. Both should be optimized together when the ledger reaches ~200+ entries.
**Depends on:** Nothing. Can be done at any time.

## Ensure People queries use indexed WHERE clauses
**What:** When implementing People screen queries (listPeople, getPersonWithEntries), use proper SQL JOINs with WHERE clauses instead of the client-side filtering pattern used elsewhere in the codebase.
**Why:** The People feature introduces junction table queries (people_entries JOIN journal_entries). With 200+ people over a year of journaling, a full-scan approach would degrade. Proper SQL from the start avoids creating new debt.
**Pros:** O(1) lookups per person instead of O(n) scans. Sets the right pattern for future queries.
**Cons:** None — this is just "write good SQL." Including as a TODO to make it explicit.
**Context:** Related to the existing listEntriesForDay() optimization TODO. The People feature creates a second query path that benefits from the same discipline. Introduced during /plan-eng-review of the People screen design.
**Depends on:** People feature implementation.

## Refresh person summaries when entry count grows
**What:** Regenerate a person's AI summary when they accumulate 5+ new entries since the last summary generation. Track `summary_generated_at` or `summary_entry_count` on the people table.
**Why:** Summaries are generated once (on person creation or after backfill) but go stale as new entries mention the person. After a month of daily journaling, "Your wife. SoulCycle partner." may no longer reflect the most salient activities.
**Pros:** Keeps People screen summaries fresh and accurate over time.
**Cons:** Additional API calls (~1 per person per refresh). Could add a `last_summary_entry_count` column to track delta.
**Context:** Identified during /plan-eng-review. V1 generates summaries only on creation. This TODO tracks the follow-up to keep them current. Low priority — summaries are still useful even when slightly stale.
**Depends on:** People feature v1 implementation.
