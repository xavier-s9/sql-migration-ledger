import { readFileSync } from 'node:fs';

export interface Config {
  dir?: string;
  ledger?: string;
}

export const CONFIG_FILENAME = '.sqlmigraterc.json';

// Missing config file is the common case - most projects just use the
// built-in defaults - so treat ENOENT as "no config" rather than an error.
export function loadConfig(path: string = CONFIG_FILENAME): Config {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return {};
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config file is not valid JSON: ${path}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`config file is malformed: ${path}`);
  }

  const obj = parsed as Record<string, unknown>;
  const config: Config = {};

  if ('dir' in obj) {
    if (typeof obj.dir !== 'string') {
      throw new Error(`config file field "dir" must be a string: ${path}`);
    }
    config.dir = obj.dir;
  }

  if ('ledger' in obj) {
    if (typeof obj.ledger !== 'string') {
      throw new Error(`config file field "ledger" must be a string: ${path}`);
    }
    config.ledger = obj.ledger;
  }

  return config;
}
