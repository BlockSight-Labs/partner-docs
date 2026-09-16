#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const force = args.includes("--force");
const listOnly = args.includes("--list");
const prune = args.includes("--prune");
const requested = args.filter((arg) => !arg.startsWith("--"));
const fail = (message) => { console.error(`pdf: ${message}`); process.exit(1); };
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") fail(`${command} is required but was not found`);
  if (result.status !== 0) fail(`${command} failed:\n${result.stderr || result.stdout}`);
};
const cssString = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const escapeHtml = (value) => String(value).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

if (args.includes("--help") || args.includes("-h")) {
  console.log("Usage: npm run pdf -- [source.md ...] [--force] [--prune] [--list]\n\nWith no source, builds every live document in documents.json. --prune removes PDFs no longer represented by the live list.");
  process.exit(0);
}
const manifestPath = join(root, "documents.json");
const brandPath = join(root, "pdf/document.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const brand = JSON.parse(readFileSync(brandPath, "utf8"));
if (!Array.isArray(manifest.documents)) fail("documents.json must contain a documents array");
const normalize = (path) => path.split(sep).join("/");
const docs = manifest.documents.map((entry) => typeof entry === "string" ? { source: entry } : entry);
const selected = requested.length ? docs.filter((doc) => requested.some((item) => resolve(root, item) === resolve(root, doc.source))) : docs;
if (requested.length && selected.length !== new Set(requested.map((item) => resolve(root, item))).size) fail("every requested source must be listed in documents.json");
if (requested.length && prune) fail("--prune can only be used when building the complete live set");

function outputFor(doc) {
  const source = resolve(root, doc.source);
  const docsRoot = resolve(root, "docs");
  if (!source.startsWith(`${docsRoot}${sep}`)) fail(`source must be below docs/: ${doc.source}`);
  const mirrored = relative(docsRoot, source).slice(0, -extname(source).length) + ".pdf";
  const outputRoot = resolve(root, "output/pdf");
  const output = resolve(outputRoot, doc.output || mirrored);
  if (!output.startsWith(`${outputRoot}${sep}`)) fail(`output must remain below output/pdf/: ${doc.output}`);
  return output;
}
if (listOnly) {
  for (const doc of selected) console.log(`${doc.source} -> ${normalize(relative(root, outputFor(doc)))} [${doc.style || "technical"}]`);
  process.exit(0);
}
function renderPlantUml(source, target, cwd) {
  const jar = process.env.PLANTUML_JAR;
  const command = jar ? "java" : "plantuml";
  const commandArgs = jar ? ["-Djava.awt.headless=true", "-jar", jar, "-tsvg", "-pipe"] : ["-tsvg", "-pipe"];
  const result = spawnSync(command, commandArgs, { cwd, encoding: null, input: Buffer.from(source) });
  if (result.error?.code === "ENOENT") fail("PlantUML is required; install with `brew install plantuml`, or set PLANTUML_JAR to a PlantUML jar");
  if (result.status !== 0) fail(`PlantUML failed:\n${result.stderr?.toString() || "unknown error"}`);
  writeFileSync(target, result.stdout);
}

let created = 0;
let unchanged = 0;
for (const doc of selected) {
  const source = resolve(root, doc.source);
  const output = outputFor(doc);
  if (!existsSync(source)) fail(`source not found: ${doc.source}`);
  const dependencies = [source, manifestPath, brandPath, join(root, "pdf/document.css"), resolve(root, brand.logo), resolve(root, brand.watermark || brand.logo)];
  const newest = Math.max(...dependencies.map((file) => statSync(file).mtimeMs));
  if (!force && existsSync(output) && statSync(output).mtimeMs >= newest) { console.log(`Unchanged ${normalize(relative(root, output))}`); unchanged += 1; continue; }
  const work = mkdtempSync(join(tmpdir(), "partner-pdf-"));
  try {
    const assets = join(work, "assets");
    mkdirSync(assets);
    let diagram = 0;
    const markdown = readFileSync(source, "utf8").replace(/```plantuml\s*\n([\s\S]*?)```/g, (_all, puml) => {
      diagram += 1;
      const name = `diagram-${String(diagram).padStart(2, "0")}.svg`;
      renderPlantUml(puml.trim(), join(assets, name), dirname(source));
      return `<figure class="plantuml-diagram"><img src="assets/${name}" alt="PlantUML diagram ${diagram}"></figure>`;
    });
    const staged = join(work, basename(source));
    writeFileSync(staged, markdown);
    const header = join(work, "header.html");
    const logo = resolve(root, brand.logo);
    const watermark = resolve(root, brand.watermark || brand.logo);
    writeFileSync(header, `<div class="document-watermark" aria-hidden="true"><img src="${pathToFileURL(watermark).href}" alt=""></div><header class="document-header"><img src="${pathToFileURL(logo).href}" alt="${escapeHtml(brand.companyName)}"><div class="entity">${escapeHtml(brand.companyName)}<br>${escapeHtml(brand.companyDescriptor)}</div></header>`);
    const css = join(work, "document.css");
    writeFileSync(css, `${readFileSync(join(root, "pdf/document.css"), "utf8")}\n:root { --accent: ${brand.accentColor}; --paper-size: ${brand.paperSize}; --footer-left: ${cssString(brand.companyName)}; }\n`);
    const html = join(work, "document.html");
    run("pandoc", [staged, "--from=gfm+raw_html", "--to=html5", "--standalone", `--include-before-body=${header}`, `--css=${css}`, `--resource-path=${dirname(source)}:${root}`, "--output", html]);
    writeFileSync(html, readFileSync(html, "utf8").replace("<body>", `<body class="style-${escapeHtml(doc.style || "technical")}">`));
    mkdirSync(dirname(output), { recursive: true });
    run("weasyprint", [html, output]);
    console.log(`Created ${normalize(relative(root, output))} (${diagram} PlantUML diagram${diagram === 1 ? "" : "s"})`);
    created += 1;
  } finally { rmSync(work, { recursive: true, force: true }); }
}

let pruned = 0;
if (prune) {
  const outputRoot = resolve(root, "output/pdf");
  const expected = new Set(docs.map((doc) => outputFor(doc)));
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && extname(entry.name).toLowerCase() === ".pdf" && !expected.has(path)) {
        rmSync(path);
        console.log(`Pruned ${normalize(relative(root, path))}`);
        pruned += 1;
      }
    }
  };
  visit(outputRoot);
}
console.log(`PDF build complete: ${created} created, ${unchanged} unchanged, ${pruned} pruned.`);
