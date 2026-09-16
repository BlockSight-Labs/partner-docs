# BlockSight Partner Documents

This repository maintains the live, sendable PDF set for partner documents, proposals, technical material, and other external-facing documents.

All document prose uses US English. Document-specific presentation metadata lives with the Markdown source in YAML front matter:

```yaml
---
title: "Partner Integration"
subtitle: "Technical Overview"
lang: en-US
style: technical
---
```

`style` may be `technical` (modern and less formal) or `official` (serif and formal). It defaults to `technical` when omitted. Keeping this metadata in the source means the system does not need a parallel per-file JSON tree.

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

Every commit will then force-refresh the complete live PDF set and remove stale generated PDFs left behind by source renames. The PDFs remain local and Git-ignored by design, so they will not appear in the commit itself.

Generated PDFs are ignored by Git and written to `output/pdf/`, mirroring each source path below `docs/`. Use `npm run pdf:list` to inspect the live set, `npm run pdf:force` to rebuild it, or `npm run pdf:live` to rebuild and prune PDFs that are no longer in the live set.

To build one listed document:

```sh
npm run pdf -- "docs/ComplyOnce/2026-09-16-BlockSight-ComplyOnce-StatementOfUnderstanding.md"
```

## WIP versus live documents

The `docs/` tree may contain any number of work-in-progress files. `documents.json` is the deliberate list of documents whose PDFs are kept live and ready to send. Add a source to that file only when it belongs in the live PDF set:

```json
"docs/Partner/Proposal.md"
```

Use a string when the default mirrored output path is appropriate. An object with `source` and optional `output` remains available when the generated PDF needs a non-default path. Document style is always read from the Markdown front matter.

## PlantUML

Use fenced `plantuml` blocks directly in Markdown. The builder renders them to SVG before Pandoc runs, keeping diagrams sharp and avoiding the fragile `pandoc-plantuml` filter. It runs PlantUML in the source file's directory, so relative `!include` paths work. If PlantUML is available only as a jar, build with `PLANTUML_JAR=/path/to/plantuml.jar npm run pdf`.
