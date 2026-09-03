#!/usr/bin/env node
// Packages the files Decky Loader needs at runtime into out/<plugin name>.zip,
// ready to copy to a Steam Deck (or install via Decky's "Install from zip").
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import archiver from "archiver";

const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const distDir = join(rootDir, "dist");

if (!existsSync(distDir)) {
  console.error('dist/ not found - run "rollup -c" before packaging.');
  process.exit(1);
}

const pluginJson = JSON.parse(readFileSync(join(rootDir, "plugin.json"), "utf-8"));
const pluginName = pluginJson.name;

const outDir = join(rootDir, "out");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, `${pluginName}.zip`);

const output = createWriteStream(outPath);
const archive = archiver("zip", { zlib: { level: 9 } });

output.on("close", () => {
  console.log(`created ${join("out", `${pluginName}.zip`)} (${(archive.pointer() / 1024).toFixed(1)} KiB)`);
});
archive.on("warning", (err) => {
  throw err;
});
archive.on("error", (err) => {
  throw err;
});
archive.pipe(output);

// Everything Decky Loader needs to run the plugin, nested under a single
// top-level folder so extraction tools using --strip-components=1 work.
const excludePycache = (entryData) => (/(^|\/)__pycache__(\/|$)/.test(entryData.name) ? false : entryData);

for (const file of ["plugin.json", "package.json", "main.py", "LICENSE"]) {
  const full = join(rootDir, file);
  if (existsSync(full)) archive.file(full, { name: `${pluginName}/${file}` });
}
archive.directory(join(rootDir, "py_modules"), `${pluginName}/py_modules`, excludePycache);
archive.directory(distDir, `${pluginName}/dist`);

// Optional personal bundled mpv (bin/mpv, plus optional bin/mpv.bin, bin/ld.so,
// bin/lib/*.so* when mpv was extracted from an installed Flatpak - see README).
// Force the executable bit for the runnable pieces since the host filesystem
// (e.g. Windows) may not track it.
const EXECUTABLE_NAMES = new Set(["mpv", "mpv.bin", "ld.so"]);
const binDir = join(rootDir, "bin");
if (existsSync(binDir)) {
  archive.directory(join(rootDir, "bin"), `${pluginName}/bin`, (entryData) => {
    const isDir = entryData.stats?.isDirectory();
    const isExecutable = EXECUTABLE_NAMES.has(entryData.name.split("/").pop());
    entryData.mode = isDir || isExecutable ? 0o755 : 0o644;
    return entryData;
  });
}

await archive.finalize();
