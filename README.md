# BlockSight Partner Documents

This repository maintains the live, sendable PDF set for partner documents, proposals, technical material, and other external-facing documents.

All document prose uses US English. Document-specific presentation metadata lives with the Markdown source in YAML front matter:

```yaml
---
title: "Partner Integration"
subtitle: "Technical Overview"
lang: en-US
style: technical
version: 1.0
---
```

`style` may be `technical` (modern and less formal) or `official` (serif and formal). It defaults to `technical` when omitted. `version` is required and uses `major.minor` format. Keeping this metadata in the source means the system does not need a parallel per-file JSON tree.

## Build the live set

Install the rendering tools once:

```sh
brew install pandoc plantuml weasyprint
```

Then build every live document:

```sh
npm run pdf
```

Install the tracked pre-commit hook once per checkout:

```sh
npm run hooks:install
```

Every commit will then force-refresh all Markdown documents below `docs/` and remove stale generated PDFs left behind by source renames or deletion. The PDFs remain local and Git-ignored by design, so they will not appear in the commit itself.

Generated PDFs are ignored by Git and written to `output/pdf/`, mirroring each source path below `docs/`. Use `npm run pdf:list` to inspect the live set, `npm run pdf:force` to rebuild it, or `npm run pdf:live` to rebuild and prune PDFs that are no longer in the live set.

To build one listed document:

```sh
npm run pdf -- "docs/ComplyOnce/2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding.md"
```

## Document discovery

Every `.md` file anywhere below `docs/` is discovered recursively and treated as part of the live, sendable PDF set. Its relative directory and filename are mirrored below `output/pdf/`:

```text
docs/Partner/Proposal.md
output/pdf/Partner/Proposal.pdf
```

No central document manifest or parallel JSON metadata is required. Add, rename, move, or delete Markdown files in `docs/`; the next complete build updates and prunes the mirrored PDF tree. Document-specific configuration such as `style` remains in each source file's YAML front matter.

## Versioned releases

The PDF below `output/pdf/` is the mutable live preview for the version declared in the Markdown source. Its footer identifies it as a working version. Published releases are immutable, Git-tracked snapshots below `published/`.

Create a release candidate while continuing to work on the same version:

```sh
npm run release -- "docs/ComplyOnce/2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding.md" --candidate
```

Repeated candidate releases automatically create `v1.0-rc.1`, `v1.0-rc.2`, and so on. They do not change the source version.

Create the final release:

```sh
npm run release -- "docs/ComplyOnce/2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding.md"
```

The final release is written to a stable per-document history such as:

```text
published/ComplyOnce/BlockSight-ComplyOnce-StatementOfUnderstanding/
├── 2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding-v1.0-rc.1.pdf
└── 2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding-v1.0.pdf
```

After a successful final release, the source automatically advances from `version: 1.0` to `version: 1.1`. To choose the next major version instead:

```sh
npm run release -- "docs/ComplyOnce/2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding.md" --next 2.0
```

Final releases are never overwritten. If `v1.0` is already final, a correction must be released as a newer version. Preview a release operation without writing files by adding `--dry-run`.

Inspect working versions, latest final releases, and current release candidates with:

```sh
npm run releases:list
```

Commit the `published/` PDF and the automatically updated Markdown source together. Normal commits rebuild live previews but never create a release automatically.

## PlantUML

Use fenced `plantuml` blocks directly in Markdown. The builder renders them to SVG before Pandoc runs, keeping diagrams sharp and avoiding the fragile `pandoc-plantuml` filter. It runs PlantUML in the source file's directory, so relative `!include` paths work. If PlantUML is available only as a jar, build with `PLANTUML_JAR=/path/to/plantuml.jar npm run pdf`.
