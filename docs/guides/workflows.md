# Workflows

## Git Routine (mandatory every session)

```bash
# Start of session — always
git pull

# End of session — always (stage specific files, not git add -A)
git add <file1> <file2>
git commit -m "descriptive message"
git push
```

Never commit `.env.local` or any file containing secrets.
Prefer one focused commit per logical change over large omnibus commits.

## Development

```bash
# Install dependencies
pnpm install

# Start dev server (http://localhost:3000)
pnpm dev

# Type check
pnpm tsc --noEmit

# Apply schema changes (this project has no migration files — db push only, in dev and prod alike)
pnpm prisma db push

# Open Prisma Studio (DB browser)
pnpm prisma studio

# Generate Prisma client after schema changes
pnpm prisma generate
```

## Environment Variables
Copy `.env.example` to `.env.local` and fill in values. Required vars:

```
DATABASE_URL
NEXTAUTH_SECRET
NEXTAUTH_URL
STRAVA_CLIENT_ID
STRAVA_CLIENT_SECRET
STRAVA_REDIRECT_URI
GARMIN_CLIENT_ID         # from Garmin Health API developer portal
GARMIN_CLIENT_SECRET
GOOGLE_AI_API_KEY        # optional default; users can set own key in UI
ANTHROPIC_API_KEY        # optional default; users can set own key in UI
```

## Production Deployment (Ubuntu + nginx)

See [`deployment/README.md`](../../deployment/README.md) for the full setup guide and update procedure — don't duplicate it here. Routine update after pushing to main:

```bash
cd /var/www/traininglab && git pull --ff-only && pnpm exec next build --no-lint && pm2 reload traininglab --update-env
```

## Adding a New API Endpoint
1. Write the I/O doc in `docs/api/<name>.md` first (see [`documentation-rules.md`](documentation-rules.md))
2. Implement in `app/api/<path>/route.ts`

## Adding a New DB Model or Field
1. Edit `prisma/schema.prisma`
2. Run `pnpm prisma db push` (no migration files in this project — see `deployment/README.md` §14 for schema safety rules)
3. Update [`docs/architecture/overview.md`](../architecture/overview.md) schema table if the model is significant
4. Update any I/O docs in `docs/schemas/` that reference the model

## Updating the AI Context
Changes to what data is sent to the AI model go in `lib/ai/context-builder.ts` and must be reflected in `docs/schemas/ai-context.md`. The context doc is the authoritative spec — change it first.
