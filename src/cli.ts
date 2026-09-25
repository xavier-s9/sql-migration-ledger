#!/usr/bin/env node
import {
  findSequenceGaps,
  initMigrationsDir,
  loadMigrations,
  readMigrationSql,
  checksumFile,
  downMigrationPath,
  hasDownMigration,
  readDownMigrationSql,
  type MigrationFile,
} from './migrations';
import { loadLedger, saveLedger, type Ledger } from './ledger';
import { loadConfig } from './config';

const DEFAULT_DIR = 'migrations';
const DEFAULT_LEDGER = '.sqlmigrate-ledger.json';

interface ParsedArgs {
  command: string;
  dir: string;
  ledgerPath: string;
  json: boolean;
  rest: string[];
}

// Precedence, highest first: an explicit --dir/--ledger flag, then the
// config file, then the hard-coded defaults.
function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest0] = argv;
  let dir: string | undefined;
  let ledgerPath: string | undefined;
  let json = false;
  const rest: string[] = [];

  for (let i = 0; i < rest0.length; i++) {
    const arg = rest0[i];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--dir') {
      dir = rest0[++i];
    } else if (arg === '--ledger') {
      ledgerPath = rest0[++i];
    } else {
      rest.push(arg);
    }
  }

  const config = loadConfig();

  return {
    command: command ?? 'help',
    dir: dir ?? config.dir ?? DEFAULT_DIR,
    ledgerPath: ledgerPath ?? config.ledger ?? DEFAULT_LEDGER,
    json,
    rest,
  };
}

type MigrationState = 'applied' | 'pending' | 'modified' | 'missing';

interface StatusRow {
  id: string;
  sequence: number;
  state: MigrationState;
  appliedAt: string | null;
}

function buildStatus(migrations: MigrationFile[], ledger: Ledger): StatusRow[] {
  const appliedById = new Map(ledger.applied.map((entry) => [entry.id, entry]));
  const rows: StatusRow[] = [];

  for (const migration of migrations) {
    const entry = appliedById.get(migration.id);
    if (!entry) {
      rows.push({ id: migration.id, sequence: migration.sequence, state: 'pending', appliedAt: null });
      continue;
    }
    appliedById.delete(migration.id);
    const current = checksumFile(migration.filePath);
    rows.push({
      id: migration.id,
      sequence: migration.sequence,
      state: current === entry.checksum ? 'applied' : 'modified',
      appliedAt: entry.appliedAt,
    });
  }

  // Anything left in the map was marked applied but no longer has a file on
  // disk - renamed, deleted, or a ledger shared from a different checkout.
  for (const [id, entry] of appliedById) {
    rows.push({ id, sequence: -1, state: 'missing', appliedAt: entry.appliedAt });
  }

  return rows;
}

function runInit(args: ParsedArgs): void {
  const result = initMigrationsDir(args.dir);

  if (args.json) {
    process.stdout.write(JSON.stringify({ dir: args.dir, ...result }, null, 2) + '\n');
    return;
  }

  console.log(result.created ? `created ${args.dir}` : `${args.dir} already exists`);
  if (result.addedGitkeep) {
    console.log(`added ${args.dir}/.gitkeep so the empty directory can be committed`);
  }
}

function runStatus(args: ParsedArgs): void {
  const migrations = loadMigrations(args.dir);
  const ledger = loadLedger(args.ledgerPath);
  const rows = buildStatus(migrations, ledger);
  const gaps = findSequenceGaps(migrations);
  const pendingCount = rows.filter((row) => row.state === 'pending').length;

  if (args.json) {
    process.stdout.write(
      JSON.stringify({ migrations: rows, pendingCount, sequenceGaps: gaps }, null, 2) + '\n'
    );
    return;
  }

  if (rows.length === 0) {
    console.log(`no migrations found in ${args.dir}`);
    return;
  }

  for (const row of rows) {
    const appliedNote = row.appliedAt ? `  (applied ${row.appliedAt})` : '';
    console.log(`${row.state.padEnd(8)} ${row.id}${appliedNote}`);
  }

  console.log(`\n${pendingCount} pending, ${rows.length - pendingCount} accounted for`);
  if (gaps.length > 0) {
    console.log(`warning: gaps in sequence numbers: ${gaps.join(', ')}`);
  }
}

function runPlan(args: ParsedArgs): void {
  const migrations = loadMigrations(args.dir);
  const ledger = loadLedger(args.ledgerPath);
  const rows = buildStatus(migrations, ledger);

  const modified = rows.filter((row) => row.state === 'modified');
  if (modified.length > 0) {
    throw new Error(
      `refusing to plan: applied migration(s) changed on disk since they were marked applied: ${modified
        .map((row) => row.id)
        .join(', ')}`
    );
  }

  const pendingIds = new Set(rows.filter((row) => row.state === 'pending').map((row) => row.id));
  const pending = migrations.filter((migration) => pendingIds.has(migration.id));

  if (args.json) {
    const plan = pending.map((migration) => ({
      id: migration.id,
      file: migration.filePath,
      sql: readMigrationSql(migration),
    }));
    process.stdout.write(JSON.stringify({ pending: plan, count: plan.length }, null, 2) + '\n');
    return;
  }

  if (pending.length === 0) {
    console.log('-- nothing pending');
    return;
  }

  for (const migration of pending) {
    console.log(`-- ${migration.id}`);
    console.log(readMigrationSql(migration).replace(/\s+$/, ''));
    console.log('');
  }
}

