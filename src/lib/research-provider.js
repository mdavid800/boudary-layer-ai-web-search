import { getResearchProvider } from './runtime-config.js';
import { requestResearchReport as requestOpenRouterReport } from './openrouter.js';
import { requestResearchReportCodex } from './codex-provider.js';

export async function requestResearchReportWithProvider({ provider = 'openrouter', ...options }) {
  const resolvedProvider = getResearchProvider(provider, 'provider');

  switch (resolvedProvider) {
    case 'openrouter':
      return requestOpenRouterReport(options);
    case 'codex':
      return requestResearchReportCodex(options);
    default:
      throw new Error(`Unsupported research provider: ${resolvedProvider}`);
  }
}
