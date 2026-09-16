# BlockSight Partner Documents

This repository maintains the live, sendable PDF set for partner documents, proposals, technical material, and other external-facing documents.

All document prose uses US English. New Markdown sources should include `lang: en-US` in their YAML front matter.

## Build the live set

Install the rendering tools once:

```sh
brew install pandoc plantuml weasyprint
```

Then build every live document:

```sh
npm run pdf
```

Generated PDFs are ignored by Git and written to `output/pdf/`, mirroring each source path below `docs/`. Use `npm run pdf:list` to inspect the live set and `npm run pdf:force` to rebuild it.

To build one listed document:

```sh
npm run pdf -- "docs/ComplyOnce/BlockSight ComplyOnce StatementOfUnderstanding.md"
```

## WIP versus live documents

The `docs/` tree may contain any number of work-in-progress files. `documents.json` is the deliberate list of documents whose PDFs are kept live and ready to send. Add a source to that file only when it belongs in the live PDF set:

```json
{"source":"docs/Partner/Proposal.md","style":"technical"}
```

The style may be `technical` (modern and less formal) or `official` (serif and formal). An optional `output` overrides the mirrored path below `output/pdf/`.

## PlantUML

Use fenced `plantuml` blocks directly in Markdown. The builder renders them to SVG before Pandoc runs, keeping diagrams sharp and avoiding the fragile `pandoc-plantuml` filter. It runs PlantUML in the source file's directory, so relative `!include` paths work. If PlantUML is available only as a jar, build with `PLANTUML_JAR=/path/to/plantuml.jar npm run pdf`.
