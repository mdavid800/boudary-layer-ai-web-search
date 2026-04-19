# Copilot Instructions

This repository runs offshore wind farm research through OpenRouter using the `openrouter:web_search` server tool.

## Operational behavior

- Treat `openai/gpt-5.4` research requests as potentially slow, not immediately hung.
- In measured runs against the production Beatrice prompt, OpenRouter returned `200` quickly, then streamed only whitespace keepalive chunks for about 59 seconds before the first real GPT-5.4 payload arrived.
- The equivalent `openai/gpt-5.4-mini` prompt reached first real payload in about 23 seconds.
- The current request path buffers the full response body before parsing, so there is no useful progress logging while the upstream stream is alive.
- The current quality gate can trigger one full retry request after the first completion, which can make a slow GPT-5.4 run appear twice as long.

## Guidance for future changes

- Do not assume a silent GPT-5.4 run is frozen unless you have checked the underlying stream behavior or enforced a timeout.
- When debugging perceived hangs, distinguish these cases:
  - headers are delayed
  - headers arrive quickly but only keepalive whitespace is streamed
  - the first completion returns, then a second request starts because quality checks failed
- If you change the OpenRouter request path, preserve the current server-tool-only behavior.
- Prefer adding explicit timeouts, elapsed-time logging, and retry visibility before changing prompt depth or default model selection.
- If you document or explain freshness issues, remember that the important freshness signal is the source page's own published or updated date, not the crawl date or access date.