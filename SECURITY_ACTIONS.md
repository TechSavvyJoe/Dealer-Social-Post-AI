# Security actions required before deployment

Historical repository versions contained live provider and administrative credentials. Treat every exposed value as compromised even though the current tree no longer contains it.

## Mandatory rotation

Rotate and revoke all historically exposed credentials before publishing or deploying:

- Gemini API keys;
- Google Cloud service-account keys;
- PocketBase administrator credentials;
- proxy access tokens;
- dealer and administrator login codes.

Store replacements only in the deployment secret manager or a local git-ignored secret store. The active application uses `GEMINI_API_KEY`; generic Vertex browser routes are disabled and no Vertex service-account key is required for this release.

## Purge repository history

After rotation, remove credential files and literals from every Git ref with a reviewed `git filter-repo` plan. Rewriting history affects every collaborator, clone, tag, fork, cache, and mirror, so coordinate it explicitly and require fresh clones afterward.

Verify the rewritten repository with both history searches and the current-tree gate:

```bash
git log --all --full-history -- '*.json' '*.env*' '*.pem'
npm run security:secrets
```

Also search the hosting provider, CI logs/artifacts, shell transcripts, shared screenshots, and deployment logs. Deleting a file from the current branch does not revoke its credential or remove historical copies.

## Release gate

Do not deploy until rotation and history cleanup are complete, a verified Fly volume/database snapshot exists, and the backend health/session/provider checks pass on the real production path. Disable Vercel's independent production auto-promotion, or make it require the successful Fly readiness job, so frontend and backend revisions cannot split.
