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
    `Emodnet wind farm database metadata (${sourceTableName}):`,
    `- Name: ${windFarmName}`,
    `- Total turbine count: ${formatValue(windFarmMetadata?.nTurbines)}`,
    `- Capacity (MW): ${formatValue(windFarmMetadata?.powerMw)}`,
    `- Status: ${formatValue(windFarmMetadata?.status)}`,
  ];

  if (turbineMetadata) {
    lines.push(
      '',
      'EuroWindWakes European Offshore Dataset (2025) turbine database metadata:',
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
      'EuroWindWakes European Offshore Dataset (2025) turbine database metadata:',
      '- No linked turbine metadata was found for this wind farm boundary.',
    );
  }

  return lines.join('\n');
}

function formatValue(value) {
  if (value == null || value === '') {
    return 'Not provided';
  }

  return String(value);
}
