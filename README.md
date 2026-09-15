# sqlmigrate

A command-line tool that keeps track of which SQL migration files have
been applied, without owning a database connection.

## Why

Most migration tools want to open a connection to your database and run
the SQL themselves, which means picking a driver: pg for Postgres,
mysql2 for MySQL, better-sqlite3 for SQLite, and so on. That's a
reasonable design, but it ties the tool to whichever database and
driver version you happen to be using, and it's overkill if all you
actually want is to know "what's pending" and get the SQL to run it
yourself with whatever client is already on the machine (psql,
sqlite3, mysql).

sqlmigrate does the bookkeeping part only:

- it scans a directory of numbered `.sql` files
- it keeps a small JSON ledger of which ones have been applied, keyed
  by a checksum of the file contents
- it tells you what's pending, and can print the SQL for those files
  so you can pipe it straight into a database client

It never opens a socket. Applying the SQL is still your job.

## Migration files

Files live in a `migrations/` directory (configurable) and are named:

```
<sequence>_<description>.sql
```

for example:

```
migrations/0001_create_users.sql
migrations/0002_add_users_email_index.sql
```

The sequence number just needs to sort correctly; zero-padding to four
digits is a convention, not a requirement enforced beyond "digits, at
least four of them."

## Usage

Set up a fresh project:

```
$ sqlmigrate init
created migrations
added migrations/.gitkeep so the empty directory can be committed
```

Running `init` again once the directory already has files in it is a
no-op:

```
$ sqlmigrate init
migrations already exists
```

Check what's applied and what's pending:

```
$ sqlmigrate status
applied  0001_create_users  (applied 2026-09-01T10:15:00.000Z)
pending  0002_add_users_email_index

1 pending, 1 accounted for
```

Same thing as JSON, for scripts and CI:

```
$ sqlmigrate status --json
{
  "migrations": [
    { "id": "0001_create_users", "sequence": 1, "state": "applied", "appliedAt": "2026-09-01T10:15:00.000Z" },
    { "id": "0002_add_users_email_index", "sequence": 2, "state": "pending", "appliedAt": null }
  ],
  "pendingCount": 1,
  "sequenceGaps": []
}
```

Get the SQL for everything pending, ready to hand to a real client:

```
$ sqlmigrate plan | psql "$DATABASE_URL"
```

Or as JSON, if you want to inspect it before running anything:

```
$ sqlmigrate plan --json
{
  "pending": [
    { "id": "0002_add_users_email_index", "file": "migrations/0002_add_users_email_index.sql", "sql": "CREATE INDEX ...\n" }
  ],
  "count": 1
}
```

Once you've actually run a migration against the database, record it:

```
$ sqlmigrate mark 0002_add_users_email_index
marked 1 migration(s) as applied:
  0002_add_users_email_index
```

or mark everything currently pending in one go:

```
$ sqlmigrate mark --all
```

`plan` refuses to run (non-zero exit, `error` field in JSON mode) if a
migration that was already marked applied has changed on disk since -
that mismatch almost always means the ledger and the database have
drifted apart and needs a human to look at it before anything else
runs.

## The ledger

By default state is kept in `.sqlmigrate-ledger.json` next to wherever
you run the command. It records the applied migration ids, a sha256 of
their contents at the time they were marked, and a timestamp. This
file describes one specific database, not "the project," so it should
not be committed - it's already in `.gitignore`.

## Building

There are no runtime dependencies. Compile with a TypeScript compiler
you already have installed:

```
tsc
node dist/cli.js status
```

## Flags

Every command accepts:

- `--dir <path>` - migrations directory (default `migrations`)
- `--ledger <path>` - ledger file path (default `.sqlmigrate-ledger.json`)
- `--json` - machine-readable output instead of the human-readable text above

## License

MIT, see [LICENSE](LICENSE).
