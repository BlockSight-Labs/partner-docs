#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2);
const fail = (message) => { console.error(`pdf: ${message}`); process.exit(1); };
let force = false;
let listOnly = false;
let prune = false;
let outputArg;
let releaseVersion;
let releaseDate;
const requested = [];
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--force") force = true;
  else if (arg === "--list") listOnly = true;
  else if (arg === "--prune") prune = true;
  else if (arg === "--output") outputArg = args[++i];
  else if (arg === "--release-version") releaseVersion = args[++i];
  else if (arg === "--release-date") releaseDate = args[++i];
  else if (arg === "--help" || arg === "-h") {
    console.log("Usage: npm run pdf -- [source.md ...] [--force] [--prune] [--list]\n\nWith no source, recursively builds every Markdown document below docs/. --prune removes PDFs whose source no longer exists.");
    process.exit(0);
  } else if (arg?.startsWith("--")) fail(`unknown option: ${arg}`);
  else if (arg) requested.push(arg);
  else fail(`missing value after ${args[i - 1]}`);
}
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") fail(`${command} is required but was not found`);
  if (result.status !== 0) fail(`${command} failed:\n${result.stderr || result.stdout}`);
  return result;
};
const cssString = (value) => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
const escapeHtml = (value) => String(value).replace(/[&<>\"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const now = new Date();
const buildDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");

const brandPath = join(root, "pdf/document.json");
const brand = JSON.parse(readFileSync(brandPath, "utf8"));
const normalize = (path) => path.split(sep).join("/");
const docsRoot = resolve(root, "docs");
const discoverDocuments = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return discoverDocuments(path);
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") return [{ source: normalize(relative(root, path)) }];
    return [];
  });
if (!existsSync(docsRoot)) fail("docs/ directory not found");
const docs = discoverDocuments(docsRoot).sort((a, b) => a.source.localeCompare(b.source));
const selected = requested.length ? docs.filter((doc) => requested.some((item) => resolve(root, item) === resolve(root, doc.source))) : docs;
if (requested.length && selected.length !== new Set(requested.map((item) => resolve(root, item))).size) fail("every requested source must be a Markdown file below docs/");
if (requested.length && prune) fail("--prune can only be used when building the complete live set");
if (outputArg && selected.length !== 1) fail("--output requires exactly one source document");
if ((releaseVersion || releaseDate) && !(releaseVersion && releaseDate && outputArg && selected.length === 1)) fail("release rendering requires --output, --release-version, --release-date, and exactly one source");
if (releaseVersion && !/^\d+\.\d+$/.test(releaseVersion)) fail("--release-version must use major.minor format");
if (releaseDate && !/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) fail("--release-date must use YYYY-MM-DD format");

function outputFor(doc) {
  const source = resolve(root, doc.source);
  if (!source.startsWith(`${docsRoot}${sep}`)) fail(`source must be below docs/: ${doc.source}`);
  const mirrored = relative(docsRoot, source).slice(0, -extname(source).length) + ".pdf";
  const outputRoot = resolve(root, "output/pdf");
  const output = resolve(outputRoot, mirrored);
  return output;
}

const metadataCache = new Map();
function metadataFor(doc) {
  const source = resolve(root, doc.source);
  if (metadataCache.has(source)) return metadataCache.get(source);
  if (!existsSync(source)) fail(`source not found: ${doc.source}`);
  const result = run("pandoc", [source, "--from=markdown", "--to=json"]);
  let document;
  try { document = JSON.parse(result.stdout); }
  catch { fail(`could not read Pandoc metadata from ${doc.source}`); }
  const metadata = document.meta || {};
  metadataCache.set(source, metadata);
  return metadata;
}

function metadataText(value) {
  if (!value) return undefined;
  if (value.t === "MetaString") return value.c;
  if (value.t === "MetaInlines") {
    return value.c.map((part) => {
      if (part.t === "Str" || part.t === "Code") return typeof part.c === "string" ? part.c : part.c.at(-1);
      if (part.t === "Space" || part.t === "SoftBreak" || part.t === "LineBreak") return " ";
      return "";
    }).join("").trim();
  }
  return undefined;
}

function styleFor(doc) {
  const style = metadataText(metadataFor(doc).style) || "technical";
  if (!["technical", "official"].includes(style)) fail(`unsupported style '${style}' in ${doc.source}; use technical or official`);
  return style;
}

function versionFor(doc) {
  const version = metadataText(metadataFor(doc).version);
  if (!version || !/^\d+\.\d+$/.test(version)) fail(`missing or invalid version in ${doc.source}; add version: major.minor to its YAML front matter`);
  return version;
}

function classificationFor(doc) {
  const classification = metadataText(metadataFor(doc).classification) || "Commercial in Confidence";
  if (classification.length > 80 || /[\r\n]/.test(classification)) fail(`invalid classification in ${doc.source}`);
  return classification;
}

if (listOnly) {
  for (const doc of selected) console.log(`${doc.source} -> ${normalize(relative(root, outputFor(doc)))} [${styleFor(doc)}, working v${versionFor(doc)}]`);
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
  const output = outputArg ? resolve(process.cwd(), outputArg) : outputFor(doc);
  if (!output.startsWith(`${root}${sep}`) || extname(output).toLowerCase() !== ".pdf") fail("--output must be a PDF path inside this repository");
  if (!existsSync(source)) fail(`source not found: ${doc.source}`);
  const style = styleFor(doc);
  const version = versionFor(doc);
  const classification = classificationFor(doc);
  if (releaseVersion && version !== releaseVersion) fail(`release version ${releaseVersion} does not match ${doc.source} version ${version}`);
  const dependencies = [source, brandPath, join(root, "pdf/document.css"), resolve(root, brand.logo), resolve(root, brand.watermark || brand.logo)];
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
    const footer = `${brand.companyName} - ${classification} - v${releaseVersion || version} - ${releaseDate || buildDate}`;
    writeFileSync(css, `${readFileSync(join(root, "pdf/document.css"), "utf8")}\n:root { --accent: ${brand.accentColor}; --paper-size: ${brand.paperSize}; --footer-left: ${cssString(footer)}; }\n`);
    const html = join(work, "document.html");
    run("pandoc", [staged, "--from=gfm+raw_html", "--to=html5", "--standalone", `--include-before-body=${header}`, `--css=${css}`, `--resource-path=${dirname(source)}:${root}`, "--output", html]);
    writeFileSync(html, readFileSync(html, "utf8").replace("<body>", `<body class="style-${escapeHtml(style)}">`));
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
