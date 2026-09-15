import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

// 0001_create_users.sql - a leading numeric sequence, an underscore, then a
// snake_case description. Down migrations use the same prefix plus .down.sql
// and are intentionally skipped here; nothing reads them yet.
const FILENAME_PATTERN = /^(\d{4,})_([a-z0-9_]+)\.sql$/;

export interface MigrationFile {
  id: string;
  sequence: number;
  description: string;
  filePath: string;
}

export interface InitResult {
  created: boolean;
  addedGitkeep: boolean;
}

// A freshly created directory has nothing in it for git to track, so drop a
// .gitkeep in it - otherwise `init` looks like it did nothing once the repo
// is cloned elsewhere.
export function initMigrationsDir(dir: string): InitResult {
  const created = !existsSync(dir);
  mkdirSync(dir, { recursive: true });

  const addedGitkeep = readdirSync(dir).length === 0;
  if (addedGitkeep) {
    writeFileSync(join(dir, '.gitkeep'), '', 'utf8');
  }

  return { created, addedGitkeep };
}

export function loadMigrations(dir: string): MigrationFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      throw new Error(`migrations directory not found: ${dir}`);
    }
    throw err;
  }

  const migrations: MigrationFile[] = [];
  for (const name of entries) {
    if (name.endsWith('.down.sql')) continue;
    const match = FILENAME_PATTERN.exec(name);
    if (!match) continue;
    const [, sequenceText, description] = match;
    migrations.push({
      id: name.slice(0, -'.sql'.length),
      sequence: Number.parseInt(sequenceText, 10),
      description,
      filePath: join(dir, name),
    });
  }

  migrations.sort((a, b) => a.sequence - b.sequence);

  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.sequence)) {
      throw new Error(`duplicate migration sequence number: ${migration.sequence}`);
    }
    seen.add(migration.sequence);
  }

  return migrations;
}

export function readMigrationSql(migration: MigrationFile): string {
  return readFileSync(migration.filePath, 'utf8');
}

export function checksumFile(filePath: string): string {
  const contents = readFileSync(filePath, 'utf8');
  return 'sha256:' + createHash('sha256').update(contents).digest('hex');
}

// A gap usually means a migration was deleted after being committed, or two
// branches picked the same next number and one got renumbered. Either way
// it's worth a warning rather than a silent skip.
export function findSequenceGaps(migrations: MigrationFile[]): number[] {
  const gaps: number[] = [];
  for (let i = 1; i < migrations.length; i++) {
    const previous = migrations[i - 1].sequence;
    const current = migrations[i].sequence;
    for (let sequence = previous + 1; sequence < current; sequence++) {
      gaps.push(sequence);
    }
  }
  return gaps;
}
