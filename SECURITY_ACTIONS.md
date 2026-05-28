# Security Actions — DO THESE BEFORE PUBLISHING / DEMOING

A Google Cloud service-account private key was previously committed to this repo at:

```
gen-lang-client-0994987899-401e21ffbaae.json
```

It has been moved to `.local-secrets/` (gitignored) so it will no longer be committed. **However, the key is still in git history.** If this repo is public, treat the key as fully compromised.

## Must-do checklist

### 1. Rotate the service-account key (5 minutes)

1. Open Google Cloud Console → IAM & Admin → Service Accounts
2. Find the account for project `gen-lang-client-0994987899`
3. Open the "Keys" tab
4. **Disable** the key with ID starting `401e21ffbaae...`
5. **Create a new key** (JSON), download it
6. Save the new key to `.local-secrets/` (already gitignored)
7. Update Fly.io secrets:
   ```bash
   fly secrets set VERTEX_SERVICE_ACCOUNT_JSON="$(cat .local-secrets/your-new-key.json)" --app dealer-social-post-ai-production
   ```
8. After confirming production still works (test video generation), **delete** the old key in GCP Console.

### 2. Scrub the leaked key from git history (15 minutes)

The key is still in your git history at HEAD and every prior commit. Anyone who has cloned this repo (or who scrapes GitHub for leaked keys) already has it. After rotation (step 1), scrub history so you don't ship the dead key to future contributors:

```bash
# Install git-filter-repo if you don't have it
brew install git-filter-repo

# From the repo root:
git filter-repo --path gen-lang-client-0994987899-401e21ffbaae.json --invert-paths --force

# Force-push to GitHub (this rewrites history — everyone with a clone must re-clone)
git push origin --force --all
git push origin --force --tags
```

### 3. Verify

```bash
git log --all --full-history -- gen-lang-client-0994987899-401e21ffbaae.json
# Should return nothing
```

Then visit your GitHub repo and confirm the file is no longer searchable in the file tree or in any historical commit.

## What was changed automatically

- Moved `gen-lang-client-0994987899-401e21ffbaae.json` → `.local-secrets/` (no longer in repo working tree).
- Updated `.gitignore` to catch all common service-account naming patterns (`gen-lang-client-*.json`, `*-service-account*.json`, `*serviceaccount*.json`, `.local-secrets/`, `.secrets/`, `*.pem`, `*.p12`, `credentials.json`, `*-credentials.json`).

## Going forward

- Production reads credentials from the `VERTEX_SERVICE_ACCOUNT_JSON` env var (set as a Fly.io secret). See `entrypoint.sh` and `pb_hooks/main.pb.js`.
- For local dev, `pb_hooks/main.pb.js` falls back to reading `pb_hooks/vertex_key.json` if the env var isn't set. Copy your new key there for local testing (it's already gitignored).
- Never commit a `.json` file with the words `private_key` in it. Run `git diff --cached` before every commit.
