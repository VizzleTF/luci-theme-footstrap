---
name: footstrap-deploy
description: Push edited luci-theme-footstrap files to the dev router and bump the cache so a plain F5 shows them. Use after editing cascade.css, ucode templates, menu-JS or the dashboard include, instead of hand-writing scp + cache commands. Deploys only changed files by default; does not change or re-register the active theme. Triggers: "deploy", "залей", "закинь на роутер", "push to router", "sync theme".
---

# footstrap-deploy

Incremental deploy to the dev router (`ssh router`). Maps repo paths to router
paths automatically (`htdocs/luci-static/*` → `/www/luci-static/*`, `ucode/*` →
`/usr/share/ucode/luci/*`, `root/*` → `/`), scps them, then bumps the cache-bust
token (`touch /lib/apk/db/installed`) and clears the dispatch cache
(`rm /tmp/luci-indexcache*`). **Does not** switch or register themes.

## Run

```sh
.claude/skills/footstrap-deploy/deploy.sh            # only files changed vs HEAD
.claude/skills/footstrap-deploy/deploy.sh <files...> # specific repo-relative files
.claude/skills/footstrap-deploy/deploy.sh --all      # every runtime file
```

Example: `.claude/skills/footstrap-deploy/deploy.sh htdocs/luci-static/footstrap/cascade.css`

## Notes

- First-time setup (new theme dirs / symlinks / theme registration) still needs
  `luci-theme-footstrap/dev-sync.sh`; this skill is for the fast edit→see loop.
- The screenshot reflects the router, so deploy **before** running
  `footstrap-preview`.
- Override the SSH host with `FOOTSTRAP_SSH=<host>`.
- Optional automation: a PostToolUse hook could call this on every Edit of a
  file under `luci-theme-footstrap/` — not enabled by default to avoid
  deploying half-finished edits; ask the user before wiring it in settings.json.
