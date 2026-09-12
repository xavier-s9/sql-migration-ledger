import { readFileSync, writeFileSync } from 'node:fs';

export interface LedgerEntry {
  id: string;
  checksum: string;
  appliedAt: string;
}

export interface Ledger {
  applied: LedgerEntry[];
}

// The ledger records what THIS environment has actually run, so it belongs
// next to the database it describes, not in version control. A missing file
// just means nothing has been applied yet, not an error.
export function loadLedger(path: string): Ledger {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return { applied: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`ledger file is not valid JSON: ${path}`);
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as Ledger).applied)
  ) {
    throw new Error(`ledger file is malformed: ${path}`);
  }

  return parsed as Ledger;
}

export function saveLedger(path: string, ledger: Ledger): void {
  const sorted: Ledger = {
    applied: [...ledger.applied].sort((a, b) => a.id.localeCompare(b.id)),
  };
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}
