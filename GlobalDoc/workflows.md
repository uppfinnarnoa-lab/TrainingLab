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

# Database migrations
pnpm prisma migrate dev --name <migration-name>

# Push schema without migration (dev only)
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

## Production Deployment (Ubuntu + Apache)

```bash
# Build
pnpm build

# Start/restart with PM2
pm2 restart claudetrainer
# or first time:
pm2 start ecosystem.config.js

# View logs
pm2 logs claudetrainer

# DB migrations in production
pnpm prisma migrate deploy
```

Apache virtual host config is in `GlobalDoc/` and deployment guide in `IMPLEMENTATION_PLAN.md §9`.
SSL via Let's Encrypt (`certbot`). Streaming AI responses require `SetEnv proxy-sendchunked 1` in Apache config.

## Adding a New API Endpoint
1. Write the I/O doc in `docs/api/<name>.md` first (see `GlobalDoc/documentation-rules.md`)
2. Implement in `app/api/<path>/route.ts`
3. Add to `MEMORY.md` / relevant GlobalDoc if it changes the architecture

## Adding a New DB Model or Field
1. Edit `prisma/schema.prisma`
2. Run `pnpm prisma migrate dev --name <name>`
3. Update `GlobalDoc/architecture.md` schema table if the model is significant
4. Update any I/O docs in `docs/schemas/` that reference the model

## Updating the AI Context
Changes to what data is sent to the AI model go in `lib/ai/context-builder.ts` and must be reflected in `docs/schemas/ai-context.md`. The context doc is the authoritative spec — change it first.
