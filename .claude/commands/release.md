Publish a new release of this Stonetop FoundryVTT system to GitHub.

**GitHub Actions ARE enabled, and `.github/workflows/release.yml` is authoritative for what
users download.** It fires on `release: published`, rebuilds `system.json` and
`stonetop.zip` from a clean checkout, and OVERWRITES whatever assets were attached by hand.
Anything that must reach users has to happen in that workflow, not in a local staging
directory. Verified the hard way at 1.3.0: hand-built assets were uploaded, verified by
SHA, and then silently replaced by the workflow's.

Two consequences worth holding onto:

- **Do not hand-build the zip, and do not attach one.** It will be discarded. Change the
  workflow instead.
- **CI checks out from git**, so anything gitignored (the private book art under the seven
  `assets/` directories listed in `DURABLE_ART_DIRS`, the compiled packs) is absent by
  construction, and anything *tracked* reaches the zip whether the manifest declares it or not.

**Hard rules**

- The target repo is `PrinceWitherdick/stonetop-pwd` ONLY. Pass `-R PrinceWitherdick/stonetop-pwd`
  on every `gh` command. Two other repositories are easy to hit by accident and both are wrong:
  `PrinceWitherdick/stonetop` is the DEPRECATED old-id package and still publishes, so releasing
  there ships to the wrong audience and fires that repo's own workflow; `taylor-nightingale/stonetop`
  is not ours and must never be referenced or targeted. Keep the explicit `-R` even when the
  working directory looks right: a sibling checkout of the old package sits in the same
  `Data/systems/` tree, and without `-R` gh infers the repo from whichever remote it finds.
- Foundry VTT must be CLOSED before any local pack rebuild (it locks the LevelDB packs;
  `npm run pack` fails with EBUSY otherwise).
- Tag names have NO `v` prefix (`1.0.0`); the release title has one (`v1.0.0`). The workflow
  now asserts this and fails the release on a malformed tag, because `system.json`'s version is
  copied from the tag verbatim.
- The shipped zip comes from CI, not from the working tree.

## Steps

1. Read the current `"version"` from `system.json`. Ask the user what the new version should be
   (suggest the next increment). Wait for their answer.

2. Preflight on `develop`: working tree clean and pushed, `npm test` passes, `npm run lint`
   passes.

3. Bump `system.json`: set `"version"` to the new version and point `"download"` at the versioned
   zip URL `https://github.com/PrinceWitherdick/stonetop-pwd/releases/download/<VERSION>/stonetop.zip`.
   Leave `"manifest"` untouched; it always points at `releases/latest/download/system.json`.

4. Commit the bump on `develop` as `[Release] Bump version to <VERSION>` and push.

5. Merge develop into main via PR:
   `gh pr create -R PrinceWitherdick/stonetop-pwd --base main --head develop`, then merge it
   (merge commit, not squash). The release tag will go on the resulting main merge commit.
   Confirm CI is green on that merge commit before continuing.

6. **Do not build or attach the zip.** `.github/workflows/release.yml` builds and uploads both
   assets when the release is published, and overwrites anything attached by hand. It already
   handles what the old by-hand recipe did:

   - re-runs `npm run lint`, `npm test` and `npm run pack` against the tagged tree
   - excludes `packs/src`, and deletes any pack directory `system.json` does not declare
   - ships the AI/TDM opt-out signals (`AI-TRAINING-NOTICE.md`, `ai.txt`, `robots.txt`,
     `CITATION.cff`, `.well-known/`) so they travel to any mirror
   - asserts the tag's shape, that all seven private book-art dirs are absent, that the version
     matches the tag, and that every declared pack exists, and FAILS the release rather than
     shipping a bad artifact
   - decides the repository's single "Latest" slot from the BUILT manifest id rather than from
     whoever clicked Publish

   If any of that needs to change, change the workflow. A local staging directory is wasted
   effort.

7. Create the release on main **with no assets attached**:

   ```
   gh release create <VERSION> -R PrinceWitherdick/stonetop-pwd --target main --title "v<VERSION>" --notes "<NOTES>"
   ```

   For the notes, summarize user-facing changes since the previous release tag
   (`git log <PREV_TAG>..main --oneline`).

8. Watch the workflow to completion: `gh run watch -R PrinceWitherdick/stonetop-pwd`. It is the
   step that actually produces what users download, so a release is not done until it is green.
   If it fails, the tag and the release both already exist: delete both, fix, and re-cut rather
   than patching assets by hand.

9. Verify what the workflow published, not what you have locally. Download `system.json` from
   the release and confirm its `version`, `id` and `download` URL; download `stonetop.zip` and
   confirm it contains no `assets/maps`, `assets/bestiary`, `assets/locations`,
   `assets/treasures`, `assets/people`, `assets/steading` or `assets/diagrams` entries.

   **Never `--clobber` an asset.** Re-uploading a local file over the workflow's output is
   precisely the 1.3.0 failure, run in reverse: it replaces the artifact that was built, tested
   and verified with one that was not.

10. Report the results. Remind the user that the manifest URL users paste into Foundry never
    changes: `https://github.com/PrinceWitherdick/stonetop-pwd/releases/latest/download/system.json`
