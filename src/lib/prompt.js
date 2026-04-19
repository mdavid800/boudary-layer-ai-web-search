import { readFile } from 'node:fs/promises';

const PROJECT_CONTEXT_PLACEHOLDER = '{PROJECT_CONTEXT}';
const WIND_FARM_PLACEHOLDER = '{WIND_FARM_NAME}';

export async function loadPromptTemplate(filePath) {
  return readFile(filePath, 'utf8');
}

export function buildResearchPrompt(template, projectContext) {
  const trimmedContext = projectContext.trim();

  if (!trimmedContext) {
    throw new Error('Project context is required.');
  }

  if (template.includes(PROJECT_CONTEXT_PLACEHOLDER)) {
    return template.replaceAll(PROJECT_CONTEXT_PLACEHOLDER, trimmedContext);
  }

  if (template.includes(WIND_FARM_PLACEHOLDER)) {
    return template.replaceAll(WIND_FARM_PLACEHOLDER, trimmedContext);
  }

  throw new Error(
    `Prompt template must include the ${PROJECT_CONTEXT_PLACEHOLDER} or ${WIND_FARM_PLACEHOLDER} placeholder.`,
  );
}

export function buildProjectContext({
  sourceTableName,
  turbineMetadata,
  windFarmMetadata,
  turbineCountValidation,
}) {
  const windFarmName = formatValue(windFarmMetadata?.name);

  if (windFarmName === 'Not provided') {
    throw new Error(
      'Wind farm metadata must include a project name.',
    );
  }

  const lines = [
    windFarmName,
    '',
    'Moderately confident database validation context to cross-check against current web sources and support with citations:',
    '',
    `Emodnet wind farm database metadata (${sourceTableName}, lower-confidence for turbine technical fields):`,
    `- Name: ${windFarmName}`,
    `- Type: ${formatValue(windFarmMetadata?.type)}`,
    `- Total turbine count: ${formatValue(windFarmMetadata?.nTurbines)}`,
    `- Capacity (MW): ${formatValue(windFarmMetadata?.powerMw)}`,
    `- Status: ${formatValue(windFarmMetadata?.status)}`,
  ];

  if (turbineMetadata) {
    lines.push(
      '',
      'EuroWindWakes European Offshore Dataset (2025) linked project turbine metadata (required fallback for turbine specs and hub height when project-specific web evidence is inconclusive; do not replace it with generic turbine-model pages or specs from other sites):',
      `- OEM manufacturer: ${formatValue(turbineMetadata.oemManufacturer)}`,
      `- Rated power (MW): ${formatValue(turbineMetadata.ratedPower)}`,
      `- Rotor diameter (m): ${formatValue(turbineMetadata.rotorDiameter)}`,
      `- Hub height (m): ${formatValue(turbineMetadata.hubHeight)}`,
      `- Turbine type: ${formatValue(turbineMetadata.turbineType)}`,
      `- Commissioning date: ${formatValue(turbineMetadata.commissioningDate)}`,
    );
  } else {
    lines.push(
      '',
      'EuroWindWakes European Offshore Dataset (2025) linked project turbine metadata (higher-priority for turbine specs and hub height when available):',
      '- No linked turbine metadata was found for this wind farm boundary.',
      '- If project-specific web sources do not confirm a turbine-specific field, use Not confirmed rather than inferring from another site that uses the same turbine model.',
    );
  }

  if (turbineCountValidation) {
    lines.push(
      '',
      'Structured turbine-count validation context (use as non-web cross-check context; do not cite it as a web source):',
    );

    if (turbineCountValidation.winningFact) {
      lines.push(
        `- Current database winner candidate: ${formatValue(turbineCountValidation.winningFact.value)}${turbineCountValidation.winningFact.sourceDetail ? ` (${turbineCountValidation.winningFact.sourceDetail})` : ''}`,
      );
    }

    if (turbineCountValidation.calculatedFact) {
      lines.push(
        `- EuroWindWakes calculated linked-turbine count: ${formatValue(turbineCountValidation.calculatedFact.value)}${turbineCountValidation.calculatedFact.sourceDetail ? ` (${turbineCountValidation.calculatedFact.sourceDetail})` : ''}`,
      );
    }

    if (turbineCountValidation.emodnetFact) {
      lines.push(
        `- EMODnet turbine-count hint: ${formatValue(turbineCountValidation.emodnetFact.value)}`,
      );
    }

    if (turbineCountValidation.communitySummary) {
      lines.push(
        `- Approved community turbine-count notes: ${turbineCountValidation.communitySummary.approvedNoteCount} note(s), ${turbineCountValidation.communitySummary.totalUpvotes} total upvote(s)`,
      );

      for (const candidate of turbineCountValidation.communitySummary.topProposedValues) {
        lines.push(
          `- Community-supported turbine-count value: ${formatValue(candidate.value)} (${candidate.noteCount} note(s), ${candidate.totalUpvotes} upvote(s), ${candidate.promotedNoteCount} promoted)`
        );
      }
    }
  }

  return lines.join('\n');
}

function formatValue(value) {
  if (value == null || value === '') {
    return 'Not provided';
  }

  return String(value);
}
