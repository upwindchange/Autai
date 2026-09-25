// Generates THIRD-PARTY-NOTICES.md from the actual pnpm dependency graph
// reachable from src/ imports (runtime closure, exact resolved versions).
// Run: node scripts/generate-third-party-notices.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

// --- collect package specifiers actually imported from src/ ---
const imports = new Set();
const walk = (dir) => {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(f)) {
      const txt = fs.readFileSync(p, "utf8");
      for (const m of txt.matchAll(
        /(?:from\s*|import\s*\(\s*|import\s*|require\s*\(\s*)['"]([^'"]+)['"]/g,
      )) {
        const spec = m[1];
        if (spec.startsWith(".") || spec.startsWith("/")) continue;
        if (/^(@\/|@shared|@agents|node:|electron$|path$|events$|assets)/.test(spec)) continue;
        const parts = spec.split("/");
        imports.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
      }
    }
  }
};
walk(path.join(ROOT, "src"));

// --- resolve through the real pnpm symlink graph, BFS over runtime deps ---
const resolveIn = (baseDir, name) => {
  const cand = path.join(baseDir, "node_modules", name);
  return fs.existsSync(cand) ? fs.realpathSync(cand) : null;
};

const seen = new Map(); // name -> dir | null
const queue = [...imports].map((pkg) => [pkg, resolveIn(ROOT, pkg)]);
while (queue.length) {
  const [name, dir] = queue.shift();
  if (seen.has(name)) continue;
  seen.set(name, dir);
  if (!dir) continue;
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    continue;
  }
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies })) {
    if (seen.has(dep)) continue;
    // deps resolve from the importer's own node_modules dir (dirname of package dir)
    let dd = path.join(path.dirname(dir), dep);
    if (!fs.existsSync(dd)) dd = resolveIn(ROOT, dep);
    queue.push([dep, fs.existsSync(dd) ? fs.realpathSync(dd) : null]);
  }
}

// --- read license metadata + copyright line ---
const info = (dir) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  const license = Array.isArray(pkg.license)
    ? pkg.license.join(" OR ")
    : (pkg.license ?? "NOT DECLARED");
  let copyright = "";
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!/^licen[cs]e(\.|$)/i.test(f)) continue;
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      const m = t.match(/[Cc]opyright[^\n]*/);
      if (m) {
        copyright = m[0].trim();
        break;
      }
    }
  } catch {
    /* ignore unreadable license files */
  }
  // Manual classifications where package.json is silent but the license is known
  if (license === "NOT DECLARED") {
    if (pkg.name === "format") return { ...pkg, license: "MIT", copyright: "Copyright 2010-2014 Sami Samhuri" };
    if (pkg.name === "khroma") return { ...pkg, license: "MIT", copyright: "Copyright (c) 2019-present Fabio Spampinato, Andrew Maney" };
    if (pkg.name === "xmlhttprequest-ssl") return { ...pkg, license: "MIT", copyright: "Copyright (c) 2010 passive.ly LLC" };
  }
  return { ...pkg, license, copyright };
};

const entries = [];
for (const [name, dir] of [...seen].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!dir || /^@types\//.test(name)) continue;
  const meta = info(dir);
  entries.push({ name, version: meta.version, license: meta.license, copyright: meta.copyright });
}

// --- group by license ---
const groups = new Map();
for (const e of entries) {
  const key = e.license;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(e);
}

const LICENSE_TEXTS = {
  MIT: `The MIT License (MIT)
Copyright (c) respective authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.`,
  "Apache-2.0": `Copyright (c) respective contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.`,
};

const out = [];
out.push(`# Third-Party Software Notices

This file lists the open-source components distributed with Autai and their
licenses. It is generated from the package versions actually resolved in the
build by \`scripts/generate-third-party-notices.mjs\` — regenerate after
dependency changes. License texts are available in each component's upstream
repository; Electron's bundled licenses (Chromium, Node.js, V8) ship inside
every app bundle as \`LICENSES.chromium.html\` and accompanying LICENSE files.
`);

const listLine = (list) =>
  list
    .map((e) => {
      let s = `${e.name} ${e.version}`;
      // Apache NOTICE-ish attribution for Vercel/Chromium/etc. where the
      // copyright line names the holder
      if (e.copyright && /vercel|chromium|bostock/i.test(e.copyright)) {
        s += ` — ${e.copyright}`;
      }
      return s;
    })
    .join(" · ");

for (const lic of ["MIT", "Apache-2.0", "ISC", "BSD-3-Clause", "BSD-2-Clause"]) {
  const list = groups.get(lic);
  if (!list?.length) continue;
  groups.delete(lic);
  out.push(`## ${lic === "Apache-2.0" ? "Apache License 2.0" : lic === "MIT" ? "MIT License" : lic}`);
  if (LICENSE_TEXTS[lic]) {
    out.push("");
    out.push("    " + LICENSE_TEXTS[lic].split("\n").join("\n    "));
  }
  out.push("");
  out.push(listLine(list));
  out.push("");
}

// remaining license groups (dual-licensed, BlueOak, CC0, EPL, LGPL, Unlicense…)
for (const [lic, list] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
  out.push(`## ${lic}`);
  out.push("");
  out.push(listLine(list));
  out.push("");
}

fs.writeFileSync(path.join(ROOT, "THIRD-PARTY-NOTICES.md"), out.join("\n") + "\n");
console.log(`Wrote THIRD-PARTY-NOTICES.md (${entries.length} packages, ${groups.size + 5} license groups)`);
