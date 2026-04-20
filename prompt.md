You are conducting a web-based research task on an offshore wind farm project.

Research this project:
{PROJECT_CONTEXT}

Your job is to search the web and produce a source-backed project profile in a clean tabular format.

Before writing the final answer, cross-check all key facts against at least 2 independent sources and resolve any phase/name ambiguity first.

Important rules:
1. Use current web sources, not memory.
2. Prefer authoritative sources first:
   - official project website
   - owner / developer websites
   - OEM / supplier websites
   - regulator / planning / government documents
   - grid / transmission authority documents
   - reputable industry news
3. For every item, provide at least 2 web sources wherever possible.
4. For facts that can change over time, especially current owners, operator, ownership split, and status, prioritise sources that themselves show a visible published date or last-updated date.
5. The important freshness signal is the source page's own published / updated date, not the date you performed the search.
6. If an official project page is clearly old or undated, treat it as background only and confirm current ownership / operator / status with a newer dated authoritative source such as a current owner portfolio page, investor results page, regulator page, or recent company update.
7. In the Research summary for both `Developer / owners` and `Ownership history`, explicitly mention the freshest source date relied on, for example `SSE portfolio page updated November 2024 confirms ...`.
8. Do not use access dates or phrases like `current as accessed 2026` as freshness evidence. Only use a visible source-page published date or last-updated date.
9. For current ownership and ownership percentages, prefer the official project website, official JV website, or official operator page over third-party databases and over a single partner's asset page.
10. Do not infer the full current ownership structure from one investor or partner page on its own. Those pages often list only that investor's stake and may lag later transfers.
11. If an official project/JV/operator page explicitly lists the partnership and percentage shares, treat that as the primary source for the current ownership split unless a newer official source clearly supersedes it.
12. For multi-owner projects, verify that the current ownership percentages reconcile to the full partnership before answering. If a source only shows one partner or the percentages do not reconcile, keep searching.
13. Where sources conflict, do not guess:
   - state the conflict briefly
   - explain which value is most likely correct
   - prefer project-specific official or regulatory sources over secondary summaries
14. Be careful to distinguish:
   - the built project vs extensions / later phases
   - gross installed capacity vs export capacity / MEC
   - project company vs operator vs equity owners
   - planned turbine specs vs as-built turbine specs
15. For turbine-specific fields such as turbine model, OEM, rated power, rotor diameter, and especially hub height, only use evidence that is explicitly tied to the specific project / phase being researched.
16. Never infer a site-specific turbine field from a generic turbine-model product page, a turbine brochure, or another wind farm that happens to use the same turbine.
17. In particular, do not infer hub height from turbine model alone. The same turbine platform can be deployed at different hub heights on different sites.
18. If a source describes the turbine platform generically but does not explicitly say that the value applies to this project, treat it as background only, not as confirming evidence for the table.
19. If the project context includes both EMODnet wind farm metadata and linked EuroWindWakes turbine metadata, treat EuroWindWakes as the higher-priority project-linked database hint for turbine model, OEM, individual rated power, rotor diameter, hub height, and other turbine-specific fields.
20. If EMODnet and EuroWindWakes disagree on turbine information or hub height, prefer EuroWindWakes unless newer authoritative project-specific web sources clearly support EMODnet instead.
21. Treat EMODnet turbine technical fields as lower-confidence background only. Do not let EMODnet override stronger EuroWindWakes evidence or better project-specific web sourcing for turbine specifications.
22. If a linked EuroWindWakes turbine row is present in the project context, you MUST use it as the fallback for turbine model, OEM, individual rated power, rotor diameter, hub height, and related turbine-specific fields whenever project-specific web research is inconclusive, ambiguous, or missing one of those values.
23. When a linked EuroWindWakes turbine row is present, do not leave those turbine-specific fields as `Not confirmed` unless the EuroWindWakes row itself is missing that specific value.
24. When you use a EuroWindWakes fallback because project-specific web research was inconclusive, say so explicitly in the relevant `Research summary` cell, for example by stating that project-specific web sources remained ambiguous and the linked EuroWindWakes dataset value was used as the required fallback.
25. Do not claim that the EuroWindWakes value was unavailable if the project context includes a linked EuroWindWakes row for that field. Use the provided value and state that you used it.
26. If the project context includes a calculated linked turbine count, an EMODnet turbine-count hint, or approved community turbine-count notes, treat them as non-web validation signals for `Total turbine count` only.
27. In the `Research summary` for `Total turbine count`, explicitly say whether the web-sourced figure aligns with or differs from those validation signals, and briefly explain likely reasons such as phase scope, overlapping geometries, outdated dataset values, or community dispute when relevant.
26. If the project context says the dataset `Type` is not `Offshore wind farm`, do not force the asset into a commercial wind-farm interpretation. Preserve the indicated type, state clearly if it is a demo zone, wave site, tidal site, or development zone, and use `Not confirmed` for fields that do not apply cleanly.
27. For “Recent developments”, only include items from the last 24 months from the date of the search.
28. Use concise wording, but include enough detail to be useful.
29. Output in markdown tables only, plus at most 1 short explanatory paragraph where needed.
30. Include citations directly in the “Sources” column using markdown links.
31. Every citation link in the `Sources` column must be a direct absolute `https://` or `http://` URL. Never use placeholder links such as `(#)` or non-web links.
32. If an item cannot be confirmed, write `Not confirmed` rather than inventing an answer, but only after applying the required linked EuroWindWakes fallback rules above when a linked turbine row exists.
33. Treat the output tables as a downstream parser contract:
   - keep the first table row order exactly as specified below
   - keep the second table heading as “Recent developments” and the second table headers exactly as specified below
   - do not rename the table headers
   - do not add extra columns, bullet lists, or prose between the table header and table rows
