import process from 'node:process';
import dotenv from 'dotenv';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';

const CONFIGURED_FLAG = Symbol.for('boundary-layer-ai-web-search.proxyConfigured');

dotenv.config();

export function configureProxyFromEnvironment() {
  if (globalThis[CONFIGURED_FLAG]) {
    return false;
  }

  if (!hasProxyEnvironment()) {
    return false;
  }

  setGlobalDispatcher(new EnvHttpProxyAgent());
  globalThis[CONFIGURED_FLAG] = true;

  return true;
}

function hasProxyEnvironment() {
  return Boolean(
    readEnvironmentValue('https_proxy')
      || readEnvironmentValue('HTTPS_PROXY')
      || readEnvironmentValue('http_proxy')
      || readEnvironmentValue('HTTP_PROXY'),
  );
}

function readEnvironmentValue(name) {
  return process.env[name]?.trim();
}

configureProxyFromEnvironment();
