# Raw SQL exceptions

Hard Rule 7: the **only** two files allowed to contain raw SQL live here.

- `lineage.ts` — recursive CTE for ancestor/descendant traversal (lands in Phase 3, FR-LINEAGE-04)
- `similarity.ts` — pgvector cosine similarity scoped to ancestor IDs (lands in Phase 5, FR-GRADE-09)

Parameter placeholders only — never string interpolation (CI greps for `${` in SQL templates here).
