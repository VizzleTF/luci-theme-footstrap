# Running the checks locally

How to run `tools/e2e.mjs`, `tools/anchor-check.mjs` and `tools/anchor-mutants.mjs` on the owlab
dev routers, from the repo root. For anyone about to push a change.
What the checks prove and what fails a page: [verifying.md](verifying.md).

## Contents

- [Run e2e on both routers](#run-e2e-on-both-routers)
- [Run the anchoring check on its own](#run-the-anchoring-check-on-its-own)
- [Check that the anchoring check can fail at all](#check-that-the-anchoring-check-can-fail-at-all)

## Run e2e on both routers

Run these from the repo root. Only `owrt2512` and `owrt2410` are needed, not every router in
`owlab.yaml`.

1. Build the package with a version above any release, so e2e's step 3 is an upgrade
   ([the e2e steps](verifying.md#what-the-check-proves)):

   ```sh
   FOOTSTRAP_VERSION=9999.0.0 ./tools/stage.sh && owfeed build   # above any release: step 3 is an upgrade
   ```

   `FOOTSTRAP_VERSION` applies to `./tools/stage.sh` alone. It writes the version into
   `dist/VERSION`, which `owfeed build` packages. Expected:
   `dist/noarch/luci-theme-footstrap-9999.0.0-r1.apk` and
   `dist/all/luci-theme-footstrap_9999.0.0-r1_all.ipk`.

2. Download the last release into an empty directory:

   ```sh
   rm -rf ../tmp/old-apk && gh release download --repo VizzleTF/luci-theme-footstrap \
     --pattern 'luci-theme-footstrap-*.apk' --dir ../tmp/old-apk
   ls ../tmp/old-apk
   ```

   With no tag, `gh release download` takes the latest release. Expected: `ls` prints one file.
   `--old` takes one file: a glob that matches two expands to an extra argument, and
   `tools/e2e.mjs` stops with a parse error. If `ls` prints several, pass the one you want by its
   full name instead of the glob.

3. Start the router without the theme:

   ```sh
   owlab up --rebuild owrt2512
   ```

   `--rebuild` is a factory reset. A plain `owlab up owrt2512` is enough only on a router you never
   synced: it reuses the container, theme included.

4. Run the check:

   ```sh
   node tools/e2e.mjs --router owrt2512 --old ../tmp/old-apk/luci-theme-footstrap-*.apk \
     --new dist/noarch/luci-theme-footstrap-[0-9]*.apk
   ```

   Expected: `PASS` on every step, and exit code 0. Without `--no-anchor`, this also runs
   `tools/anchor-check.mjs` at the end of e2e's step 4, while footstrap is active.

5. Do the same on `owrt2410`, with the ipk packages:

   ```sh
   rm -rf ../tmp/old-ipk && gh release download --repo VizzleTF/luci-theme-footstrap \
     --pattern 'luci-theme-footstrap_*_all.ipk' --dir ../tmp/old-ipk
   ls ../tmp/old-ipk
   owlab up --rebuild owrt2410
   node tools/e2e.mjs --router owrt2410 --old ../tmp/old-ipk/luci-theme-footstrap_*_all.ipk \
     --new dist/all/luci-theme-footstrap_[0-9]*_all.ipk
   ```

6. Put the working tree back with `owlab sync`. e2e leaves the package installed, with bootstrap
   active.

**Done means both: 25.12/apk and 24.10/opkg.** Say which one a run covered.

The router must not carry the theme yet:

- Use a fresh `owlab up`, or `owlab up --rebuild` after a sync. The run's first step fails on a router that already has
  `/www/luci-static/footstrap`.
- The `theme:` setting in `owlab.yaml` may point LuCI at a theme that is not installed. The run
  resets it to bootstrap rather than judging it.
- The run installs, removes and switches themes on the router. `owlab sync` afterwards puts the
  working tree back.

| e2e exit code | Meaning |
|---|---|
| 0 | Every step passed. |
| 1 | Otherwise. |
| 2 | Bad arguments, or a router that is not running. |

The output and screenshots land in `--out`, by default `../tmp/e2e-<router>`.

CI runs the crawl (`e2e`) and the anchoring check (`anchor`) as two jobs per router, side by side.
The log prints each pass's time. A change that touches documentation alone skips the steps of both
(`tools/ci-package-changed.sh`).

## Run the anchoring check on its own

It runs against any running router with footstrap active, an `owlab sync`ed one included. The
flags in brackets are optional:
`node tools/anchor-check.mjs --router owrt2512 [--engines webkit] [--widths 390]`.

It switches the theme to bootstrap for its reference cells and back to footstrap. Footstrap's cells
run one engine at a time. Bootstrap's run as one phase across the engines, the same six pages' load.

When every failure is a cell that measured nothing, the whole check runs once more. The log says
`MEASURED NOTHING` first, in a `::warning` line CI shows as an annotation.

A stand that stops answering mid-measure counts as such a run. The rerun first waits up to a minute
for LuCI. Stops answering means any of these:

- no answer to a navigation or the login while LuCI's root stays silent for a minute;
- a `docker exec` that does not return in 60 s;
- a `docker exec` that Docker refuses;
- a `docker exec` that its container's stop cuts short.

A navigation that times out while the root answers measured nothing too, but is no outage. Theme
code can hold the load in WebKit or Firefox, which only this check runs. That fails as a finding
when the rerun meets it again.

Every measurement starts from the leases the run found, whatever the last one left on the router. A
measurement that fails puts footstrap and the leases back.

When a stopped stand refuses that too, the failure keeps its own cause. Only a navigation that timed
out while the root answered becomes the stand's.

A failure that measured something is never rerun.

| anchor-check exit code | Meaning |
|---|---|
| 0 | Pass. |
| 1 | Failure. |
| 2 | The router is not running or has no lease. |
| 3 | The stand stopped answering before the first measurement or in the rerun. Nothing was judged. |

In CI:

- Exit 1 is an `::error` titled `Scroll anchoring <router>`.
- Exit 3 is an `::error` titled `Upstream outage (safe to rerun)`.
- A check that crashes exits 1 with its stack. A crash is an error that is neither a finding nor the
  stand's. It gets an `::error` titled `Scroll anchoring <router>`, like a finding's, whose message
  starts `anchor-check crashed`.
- CI measures once more on a fresh router after a 2 or a 3.
- There an exit other than 0 and 3 leaves `::error title=Scroll anchoring on <router>` too. So the
  first 3's title does not make the job read as an outage.

## Check that the anchoring check can fail at all

```sh
node tools/anchor-mutants.mjs --router owrt2512
```

It puts known-bad dev builds of `fs-fit.js` on the router one at a time. It runs the check against
each, reports which it killed, then puts the normal build back.

The mutants:

- the offset read inside the scroll event;
- the correction a frame late;
- no correction;
- no floor;
- no deferred floor.

| anchor-mutants exit code | Meaning |
|---|---|
| 1 | One mutant survived, or the check gave no verdict on it. No verdict means a crash, a hang the check gave up on after 20 min, a build, deploy or `owlab status` that did not return in 300, 120 or 60 s, a router with no lease, or exit 3 (the stand stopped answering). |
| 2 | A usage error, or a mutant's text is not in `fs-fit.js` exactly once. |

Run it after changing `fs-fit.js` or the check. It takes about as long as the check per mutant, so
pass `--widths 390` for a quick pass.

A surviving mutant is a hole in the check, or code the check never reaches.

CI runs it weekly, one mutant per job. It measures a mutant with no verdict once more on a fresh
router: [ci.md](ci.md) "`anchor-mutants`: does the anchor check still fail".
