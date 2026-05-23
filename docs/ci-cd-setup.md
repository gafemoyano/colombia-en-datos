# CI/CD Setup Guide

This project uses **GitHub Actions** for continuous integration and **Fly.io** for deployment.

## Workflows

| Workflow | File | Trigger | What it does |
|----------|------|---------|--------------|
| **CI** | `.github/workflows/ci.yml` | Push/PR to `main` or `dev` | Lint, type-check, and build |
| **Deploy** | `.github/workflows/deploy.yml` | Push to `main` | Deploy to Fly.io |

## Required GitHub Secrets

You need to add one secret to your GitHub repository:

### `FLY_API_TOKEN`

Generate a deploy token from your local machine:

```bash
flyctl tokens create deploy -x 999999h
```

Copy the output and add it to your repository:

**Settings → Secrets and variables → Actions → New repository secret**

- Name: `FLY_API_TOKEN`
- Value: `<the token from the command above>`

> **Tip:** The token never expires (`-x 999999h`). Rotate it periodically for security.

## Recommended branch protection

To ensure `main` is always deployable, enable branch protection:

1. Go to **Settings → Branches**
2. Add a rule for `main`
3. Enable:
   - **Require a pull request before merging**
   - **Require status checks to pass before merging**
   - Select the `check` status check from the CI workflow

This guarantees that the Deploy workflow only runs code that has passed linting and type-checking.

## How deployment works

1. You merge a PR to `main`
2. GitHub Actions runs the **CI** workflow (lint + type-check + build)
3. If CI passes, the **Deploy** workflow triggers automatically
4. Fly.io builds the Docker image remotely and updates the running machine
5. The Fly volume at `/data` persists across deploys (DuckDB data is untouched)

## Manual deployment

You can still deploy manually at any time:

```bash
flyctl deploy --app colombia-en-datos-webapp-dark-dust-4694
```

## Troubleshooting

### "failed to fetch an image or build from source"

Check the Fly builder status:
```bash
flyctl status --app colombia-en-datos-webapp-dark-dust-4694
```

### "invalid token"

Regenerate the token and update the `FLY_API_TOKEN` secret:
```bash
flyctl tokens create deploy -x 999999h
```

### Deploy succeeded but app shows old data

Remember: **code deploys do not update `observations.duckdb`**. If you need fresh data, rebuild the canonical store on the volume first:

```bash
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694 --command \
  'DATA_PATH=/data CANONICAL_DUCKDB_PATH=/data/observations.duckdb.next npm run canonical:rebuild'
flyctl ssh console --app colombia-en-datos-webapp-dark-dust-4694 --command \
  'mv /data/observations.duckdb.next /data/observations.duckdb'
flyctl machine restart 2865655f1633e8 --app colombia-en-datos-webapp-dark-dust-4694
```

See `docs/canonical-duckdb-deploy.md` for the full data update workflow.
