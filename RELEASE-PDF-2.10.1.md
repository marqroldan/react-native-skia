# `react-native-skia-pdf@2.10.1` release

This one-shot release candidate publishes the reviewed PDF source from
`5259d270be41006d3fa41ec43319429ac1fd9c41` as
`react-native-skia-pdf@2.10.1`. Its successor commit contains only this
release workflow, the publishing metadata correction, the hosted-workspace
safety correction, and this release note; the workflow verifies that exact
base and rejects any other diff. It intentionally does not use
semantic-release, so the package version is explicit and cannot be selected
from an unrelated Git tag or commit history.

## Workflow

After this workflow is present on the fork's default branch, configure npm
Trusted Publishing for the existing `react-native-skia-pdf` package with:

```text
Provider:          GitHub Actions
Organization/user: marqroldan
Repository:        react-native-skia
Workflow filename: publish-skia-pdf-2.10.1.yml
Environment:       none
Allowed action:    direct npm publish
```

The exact workflow file is
`.github/workflows/publish-skia-pdf-2.10.1.yml`. The filename above is not a
placeholder; npm matches it exactly. New trusted publisher configurations may
default to stage-only access, so direct publish must be enabled for the
maintained packer's `npm publish` call.

The workflow checks out the exact release-candidate SHA selected by the
manual dispatch, verifies that the reviewed source commit is its ancestor and
that only the release-scoped paths differ, builds the package, then stages the
tracked PDF-enabled CanvasKit UMD initializer into both fresh Bob loader
outputs. The staging helper verifies `PDFDocument` and the CommonJS default
export wrapper before the packer invokes:

```bash
node ./scripts/pack-pdf-package.js \
  --version 2.10.1 \
  --output dist \
  --publish \
  --tag latest
```

The packer uses the GitHub Actions checkout root only when
`GITHUB_ACTIONS=true` and validates that `GITHUB_WORKSPACE` is an existing,
non-symlink repository root containing `packages/skia`. Local runs continue to
require the real `/Volumes/DevSSD` root.

## Package metadata and provenance identity

The currently published `react-native-skia-pdf@2.10.0` metadata points to
`git+https://github.com/Shopify/react-native-skia.git`, which does not identify
the fork that will publish this release. The generated `2.10.1` metadata now
uses the exact fork URL
`git+https://github.com/marqroldan/react-native-skia.git` and declares the
monorepo directory `packages/skia`. The MIT license, Shopify author, and
existing attribution fields are preserved.

npm's current provenance requirement is the public, case-sensitive
`repository.url` match; `repository.directory` is supported monorepo metadata
but is not an additional trusted-publisher identity key. The workflow supplies
the remaining provenance requirements: a public GitHub repository, a
GitHub-hosted `ubuntu-latest` runner, `id-token: write`, and a direct
`npm publish --provenance --access public` path. Trusted publishing itself
automatically creates the provenance attestation and uses OIDC rather than a
long-lived npm token.

## Workflow registration and dispatch route

The fork's live default branch is `main`, and this filename is not currently
registered there. GitHub only receives `workflow_dispatch` events when the
workflow file is on the default branch. Use this two-reviewable-change route:

1. Create a registration branch from the current `main` and open a PR that
   adds only `.github/workflows/publish-skia-pdf-2.10.1.yml` with this exact
   content. Merge that workflow-only PR after review; do not merge the
   candidate source or dispatch `main`.
2. Push this unchanged candidate successor to a dedicated release ref, keeping
   its commit SHA intact. The candidate ref must contain the workflow, metadata,
   packer, and release note from this source successor.
3. After the workflow appears in `gh workflow list --repo
   marqroldan/react-native-skia`, configure npm Trusted Publishing with the
   exact filename above, then dispatch the registered workflow against the
   candidate ref, not `main`:

   ```bash
   gh workflow run publish-skia-pdf-2.10.1.yml \
     --repo marqroldan/react-native-skia \
     --ref <candidate-ref>
   ```

   The workflow's `github.sha` and its source-identity guard then select and
   verify the candidate's reviewed PDF commit; `--version 2.10.1` remains
   explicit. Verify the resulting run's head SHA is the candidate SHA before
   accepting publication.

This registration PR is required only to make the new workflow dispatchable;
it does not authorize publication by itself. The separate candidate ref keeps
the release package tree distinct from the default branch's different tree.

## Operator prerequisites

- The package administrator has write access to `react-native-skia-pdf` and
  has configured the trusted publisher above.
- The source commit is approved for this release; npm publication is separate
  from merging the draft PR into a shared development branch.
- GitHub Actions is allowed to run the workflow on `ubuntu-latest`.
- No npm token is needed during the OIDC publish. An account-level verification
  may be needed once while an administrator creates the trusted publisher
  relationship.

Do not run this workflow from the draft PR branch. It pins the source commit
itself and is intended to be dispatched only after the workflow file is
available in the fork.
