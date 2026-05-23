# Divergence Analysis: `main` vs `origin/main`

## 1. What diverged

Your local `main` is **1 merge commit + 1 commit ahead** of `origin/main`.

```
origin/main: 9b1d9a5f update landing
local main:  39eec42f Merge branch 'staged-stuff'
                    └─ 3d0a67fe staged stuff here
```

The full diff adds **+1,557 lines / -32 lines** across 16 files. See `STAGED_CHANGES_SUMMARY.md` for the detailed feature breakdown (canonical DuckDB store, Phase 1 registry schema, multi-geo Explorer support, Antioquia code fix, etc.).

---

## 2. The Data-Volume Gap

You want to stop embedding `observations.duckdb` in the Docker image and use **Fly.io Data Volumes** as the primary store. Here's where you stand:

### ✅ Already in place

| Layer | Status |
|-------|--------|
| **Volume mount** | `fly.toml` already mounts `indicator_data` → `/data` |
| **Env var** | `fly.toml` already sets `DATA_PATH=/data` |
| **Runtime resolution** | `src/lib/server/duckdb.ts` already looks at `$DATA_PATH/observations.duckdb` **before** falling back to the packaged `./data/observations.duckdb` |
| **Safe rebuild scripts** | `create-canonical-store.ts` supports `CANONICAL_DUCKDB_PATH` and builds atomically to a temp file |
| **Validation** | `validate-canonical-store.ts` can verify a volume file before promotion |

### ❌ Still coupling data to the image

| Issue | Location |
|-------|----------|
| **DuckDB copied into image** | `Dockerfile` line: `COPY --from=build /app/data/observations.duckdb ./data/observations.duckdb` |
| **Docs treat volume as "Option B"** | `docs/canonical-duckdb-deploy.md` presents packaged deploy (Option A) as the "simplest and safest current workflow" |
| **Silent fallback to stale package** | If `/data/observations.duckdb` is missing, the app falls back to the embedded copy. This hides volume problems and can serve stale data. |
| **No bootstrapping story** | If a new machine gets a fresh empty volume, the app has no embedded copy to seed from, so it will fail or (today) silently fall back. |

---

## 3. What "fully using Fly Volumes" looks like

Fly.io volumes are **persistent block storage tied to a specific machine**. They are meant for state that outlives container restarts and should not be baked into images.

For your architecture, the ideal end-state is:

1. **Image contains no DuckDB data** — Only code, static assets, and metadata.
2. **Volume is the sole source of truth** — `/data/observations.duckdb` is read at runtime.
3. **Fast failure on missing volume** — If the file is absent, the app errors loudly at startup (health check fails, Fly replaces the machine).
4. **Data updates without code deploys** — Rebuild the DB on the volume, `mv` it into place, restart. No Docker build needed.
5. **Single-machine architecture (for now)** — Because you have **one volume** (`indicator_data`) and `auto_stop_machines = 'off'`, you are implicitly running a single persistent machine. This is fine for a read-heavy DuckDB workload, but be aware: scaling to multiple machines requires either **one volume per machine** (replicated data) or moving to a shared service (e.g. MotherDuck, S3 + remote DuckDB).

---

## 4. Recommended changes to close the gap

### A. Remove the embedded DuckDB from the Dockerfile

```dockerfile
# REMOVE this line from Dockerfile
# COPY --from=build /app/data/observations.duckdb ./data/observations.duckdb
```

This breaks the image→data coupling and shrinks the image.

### B. Make the volume path mandatory (fail fast)

In `src/lib/server/duckdb.ts`, change `getCanonicalDbPath()` so that when `DATA_PATH` or `CANONICAL_DUCKDB_PATH` is set, it **only** looks there. Remove the silent fallback to `./data/observations.duckdb`.

**Why:** If the volume mount fails or the file is missing, you want a 500/health-check failure immediately, not a quiet fallback to a stale or non-existent embedded file.

```ts
export function getCanonicalDbPath(): string {
	if (process.env.CANONICAL_DUCKDB_PATH) {
		return resolve(process.env.CANONICAL_DUCKDB_PATH);
	}
	if (process.env.DATA_PATH) {
		return join(resolve(process.env.DATA_PATH), 'observations.duckdb');
	}
	// Local dev fallback only
	return join(process.cwd(), 'data', 'observations.duckdb');
}
```

(Optionally add an `existsSync` check at server startup and throw if the file is missing in production.)

### C. Bootstrap the volume on first deploy