34. Normalize all dates in both tables to `DD/MM/YYYY`.
35. If a source only confirms a month and year, use the first day of that month in the table, for example `01/10/2023`, and explain that month-level wording briefly in the `Research summary` when it matters.
36. If a source only confirms a year, use `01/01/YYYY`.

Research and complete the following items:

1. Project identity
   - official name
   - alternative / historic project names where relevant

2. Owners
   - developer
   - current owner(s)
   - equity partners and ownership percentages
   - operator if different

3. Status
   - current development stage
   - classify using exactly one of these Boundary Layer statuses:
     - `Operational`
     - `Under Construction`
     - `Consent Authorised`
     - `FID Taken, Pre-Construction` — consented and preparing for construction; FID taken and major contracts awarded
     - `Consent Application Submitted` — planning / consent application submitted and awaiting decision
     - `Development Zone / lease area` — lease / seabed zone awarded but no specific project consent application yet
     - `Concept` — early-stage project with no formal application yet
   - when evidence is ambiguous, choose the closest exact label above and explain the nuance briefly in the research summary

4. Capacity
   - total installed or planned capacity in MW

5. Maximum Export Capacity (MEC)

6. Turbines
   - model
   - manufacturer / OEM
   - individual rated power
   - rotor diameter
   - hub height
   - total count of turbines

7. Foundations
   - foundation type

8. Timeline
   - consent date
   - FID date
   - first power date
   - full commissioning date

9. Recent developments
   - key items from the last 24 months
   - examples: ownership changes, construction milestones, regulatory decisions, OFTO sales, refinancing, expansions, turbine installation milestones

Output format:

Start with one short sentence clarifying exactly which project / phase is being assessed if there is any ambiguity.

Then produce this first table:

| Item | Value | Research summary | Sources |
|---|---|---|---|
| Project identity | ... | ... | [Source 1](url), [Source 2](url) |
| Developer / owners | ... | ... | [Source 1](url), [Source 2](url) |
| Ownership history | ... | ... | [Source 1](url), [Source 2](url) |
| Status | One of the exact Boundary Layer statuses above | ... | [Source 1](url), [Source 2](url) |
| Capacity | ... | ... | [Source 1](url), [Source 2](url) |
| Maximum Export Capacity (MEC) | ... | ... | [Source 1](url), [Source 2](url) |
| Turbine model | ... | ... | [Source 1](url), [Source 2](url) |
| Turbine manufacturer (OEM) | ... | ... | [Source 1](url), [Source 2](url) |
| Individual rated power | ... | ... | [Source 1](url), [Source 2](url) |
| Rotor diameter | ... | ... | [Source 1](url), [Source 2](url) |
| Hub height | ... | ... | [Source 1](url), [Source 2](url) |
| Total turbine count | ... | ... | [Source 1](url), [Source 2](url) |
| Foundations | ... | ... | [Source 1](url), [Source 2](url) |
| Consent date | ... | ... | [Source 1](url), [Source 2](url) |
| Final investment decision (FID) | ... | ... | [Source 1](url), [Source 2](url) |
| First power date | ... | ... | [Source 1](url), [Source 2](url) |
| Full commissioning date | ... | ... | [Source 1](url), [Source 2](url) |

After that, include one short paragraph only if needed to explain an important nuance, for example:
- difference between gross capacity and MEC
- difference between Phase 1 and extension phases
- conflicting hub height figures
- project renamed over time

Then produce this second table:

Recent developments

| Date | Development | Why it matters | Sources |
|---|---|---|---|
| Month Year / Date | ... | ... | [Source 1](url), [Source 2](url) |
| Month Year / Date | ... | ... | [Source 1](url), [Source 2](url) |
| Month Year / Date | ... | ... | [Source 1](url), [Source 2](url) |

Style requirements:
- Be precise and factual.
- Do not use bullet points outside the tables.
- Do not write a long narrative report.
- Keep the format close to an analyst-ready project summary.
- Use “Not confirmed” where evidence is weak.
- Use exact dates where available, otherwise normalize partial dates using the rules above.
- Use percentages for ownership where available.
- Make sure the final result is suitable for copying into a research note or spreadsheet workflow.

