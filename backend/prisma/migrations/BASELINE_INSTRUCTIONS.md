# Baseline migration — one-time setup for production

**Read this BEFORE merging/deploying the commit that changes the Dockerfile from `prisma db push` to `prisma migrate deploy`.**

The production Railway Postgres database already has every table defined
in `schema.prisma` — it was built up over time via `prisma db push`. This
directory now contains a single baseline migration `0_init/migration.sql`
that represents the current schema as if it were being created from
scratch.

If we just deploy without telling Prisma that this migration has already
been applied, the next deploy will try to run `CREATE TABLE "User" …`
against a database that already has a `User` table and the deploy will
fail.

We fix this by marking the migration as already-applied **once**. Prisma
writes a row into its internal `_prisma_migrations` table, and from that
point on `migrate deploy` is a no-op until we add a new migration folder.

## What you need

- A Mac terminal.
- The **production** `DATABASE_URL` for Railway Postgres. You can grab
  this from the Railway dashboard:
    1. Open the Railway project.
    2. Click the Postgres service.
    3. Go to the **Variables** tab.
    4. Copy the value of `DATABASE_URL` (it starts with `postgresql://`).

  Don't paste it into a file or commit it anywhere.

## Steps (run these once, from your Mac)

```bash
cd /Users/deepakdhunna/Desktop/clutch-picks-github/backend

# 1. Temporarily export the production URL so prisma uses it.
#    The leading space keeps the command out of your shell history on
#    most zsh/bash setups.
 export DATABASE_URL="postgresql://...paste-the-prod-url..."

# 2. Mark the 0_init baseline as already applied.
#    This only writes to _prisma_migrations — no schema changes.
bunx prisma migrate resolve --applied 0_init

# 3. Verify.
bunx prisma migrate status
```

Expected output from step 3:

```
Database schema is up to date!
```

(Older Prisma versions may say "No pending migrations to apply." — that's
also fine. What matters is that it does NOT say "following migrations
have not yet been applied" or "drift detected".)

## After verification

```bash
# 4. Clear the prod URL from your shell so you don't accidentally run
#    other commands against production.
unset DATABASE_URL
```

You're done. Future deploys will run `prisma migrate deploy`, which only
applies new committed migrations under `backend/prisma/migrations/`. If
the folder has no new migrations, deploy is a no-op for the schema.

## If step 3 reports drift

"Drift detected" means the live database has schema that isn't described
by any migration — most likely a column that was added by `prisma db
push` at some point but isn't in the current `schema.prisma`, or
vice-versa. Do **not** run `migrate reset` (it drops the database).

Instead, stop and share the full output. The fix is to generate a small
corrective migration with `prisma migrate diff` before the deploy.

## Adding new schema changes after baseline

From this point on, the workflow is:

```bash
cd backend
# edit prisma/schema.prisma as needed
bunx prisma migrate dev --name short_description
# commit the new migration folder
```

Never run `prisma db push` against production again.