function runMark(args: ParsedArgs): void {
  if (args.rest.length === 0) {
    throw new Error('mark requires one or more migration ids, or --all');
  }

  const useAll = args.rest.includes('--all');
  const requestedIds = args.rest.filter((id) => id !== '--all');

  const migrations = loadMigrations(args.dir);
  const ledger = loadLedger(args.ledgerPath);

  if (!useAll) {
    const known = new Set(migrations.map((migration) => migration.id));
    const unknown = requestedIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`unknown migration id(s): ${unknown.join(', ')}`);
    }
  }

  const appliedIds = new Set(ledger.applied.map((entry) => entry.id));
  const targets = useAll
    ? migrations.filter((migration) => !appliedIds.has(migration.id))
    : migrations.filter((migration) => requestedIds.includes(migration.id));

  const appliedAt = new Date().toISOString();
  for (const migration of targets) {
    ledger.applied = ledger.applied.filter((entry) => entry.id !== migration.id);
    ledger.applied.push({ id: migration.id, checksum: checksumFile(migration.filePath), appliedAt });
  }
  saveLedger(args.ledgerPath, ledger);

  if (args.json) {
    process.stdout.write(JSON.stringify({ marked: targets.map((m) => m.id) }, null, 2) + '\n');
    return;
  }

  if (targets.length === 0) {
    console.log('nothing to mark');
    return;
  }

  console.log(`marked ${targets.length} migration(s) as applied:`);
  for (const migration of targets) {
    console.log(`  ${migration.id}`);
  }
}

function runRevert(args: ParsedArgs): void {
  const migrations = loadMigrations(args.dir);
  const ledger = loadLedger(args.ledgerPath);

  let targetId: string;
  if (args.rest.length > 0) {
    targetId = args.rest[0];
  } else {
    if (ledger.applied.length === 0) {
      throw new Error('nothing is marked applied; nothing to revert');
    }
    targetId = ledger.applied.reduce((latest, entry) =>
      entry.appliedAt > latest.appliedAt ? entry : latest
    ).id;
  }

  const entry = ledger.applied.find((e) => e.id === targetId);
  if (!entry) {
    throw new Error(`migration ${targetId} is not marked applied`);
  }

  const migration = migrations.find((m) => m.id === targetId);
  if (!migration) {
    throw new Error(`migration ${targetId} has no file in ${args.dir}, so its down migration can't be found`);
  }

  if (!hasDownMigration(migration)) {
    throw new Error(`no down migration found for ${targetId} (expected ${downMigrationPath(migration)})`);
  }

  const sql = readDownMigrationSql(migration);
  ledger.applied = ledger.applied.filter((e) => e.id !== targetId);
  saveLedger(args.ledgerPath, ledger);

  if (args.json) {
    process.stdout.write(JSON.stringify({ reverted: targetId, sql }, null, 2) + '\n');
    return;
  }

  console.log(`-- ${targetId} (down)`);
  console.log(sql.replace(/\s+$/, ''));
  console.log('');
  console.log(`removed ${targetId} from the ledger - run the SQL above against your database`);
}

function printHelp(): void {
  console.log(`sqlmigrate - track which SQL migration files have been applied

This does not run SQL against a database. It compares a directory of
migration files against a local ledger and tells you what still needs
running, or hands you the raw SQL to pipe into whatever client you use.

usage:
  sqlmigrate init   [--dir <path>] [--json]
  sqlmigrate status [--dir <path>] [--ledger <path>] [--json]
  sqlmigrate plan   [--dir <path>] [--ledger <path>] [--json]
  sqlmigrate mark   <id...> | --all [--dir <path>] [--ledger <path>] [--json]
  sqlmigrate revert [id] [--dir <path>] [--ledger <path>] [--json]

defaults:
  --dir     migrations
  --ledger  .sqlmigrate-ledger.json

migration files must be named <sequence>_<description>.sql, e.g.
0001_create_users.sql. Down migrations use the same id with a
.down.sql suffix, e.g. 0001_create_users.down.sql.

revert prints the down SQL for a migration (the most recently applied
one if no id is given) and removes it from the ledger. Like plan and
mark, it never runs the SQL itself - pipe the output to your client.`);
}

function fail(json: boolean, message: string): never {
  if (json) {
    process.stdout.write(JSON.stringify({ error: message }, null, 2) + '\n');
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  process.exit(1);
}

function main(): void {
  const argv = process.argv.slice(2);

  try {
    const args = parseArgs(argv);

    switch (args.command) {
      case 'init':
        runInit(args);
        break;
      case 'status':
        runStatus(args);
        break;
      case 'plan':
        runPlan(args);
        break;
      case 'mark':
        runMark(args);
        break;
      case 'revert':
        runRevert(args);
        break;
      case 'help':
      case '--help':
        printHelp();
        break;
      default:
        process.stderr.write(`unknown command: ${args.command}\n\n`);
        printHelp();
        process.exitCode = 1;
    }
  } catch (err: unknown) {
    // args may not exist yet if parsing itself failed (e.g. a malformed
    // config file), so read --json straight off argv for error formatting.
    fail(argv.includes('--json'), err instanceof Error ? err.message : String(err));
  }
}

main();
