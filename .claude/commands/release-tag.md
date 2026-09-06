---
description: Wait for a core push to propagate to a version branch, then cut and push its next release tag
argument-hint: [branch] [version]
---

Cut a new release for a Minecraft-version branch after a `core` push, once the pin-bump automation has
caught up. Version branches: `1.7.10`, `1.12.2`, `1.20.1`, `1.21.1`.

**Arguments** (`$ARGUMENTS`): an optional branch name (default `1.7.10`), optionally followed by an
explicit version to tag (e.g. `1.20.1 2.1.0`) - only needed the first time a branch is released, since
after that the version is inferred (see step 3).

## Background

Pushing to `core` triggers `build-and-test.yml`. Once that succeeds, `update-core-pins.yml` fires (via a
`workflow_run` trigger) and pushes an `Update core pin to <12-char-sha>` commit to every version branch,
bumping its `core` submodule pin to the new `core` HEAD - this can take a minute or two after the initial
push, and runs as a separate, later workflow. Only once that commit has landed on the target branch is
there anything new worth releasing.

A release is just an annotated tag matching `<semver>-forge-<branch>` (e.g. `2.0.4-forge-1.7.10`) pushed
to that branch's HEAD. `release-tags.yml` (`on: push: tags: '*'`) then runs the shared
`GTNH-Actions-Workflows` release build for it. Tags carrying extra words (`-alpha-`, `-pre-`,
`-GTNH-Native-Fluids-Support-pre-`, etc.) are historical pre-release markers - ignore them when picking
the next version; only bump from the latest **clean** `X.Y.Z-forge-<branch>` tag.

## Steps

1. **Resolve the target branch** from `$ARGUMENTS` (default `1.7.10`). Confirm it's one of the four
   version branches above; ask the user if it's anything else or ambiguous.

2. **Wait for the pin bump to land.**
   - `git fetch origin --quiet`
   - `CORE_SHA12=$(git rev-parse --short=12 origin/core)`
   - Poll (every ~20-30s, via the Monitor tool's until-loop or a short `ScheduleWakeup`, not a busy
     `sleep` loop in one Bash call) until `git log -1 --format=%s origin/<branch>` (after re-fetching
     that branch each time) equals `Update core pin to $CORE_SHA12`.
   - While waiting, you may sanity-check progress with
     `gh run list --workflow=build-and-test.yml --branch core --limit 3` and
     `gh run list --workflow=update-core-pins.yml --limit 3` - but the commit-message match above is the
     actual source of truth, not the run list.
   - If `build-and-test.yml` for that `core` commit fails, stop and report it - do not tag a branch whose
     pin update didn't happen (or happened against a failing build).

3. **Determine the next version**, unless the user passed one explicitly in `$ARGUMENTS`:
   - `git tag -l | grep -- "-forge-<branch>\$"` (or `git ls-remote --tags origin` if the local tag list
     might be stale), filtered to tags matching exactly `^[0-9]+\.[0-9]+\.[0-9]+-forge-<branch>$` (no
     extra words), sorted with `sort -V`, and take the highest.
   - Bump its patch component by 1 (e.g. `2.0.3` -> `2.0.4`).
   - If no clean tag exists yet for this branch (e.g. `1.21.1` today), do not guess - ask the user what
     version to start at.

4. **Create and push the tag** on the branch's new HEAD (the pin-bump commit from step 2):
   - `git tag -a <version>-forge-<branch> origin/<branch> -m "<version>-forge-<branch>"`
   - `git push origin <version>-forge-<branch>`
   - This is the one genuinely irreversible/visible step (it kicks off a public release build) - if
     anything in steps 1-3 was ambiguous or surprising, surface it to the user before pushing rather than
     guessing past it.

5. **Confirm the release build started**: `gh run list --limit 3` should show a `Release tagged build`
   run with the new tag as its head branch. Report the run's URL back to the user; only `gh run watch`
   it to completion if the user's invocation of this command implied they want to wait for that too.
