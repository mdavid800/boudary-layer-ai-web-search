const VALUE_FLAGS = new Set([
  '--engine',
  '--max-results',
  '--max-total-results',
  '--model',
  '--output',
  '--prompt',
  '--search-mode',
]);

export function parseCliArgs(argv) {
  const options = {
    engine: null,
    help: false,
    maxResults: null,
    maxTotalResults: null,
    model: null,
    outputPath: null,
    promptPath: null,
    searchMode: null,
    windFarmName: '',
  };
  const nameParts = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }

    if (argument === '-o') {
      options.outputPath = readNextValue(argv, index, '-o');
      index += 1;
      continue;
    }

    if (argument.startsWith('--')) {
      const [flag, inlineValue] = splitInlineValue(argument);

      if (!VALUE_FLAGS.has(flag)) {
        throw new Error(`Unknown option: ${flag}`);
      }

      const rawValue = inlineValue ?? readNextValue(argv, index, flag);

      if (inlineValue == null) {
        index += 1;
      }

      assignValue(options, flag, rawValue);
      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }

    nameParts.push(argument);
  }

  options.windFarmName = nameParts.join(' ').trim();
  return options;
}

export function formatHelp({
  defaultPromptPath,
  defaultModel,
  defaultSearchEngine,
  defaultSearchMode,
  defaultMaxResults,
  defaultMaxTotalResults,
}) {
  return [
    'Usage:',
    '  npm run research -- "<wind farm name>" [options]',
    '',
    'Options:',
    `  --prompt <path>               Prompt file path (default: ${defaultPromptPath})`,
    `  --model <model>               OpenRouter model (default: ${defaultModel})`,
    `  --engine <engine>             Search engine (default: ${defaultSearchEngine})`,
    `  --search-mode <mode>         Search mode: plugin, server-tool, auto (default: ${defaultSearchMode})`,
    `  --max-results <number>        Max results per search call (default: ${defaultMaxResults})`,
    `  --max-total-results <number>  Max total results across the request (default: ${defaultMaxTotalResults})`,
    '  --output, -o <path>          Save the markdown report to a file',
    '  --help, -h                   Show this help text',
  ].join('\n');
}

function splitInlineValue(argument) {
  const separatorIndex = argument.indexOf('=');

  if (separatorIndex === -1) {
    return [argument, null];
  }

  return [argument.slice(0, separatorIndex), argument.slice(separatorIndex + 1)];
}

function readNextValue(argv, index, flag) {
  const value = argv[index + 1];

  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function assignValue(options, flag, rawValue) {
  switch (flag) {
    case '--prompt':
      options.promptPath = rawValue;
      return;
    case '--model':
      options.model = rawValue;
      return;
    case '--engine':
      options.engine = rawValue;
      return;
    case '--output':
      options.outputPath = rawValue;
      return;
    case '--search-mode':
      options.searchMode = rawValue;
      return;
    case '--max-results':
      options.maxResults = parsePositiveInteger(rawValue, '--max-results');
      return;
    case '--max-total-results':
      options.maxTotalResults = parsePositiveInteger(rawValue, '--max-total-results');
      return;
    default:
      throw new Error(`Unknown option: ${flag}`);
  }
}

function parsePositiveInteger(value, flag) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }

  return parsed;
}
