You are conducting a targeted web-based refresh for an already operational offshore wind farm report.

Refresh this project:
{PROJECT_CONTEXT}

This is not a full project rerun. Your job is to update only the ownership-related profile rows and the recent developments table using current web sources.

Important rules:
1. Use current web sources, not memory.
2. Prefer authoritative sources first:
   - official project website
   - owner / developer websites
   - operator websites
   - regulator / planning / government documents
   - grid / transmission authority documents
   - reputable industry news
3. Refresh only these first-table rows:
   - `Developer / owners`
   - `Ownership history`
4. Do not research or output capacity, turbine specifications, foundations, consent, FID, first power, commissioning, or any other profile rows.
5. For `Developer / owners` and `Ownership history`, use at least 2 web sources wherever possible.
6. For current owners, operator, ownership split, and status context, prioritise sources that themselves show a visible published date or last-updated date.
7. The important freshness signal is the source page's own published / updated date, not the date you performed the search.
8. If an official project page is clearly old or undated, treat it as background only and confirm current ownership / operator facts with a newer dated authoritative source such as a current owner portfolio page, investor results page, regulator page, or recent company update.
9. In the `Research summary` for both `Developer / owners` and `Ownership history`, explicitly mention the freshest source date relied on.
10. Do not use access dates or phrases like `current as accessed 2026` as freshness evidence.
11. For current ownership and ownership percentages, prefer the official project website, official JV website, or official operator page over third-party databases and over a single partner's asset page.
12. Do not infer the full current ownership structure from one investor or partner page on its own. Verify that the full partnership and percentages reconcile.
13. For `Recent developments`, include only items from the last 24 months from the date of the search.
14. If you do not find a substantive milestone in the last 24 months, include the freshest dated ownership or operator confirmation you found within the last 24 months as a monitoring row so the refresh still records a dated current-state check.
15. Keep the output in markdown tables only, plus at most 1 short explanatory sentence before the first table if needed.
16. Every citation link in the `Sources` column must be a direct absolute `https://` or `http://` URL.
17. Never use Orsted, TGS, 4C Offshore, or Windpower Monthly anywhere in the report.
18. In every `source_of_record.evidence_quote`, use a short verbatim machine-checkable fragment copied closely from the source page text, not a paraphrase.
19. Treat the output tables as a downstream parser contract:
   - keep the first table headers exactly as specified below
   - keep the second table heading exactly as `Recent developments`
   - keep the second table headers exactly as specified below
   - do not rename headers or add columns
20. Normalize all dates in both tables to `DD/MM/YYYY`.
21. If a source only confirms a month and year, use the first day of that month.
22. If a source only confirms a year, use `01/01/YYYY`.

Output format:

Produce this first table and only these two rows:

| Item | Value | Research summary | Sources |
|---|---|---|---|
| Developer / owners | ... | ... | [Source 1](url), [Source 2](url) |
| Ownership history | ... | ... | [Source 1](url), [Source 2](url) |

Then produce this second table:

Recent developments

| Date | Development | Why it matters | Sources |
|---|---|---|---|
| DD/MM/YYYY | ... | ... | [Source 1](url), [Source 2](url) |

After the recent developments table, append a final section with the exact heading `Provenance appendix` followed by one fenced `json` code block.

The JSON must be valid and use this shape:

```json
{
  "profile_rows": [
    {
      "item_label": "Developer / owners",
      "field_name": "developer",
      "value": "...",
      "provenance_mode": "web_source",
      "source_of_record": {
        "source_url": "https://...",
        "source_name": "...",
        "source_type": "official project",
        "licence": "public webpage terms",
        "retrieved_at": "2026-04-22T00:00:00Z",
        "evidence_quote": "...",
        "confidence": "high",
        "derived_by_ai": true,
        "human_verified": false,
        "verification_status": "unverified"
      },
      "supporting_context": [
        { "label": "...", "url": "https://..." }
      ]
    }
  ],
  "recent_developments": [
    {
      "date": "22/04/2026",
      "development": "...",
      "provenance_mode": "web_source",
      "source_of_record": {
        "source_url": "https://...",
        "source_name": "...",
        "source_type": "official project",
        "licence": "public webpage terms",
        "retrieved_at": "2026-04-22T00:00:00Z",
        "evidence_quote": "...",
        "confidence": "high",
        "derived_by_ai": true,
        "human_verified": false,
        "verification_status": "unverified"
      },
      "supporting_context": [
        { "label": "...", "url": "https://..." }
      ]
    }
  ]
}
```

Critical provenance rules:
- Every visible table row must have a matching entry in the provenance appendix with the same label and value.
- `source_of_record` is the origin of the chosen value, not just a page you reviewed while researching.
- Keep `evidence_quote` short and verifier-friendly.
- Keep the visible markdown tables unchanged; put provenance detail only in the appendix JSON.

Style requirements:
- Be precise and factual.
- Do not write a long narrative report.
- Keep the format close to an analyst-ready targeted refresh summary.