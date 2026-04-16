You are conducting a web-based research task on an offshore wind farm project.

Research this project:
Horns Rev I

Moderately confident database validation context to cross-check against current web sources and support with citations:

Emodnet wind farm database metadata (windfarm_database_test):
- Name: Horns Rev I
- Total turbine count: 80
- Capacity (MW): 160
- Status: Production

EuroWindWakes European Offshore Dataset (2025) turbine database metadata:
- OEM manufacturer: Vestas
- Rated power (MW): 2
- Rotor diameter (m): 80
- Hub height (m): 70
- Turbine type: V80-2.0 MW
- Commissioning date: 2002-12

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
4. Where sources conflict, do not guess:
   - state the conflict briefly
   - explain which value is most likely correct
   - prefer project-specific official or regulatory sources over secondary summaries
5. Be careful to distinguish:
   - the built project vs extensions / later phases
   - gross installed capacity vs export capacity / MEC
   - project company vs operator vs equity owners
   - planned turbine specs vs as-built turbine specs
6. For “Recent developments”, only include items from the last 24 months from the date of the search.
7. Use concise wording, but include enough detail to be useful.
8. Output in markdown tables only, plus at most 1 short explanatory paragraph where needed.
9. Include citations directly in the “Sources” column using markdown links.
10. If an item cannot be confirmed, write “Not confirmed” rather than inventing an answer.

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
   - classify as one of:
     operational, under construction, consented, in planning, concept

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

| Item | Completed detail | Sources |
|---|---|---|
| Project identity | ... | [Source 1](url), [Source 2](url) |
| Developer / owners | ... | [Source 1](url), [Source 2](url) |
| Ownership history | ... | [Source 1](url), [Source 2](url) |
| Status | ... | [Source 1](url), [Source 2](url) |
| Capacity | ... | [Source 1](url), [Source 2](url) |
| Maximum Export Capacity (MEC) | ... | [Source 1](url), [Source 2](url) |
| Turbine model | ... | [Source 1](url), [Source 2](url) |
| Turbine manufacturer (OEM) | ... | [Source 1](url), [Source 2](url) |
| Individual rated power | ... | [Source 1](url), [Source 2](url) |
| Rotor diameter | ... | [Source 1](url), [Source 2](url) |
| Hub height | ... | [Source 1](url), [Source 2](url) |
| Total turbine count | ... | [Source 1](url), [Source 2](url) |
| Foundations | ... | [Source 1](url), [Source 2](url) |
| Consent date | ... | [Source 1](url), [Source 2](url) |
| Final investment decision (FID) | ... | [Source 1](url), [Source 2](url) |
| First power date | ... | [Source 1](url), [Source 2](url) |
| Full commissioning date | ... | [Source 1](url), [Source 2](url) |

After that, include one short paragraph only if needed to explain an important nuance, for example:
- difference between gross capacity and MEC
- difference between Phase 1 and extension phases
- conflicting hub height figures
- project renamed over time

Then produce this second table:

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
- Use exact dates where available.
- Use percentages for ownership where available.
- Make sure the final result is suitable for copying into a research note or spreadsheet workflow.

