# Additional Auto-Model Comparison Review

This review covers the follow-up comparison pass requested after the server-tool cleanup, using the same current runtime setup as the successful baseline runs:

- `--engine auto`
- OpenRouter `openrouter:web_search` server tool
- no `--search-mode` flag

The existing baseline models were intentionally not rerun here:

- `openai/gpt-5.4`
- `anthropic/claude-sonnet-4.6`
- `anthropic/claude-opus-4.7`

## Requested candidate models

| Model | Beatrice result | Seagreen result | What happened |
|---|---|---|---|
| `x-ai/grok-4.20-multi-agent` | Failed before report generation | Failed before report generation | OpenRouter returned `404 No endpoints found that support tool use` |
| `xiaomi/mimo-v2-pro` | Failed before report generation | Failed before report generation | OpenRouter returned `no assistant content` |
| `minimax/minimax-01` | Failed before report generation | Failed before report generation | OpenRouter returned `404 No endpoints found that support tool use` |
| `qwen/qwen3.6-plus` | Failed before report generation | Failed before report generation | OpenRouter returned `no assistant content` |
| `openai/gpt-5.4-mini` | Completed | Completed | Produced saved reports for both projects |

## Interpretation

This retry pass produced one usable comparison result: `openai/gpt-5.4-mini` completed successfully on both projects. The other four requested models still did not produce completed reports under the current server-tool workflow.

Two models appear to be incompatible with this experiment as currently configured:

1. `x-ai/grok-4.20-multi-agent`
2. `minimax/minimax-01`

Both failed with `404 No endpoints found that support tool use`, which means the comparison cannot answer whether their report quality would be better or worse under the current search workflow. The limiting factor is provider/tool support, not report quality.

Two additional models now appear to be poor fits for this workflow even after quota reset:

1. `xiaomi/mimo-v2-pro`
2. `qwen/qwen3.6-plus`

Both returned `OpenRouter returned no assistant content.` on both Beatrice and Seagreen. That means the call reached the provider, but the model did not yield a usable tool-driven assistant response for this workflow.

## GPT-5.4-mini evaluation

### Beatrice

`openai/gpt-5.4-mini` produced a clean, publishable report with no search-planning leakage. It correctly identified the current ownership split, turbine platform (`SGRE 7.0-154`), turbine count, and jacket foundations. It also used a stronger ownership-freshness source chain than some earlier runs by leaning on The Crown Estate’s ownership page as at `31 December 2024`.

Its main weaknesses are conservatism on two disputed technical fields:

1. It left MEC as `Not confirmed`
2. It left hub height as `Not confirmed`

That makes it cleaner than the Anthropic outputs, but less complete than the best field-level Beatrice cross-checks.

### Seagreen

`openai/gpt-5.4-mini` also produced a clean, publishable Seagreen report. It correctly identified the current ownership split, `Vestas V164-10.0 MW`, `1,075 MW`, `114` turbines, and jacket/suction-caisson foundations. It is materially better than the failed/empty Mimo and Qwen runs because it actually completes the task with broadly correct core facts.

Its main weakness is freshness reasoning discipline. In the ownership row it cites the Seagreen project page as “crawled yesterday,” which is not an acceptable freshness signal for current-fact validation. It also leaves hub height as `Not confirmed`, where the stronger GPT-5.4 baseline gave a more useful site-specific value.

## Practical takeaway

Based on the runs that actually completed so far, `openai/gpt-5.4` still remains the best validated option on the current server-tool setup for the combined quality/cost judgment already established in earlier review notes.

`openai/gpt-5.4-mini` is now the only newly tested model from this follow-up set that completed successfully on both projects. It looks viable as a lower-cost fallback, but it is still weaker than full GPT-5.4 on field completeness and freshness handling.

This additional pass shows two useful things:

1. Some alternative models cannot currently be evaluated in this workflow because OpenRouter has no tool-capable route for them.
2. Some models can accept the request but still fail to return usable assistant content under tool use.
3. `openai/gpt-5.4-mini` is credible enough to keep on the shortlist, but it does not displace `openai/gpt-5.4` as the best current baseline.

## Next recommendation

If you want to continue narrowing the shortlist, the practical next step is to compare `openai/gpt-5.4-mini` directly against `openai/gpt-5.4` on a slightly larger sample, because those are now the two models in this branch that have actually completed under the current workflow.

`xiaomi/mimo-v2-pro` and `qwen/qwen3.6-plus` are no longer blocked by quota in this pass; they failed by returning no assistant content, which is a more substantive workflow incompatibility signal.