Since the image no longer carries the DB, a fresh volume will be empty. You have two patterns:

**Pattern 1: Manual seed (recommended for now)**

Before deploying the "no-embedded-db" image, SSH into the machine and place an initial `observations.duckdb` on the volume:

```bash
# Build locally
npm run canonical:rebuild

# Upload to volume
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694
# Then inside the machine:
mkdir -p /data
# (use `flyctl sftp` or a one-off `flyctl ssh console` with curl to place the file)
```

**Pattern 2: Startup copy hook**

Keep a **template** DB in the image (e.g. `./data/observations.duckdb.template`), and in `src/hooks.server.ts` or a SvelteKit server init hook, copy it to the volume if missing:

```ts
import { copyFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

function bootstrapCanonicalDb() {
	const dataPath = process.env.DATA_PATH;
	if (!dataPath) return;
	const target = join(resolve(dataPath), 'observations.duckdb');
	if (existsSync(target)) return;
	const template = join(process.cwd(), 'data', 'observations.duckdb.template');
	if (existsSync(template)) {
		copyFileSync(template, target);
		console.log('[bootstrap] Seeded canonical DB from template to', target);
	}
}
```

This is safer than keeping the full embedded copy because:
- The template is explicitly named `.template`
- The runtime code always reads from the volume path
- You can update the volume independently of the template

**Recommendation:** Use **Pattern 1** (manual seed) for now. It is simpler and matches Fly's mental model: volumes are persistent disks you manage separately from ephemeral containers.

### D. Update the deployment docs

Rewrite `docs/canonical-duckdb-deploy.md` to:

- Remove "Option A — packaged DuckDB via normal deploy"
- Make "rebuild on the Fly volume" the standard workflow
- Document the bootstrapping step for new volumes
- Add a note about single-machine constraints (one volume = one machine)

### E. Add a startup health / readiness check

Consider adding a lightweight check in `src/hooks.server.ts` or a `+server.ts` health endpoint that verifies the canonical DB is readable:

```ts
// src/routes/api/health/+server.ts
import { runCanonicalQuery } from '$lib/server/duckdb';
import { json } from '@sveltejs/kit';

export const GET = async () => {
	try {
		await runCanonicalQuery('SELECT 1');
		return json({ status: 'ok', canonicalDb: true });
	} catch (e) {
		return json({ status: 'error', canonicalDb: false }, { status: 503 });
	}
};
```

Fly can use this as a `http_service.checks` target to ensure machines are not routed to until the DB is confirmed readable.

---

## 5. Files that need edits

| File | Change |
|------|--------|
| `Dockerfile` | Remove `COPY ... observations.duckdb` line |
| `src/lib/server/duckdb.ts` | Remove silent fallback to `./data/observations.duckdb` when `DATA_PATH` is set |
| `docs/canonical-duckdb-deploy.md` | Remove Option A, document volume-first workflow, add bootstrapping note |
| `fly.toml` | (Optional) Add `http_service.checks` pointing to `/api/health` |
| `src/routes/api/health/+server.ts` | (Optional) New health endpoint that checks canonical DB connectivity |
| `src/hooks.server.ts` | (Optional) Add bootstrap copy logic if you choose Pattern 2 |

---

## 6. Deployment sequence (recommended)

1. **Bootstrap the volume** with a current `observations.duckdb` (one-time):
   ```bash
   npm run canonical:rebuild
   # Upload data/observations.duckdb to /data on the Fly volume
   ```

2. **Apply code changes** (Dockerfile, duckdb.ts, docs).

3. **Deploy**:
   ```bash
   fly deploy --app colombia-en-datos-webapp-dark-dust-4694
   ```

4. **Verify** the app is reading from `/data/observations.duckdb`:
   ```bash
   flyctl logs | rg 'canonical store|observations.duckdb'
   ```

5. **Future data updates** (no code deploy):
   ```bash
   flyctl ssh console --command \
     'DATA_PATH=/data CANONICAL_DUCKDB_PATH=/data/observations.duckdb.next npm run canonical:rebuild'
   flyctl ssh console --command 'mv /data/observations.duckdb.next /data/observations.duckdb'
   flyctl machine restart <machine-id>
   ```

---

## Summary

The diverged code has done 80% of the work needed for Fly Volumes. The remaining 20% is **removing the Dockerfile COPY**, **making the volume path fail-fast**, and **documenting the volume-first workflow**. The big architectural decision is whether to add a startup bootstrap hook or to treat the volume as a managed disk that you seed manually.
