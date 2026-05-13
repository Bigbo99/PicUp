---
name: picup-release-workflow
description: Use when releasing or deploying PicUp through the standard workflow: review local changes, run local typecheck and production build, verify the app with local Docker, then push to GitHub so Actions builds and pushes the ACR image and the server pulls and deploys it.
---

# PicUp Release Workflow

Use this skill for PicUp releases when the goal is to validate locally first and let GitHub Actions handle image build and production deployment.

## Trigger

Use this skill when the user asks to:

- release or deploy PicUp
- run the full local-test to GitHub to production flow
- verify local Docker before pushing
- push current changes and let Actions deploy

## Workflow

1. Review the local git diff for the intended release scope.
2. Run the local release checks:
   `pwsh .codex/skills/picup-release-workflow/scripts/local-release-check.ps1`
3. If checks pass, commit and push to `main`.
4. GitHub Actions should then:
   - run `check`
   - build and push the image to Aliyun ACR
   - SSH to the server and deploy with `docker compose pull` and `up -d --no-build --force-recreate`
5. Verify deployment from the server:
   `pwsh .codex/skills/picup-release-workflow/scripts/server-deploy-check.ps1`

## Important constraints

- Prefer local or CI build. Do not build the production image on the server unless the user explicitly asks.
- Keep production pulls pointed at Aliyun ACR:
  `crpi-dcv2ij8qo3puovop.cn-hangzhou.personal.cr.aliyuncs.com/dani_repo/picup`
- The production server should keep `APP_IMAGE` in `.env`, but deployments may temporarily override it with an immutable `sha-xxxxxxx` tag for exact releases.
- After deployment, clean stale Docker data with the existing workflow or deployment script. Do not prune volumes.

## Local validation expectations

The local release check script should pass all of these:

- `pnpm typecheck`
- `pnpm build`
- `docker compose up -d --build`
- API health on `http://localhost:4000/api/health`
- Web responds on `http://localhost:3000`

## Production verification expectations

The server deploy check script confirms:

- `/opt/PicUp` is on the expected commit or newer
- `APP_IMAGE` points to ACR
- `docker compose ps` shows `api`, `web`, `worker`, `postgres`, `redis` running
- API health is good on the server and through the public domain

## Notes

- If GitHub Actions fails before deploy, check the workflow logs first instead of changing the server manually.
- If the image exists in ACR but deploy did not run, it is acceptable to manually complete the server pull and recreate step.
