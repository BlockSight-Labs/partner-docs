#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const docsRoot = join(root, "docs");
const args = process.argv.slice(2);
const fail = (message) => { console.error(`release: ${message}`); process.exit(1); };
const normalize = (path) => path.split(sep).join("/");
const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, { encoding: "utf8", ...options });
  if (result.error?.code === "ENOENT") fail(`${command} is required but was not found`);
  if (result.status !== 0) fail(`${command} failed:\n${result.stderr || result.stdout}`);
  return result;
};

let sourceArg;
let candidate = false;
let listOnly = false;
let nextVersion;
let dryRun = false;
for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--candidate") candidate = true;
  else if (arg === "--list") listOnly = true;
  else if (arg === "--dry-run") dryRun = true;
  else if (arg === "--next") nextVersion = args[++i];
  else if (arg === "--help" || arg === "-h") {
    console.log(`Usage:
  npm run release -- docs/path/document.md [--candidate] [--next X.Y] [--dry-run]
  npm run releases:list

--candidate  Create the next immutable release candidate without bumping the source version.
--next X.Y   Version to write back after a final release (default: next minor version).
--dry-run    Validate and print the planned release without writing files.`);
    process.exit(0);
  } else if (arg?.startsWith("--")) fail(`unknown option: ${arg}`);
  else if (!sourceArg) sourceArg = arg;
  else fail(`unexpected argument: ${arg}`);
}
if (candidate && nextVersion) fail("--next applies only to final releases, not release candidates");

const discoverMarkdown = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) return discoverMarkdown(path);
  return entry.isFile() && extname(entry.name).toLowerCase() === ".md" ? [path] : [];
});

function metadataText(value) {
  if (!value) return undefined;
  if (value.t === "MetaString") return value.c;
  if (value.t === "MetaInlines") return value.c.map((part) => {
    if (part.t === "Str" || part.t === "Code") return typeof part.c === "string" ? part.c : part.c.at(-1);
    if (part.t === "Space" || part.t === "SoftBreak" || part.t === "LineBreak") return " ";
    return "";
  }).join("").trim();
  return undefined;
}

function versionFor(source) {
  const document = JSON.parse(run("pandoc", [source, "--from=markdown", "--to=json"]).stdout);
  const version = metadataText(document.meta?.version);
  if (!version || !/^\d+\.\d+$/.test(version)) fail(`${normalize(relative(root, source))} must declare version: major.minor in YAML front matter`);
  return version;
}

function compareVersions(left, right) {
  const [leftMajor, leftMinor] = left.split(".").map(Number);
  const [rightMajor, rightMinor] = right.split(".").map(Number);
  return leftMajor - rightMajor || leftMinor - rightMinor;
}

function nextMinor(version) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}`;
}

function releaseInfo(source) {
  const relativeSource = relative(docsRoot, source);
  const sourceStem = basename(source, extname(source));
  const cleanStem = sourceStem.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  const folder = join(root, "published", dirname(relativeSource), cleanStem);
  const files = existsSync(folder)
    ? readdirSync(folder).filter((name) => name.toLowerCase().endsWith(".pdf"))
    : [];
  const finals = files.map((name) => {
    const match = name.match(/-v(\d+\.\d+)\.pdf$/);
    return match ? { name, version: match[1] } : undefined;
  }).filter(Boolean).sort((a, b) => compareVersions(a.version, b.version));
  return { relativeSource, cleanStem, folder, files, finals };
}

if (listOnly) {
  if (sourceArg || candidate || nextVersion || dryRun) fail("--list does not accept release options");
  for (const source of discoverMarkdown(docsRoot).sort()) {
    const working = versionFor(source);
    const info = releaseInfo(source);
    const latest = info.finals.at(-1);
    const rcPattern = new RegExp(`-v${working.replace(".", "\\.")}-rc\\.(\\d+)\\.pdf$`);
    const latestRc = Math.max(0, ...info.files.map((name) => Number(name.match(rcPattern)?.[1] || 0)));
    console.log(normalize(info.relativeSource));
    console.log(`  latest published: ${latest ? `v${latest.version} (${latest.name.slice(0, 10)})` : "none"}`);
    console.log(`  working version:  v${working}`);
    console.log(`  release candidate: ${latestRc ? `v${working}-rc.${latestRc}` : "none"}`);
    console.log(`  status:            ${!latest ? "not yet published" : compareVersions(working, latest.version) > 0 ? "working version is unreleased" : compareVersions(working, latest.version) === 0 ? "working version is already published" : "version regression - fix required"}`);
  }
  process.exit(0);
}

if (!sourceArg) fail("provide one Markdown source, or use --list");
const source = resolve(process.cwd(), sourceArg);
if (!source.startsWith(`${docsRoot}${sep}`) || extname(source).toLowerCase() !== ".md" || !existsSync(source)) fail("source must be an existing Markdown file below docs/");
const version = versionFor(source);
const info = releaseInfo(source);
const today = new Date();
const releaseDate = [today.getFullYear(), String(today.getMonth() + 1).padStart(2, "0"), String(today.getDate()).padStart(2, "0")].join("-");

let suffix;
let resultingVersion = version;
if (candidate) {
  if (info.finals.some((item) => item.version === version)) fail(`final v${version} already exists; advance the source version before creating another candidate`);
  const rcPattern = new RegExp(`-v${version.replace(".", "\\.")}-rc\\.(\\d+)\\.pdf$`);
  const nextRc = Math.max(0, ...info.files.map((name) => Number(name.match(rcPattern)?.[1] || 0))) + 1;
  suffix = `v${version}-rc.${nextRc}`;
} else {
  if (info.finals.some((item) => item.version === version)) fail(`final v${version} already exists and cannot be replaced; release a newer version`);
  const latest = info.finals.at(-1);
  if (latest && compareVersions(version, latest.version) <= 0) fail(`working v${version} must be newer than published v${latest.version}`);
  resultingVersion = nextVersion || nextMinor(version);
  if (!/^\d+\.\d+$/.test(resultingVersion) || compareVersions(resultingVersion, version) <= 0) fail("--next must be a major.minor version newer than the version being released");
  suffix = `v${version}`;
}

const filename = `${releaseDate}-${info.cleanStem}-${suffix}.pdf`;
const output = join(info.folder, filename);
if (existsSync(output)) fail(`release already exists: ${normalize(relative(root, output))}`);
console.log(`${dryRun ? "Would create" : "Creating"} ${normalize(relative(root, output))}`);
if (candidate) console.log(`Working source remains at v${version}.`);
else console.log(`Working source advances from v${version} to v${resultingVersion} after a successful build.`);
if (dryRun) process.exit(0);

mkdirSync(info.folder, { recursive: true });
run(process.execPath, [join(root, "scripts/build-pdf.mjs"), normalize(relative(root, source)), "--force", "--output", normalize(relative(root, output)), "--release-version", version, "--release-date", releaseDate], { cwd: root, stdio: "inherit" });

if (!candidate) {
  const markdown = readFileSync(source, "utf8");
  const frontMatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!frontMatter || !/^version:\s*['"]?\d+\.\d+['"]?\s*$/m.test(frontMatter[1])) fail("release was created, but the source version line could not be updated automatically");
  const updatedFrontMatter = frontMatter[0].replace(/^version:\s*['"]?\d+\.\d+['"]?\s*$/m, `version: "${resultingVersion}"`);
  writeFileSync(source, updatedFrontMatter + markdown.slice(frontMatter[0].length));
  console.log(`Advanced ${normalize(relative(root, source))} to working v${resultingVersion}.`);
}

console.log(`Created ${normalize(relative(root, output))}`);
