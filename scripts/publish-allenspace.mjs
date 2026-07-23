#!/usr/bin/env node
/**
 * Publish daily-brief output into Allen Space (A11en4z.github.io).
 *
 * 1. npm run build-site  (index.html + archive.html in daily_reports/)
 * 2. Sync daily_reports/ → <ALLENSPACE>/docs/.vuepress/public/brief/
 * 3. Write manifest.json + brief-nav.js for homepage / nav
 * 4. Optionally git commit + push the blog repo (triggers GH Actions deploy)
 *
 * Env:
 *   ALLENSPACE_REPO   path to blog clone (default: sibling A11en4z.github.io)
 *   GIT_PUSH          "false" to skip commit/push (default: push when dirty)
 *
 * Usage:
 *   node scripts/publish-allenspace.mjs
 *   ALLENSPACE_REPO=/path/to/blog node scripts/publish-allenspace.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "daily_reports");

const ALLENSPACE_REPO =
  process.env.ALLENSPACE_REPO ||
  path.resolve(ROOT, "..", "A11en4z.github.io");

const BRIEF_PUBLIC = path.join(
  ALLENSPACE_REPO,
  "docs",
  ".vuepress",
  "public",
  "brief",
);
const BRIEF_NAV_JS = path.join(
  ALLENSPACE_REPO,
  "docs",
  ".vuepress",
  "config",
  "themeConfig",
  "brief-nav.js",
);
const BRIEF_ARCHIVE_MD = path.join(
  ALLENSPACE_REPO,
  "docs",
  "_posts",
  "brief-archive.md",
);

const NAV_RECENT = 7;
const GIT_PUSH = process.env.GIT_PUSH !== "false";

function die(msg) {
  console.error(`[publish-allenspace] ${msg}`);
  process.exit(1);
}

function runBuildSite() {
  console.log("[publish-allenspace] running build-site…");
  const r = spawnSync("npm", ["run", "build-site"], {
    cwd: ROOT,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) die("build-site failed");
}

function listDates() {
  if (!fs.existsSync(REPORTS)) return [];
  return fs
    .readdirSync(REPORTS)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .filter((d) => fs.existsSync(path.join(REPORTS, d, `${d}.html`)))
    .sort((a, b) => b.localeCompare(a));
}

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** Site chrome for static /brief HTML (not present in VuePress shell). */
const ALLEN_SPACE_CHROME = `<!-- allen-space-chrome -->
<style id="allen-space-chrome-style">
  .allen-space-chrome{
    position:sticky;top:0;z-index:9999;
    display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap;
    padding:0.65rem 1.25rem;
    background:rgba(15,23,42,.94);
    color:#e2e8f0;
    border-bottom:1px solid rgba(148,163,184,.25);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
    backdrop-filter:blur(8px);
  }
  .allen-space-chrome a{
    color:#e2e8f0;text-decoration:none;font-size:0.9rem;opacity:.9;
  }
  .allen-space-chrome a:hover{opacity:1;text-decoration:underline}
  .allen-space-chrome .brand{font-weight:700;font-size:0.95rem;letter-spacing:.01em}
  .allen-space-chrome .links{display:flex;gap:0.95rem;flex-wrap:wrap;align-items:center}
  .allen-space-chrome .back{
    display:inline-flex;align-items:center;gap:0.3rem;
    font-weight:600;color:#7dd3fc;
  }
  body{margin-top:0}
</style>
<nav class="allen-space-chrome" aria-label="Allen Space">
  <a class="brand" href="/">Allen Space</a>
  <div class="links">
    <a class="back" href="/">← 返回首页</a>
    <a href="/pages/brief-archive/">AI 资讯归档</a>
    <a href="/cloud/">运维笔记</a>
  </div>
</nav>
<script>
(function(){
  // Hide mini-chrome when embedded in Allen Space brief-reader iframe
  try {
    if (window.self !== window.top) {
      var n = document.querySelector('.allen-space-chrome');
      var s = document.getElementById('allen-space-chrome-style');
      if (n) n.style.display = 'none';
      if (s) s.remove();
    }
  } catch (e) {}
  // #region agent log
  try {
    var el = document.querySelector('.allen-space-chrome');
    var r = el ? el.getBoundingClientRect() : null;
    var cs = el ? getComputedStyle(el) : null;
    fetch('http://127.0.0.1:7769/ingest/fa9e3a93-d370-45dc-b725-74bc6a918a85',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'0010a9'},body:JSON.stringify({sessionId:'0010a9',runId:'post-fix',hypothesisId:'H-A',location:'brief-chrome',message:'brief chrome visibility',data:{href:location.href,inIframe:window.self!==window.top,hasChrome:!!el,display:cs&&cs.display,height:r&&r.height},timestamp:Date.now()})}).catch(function(){});
  } catch (e) {}
  // #endregion
})();
</script>
`;

function injectAllenSpaceChrome(filePath) {
  if (!fs.existsSync(filePath) || !filePath.endsWith(".html")) return;
  let html = fs.readFileSync(filePath, "utf8");
  if (html.includes("allen-space-chrome")) {
    // Re-inject fresh chrome (idempotent replace)
    html = html.replace(
      /<!-- allen-space-chrome -->[\s\S]*?<\/nav>\n?/,
      ALLEN_SPACE_CHROME,
    );
  } else if (/<body[^>]*>/i.test(html)) {
    html = html.replace(/<body([^>]*)>/i, `<body$1>\n${ALLEN_SPACE_CHROME}`);
  } else {
    return;
  }
  fs.writeFileSync(filePath, html, "utf8");
}

function injectChromeIntoBriefTree(rootDir) {
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".html")) injectAllenSpaceChrome(p);
    }
  };
  walk(rootDir);
  console.log("[publish-allenspace] injected Allen Space chrome into brief HTML");
}

function syncBriefFiles() {
  if (!fs.existsSync(ALLENSPACE_REPO)) {
    die(`ALLENSPACE_REPO not found: ${ALLENSPACE_REPO}`);
  }

  const dates = listDates();
  if (dates.length === 0) {
    die("no reports in daily_reports/ — run npm run daily first");
  }

  fs.mkdirSync(BRIEF_PUBLIC, { recursive: true });

  for (const d of dates) {
    copyDir(path.join(REPORTS, d), path.join(BRIEF_PUBLIC, d));
  }

  for (const name of ["index.html", "archive.html", ".nojekyll"]) {
    const src = path.join(REPORTS, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(BRIEF_PUBLIC, name));
    }
  }

  injectChromeIntoBriefTree(BRIEF_PUBLIC);

  console.log(
    `[publish-allenspace] synced ${dates.length} report(s) → ${BRIEF_PUBLIC}`,
  );
  return dates;
}

function pickHeadline(data, date) {
  if (!data) return date;
  const h = (data.hero_headline || "").trim();
  if (h) return h;
  const picks = data.tech_editor_picks;
  if (Array.isArray(picks) && picks[0]?.title) return picks[0].title.trim();
  const briefs = data.tech_briefs;
  if (Array.isArray(briefs) && briefs.length > 0) {
    const top = [...briefs].sort(
      (a, b) => (b.importance ?? 0) - (a.importance ?? 0),
    )[0];
    if (top?.title) return top.title.trim();
  }
  return date;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeManifest(dates) {
  const entries = dates.map((date) => {
    const jsonPath = path.join(REPORTS, date, `${date}.json`);
    const data = readJsonSafe(jsonPath);
    return {
      date,
      headline: pickHeadline(data, date),
      overview: (data?.daily_overview || "").trim(),
      url: `/brief/${date}/${date}.html`,
    };
  });

  const latest = entries[0];
  const manifest = {
    updated: new Date().toISOString(),
    latest: latest?.date ?? null,
    headline: latest?.headline ?? "",
    overview: latest?.overview ?? "",
    dates: entries,
  };

  fs.writeFileSync(
    path.join(BRIEF_PUBLIC, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf8",
  );
  console.log("[publish-allenspace] wrote manifest.json");
  return manifest;
}

function writeBriefNav(dates) {
  const recent = dates.slice(0, NAV_RECENT);
  const items = [
    { text: "最新晚报", link: "/pages/brief-reader/" },
    ...recent.map((d) => ({
      text: d,
      // Use hash — VuePress rewrites `?d=YYYY-MM-DD` into `?d=YYYY-MM-DD.html`
      link: `/pages/brief-reader/#${d}`,
    })),
    { text: "全部归档 →", link: "/pages/brief-archive/" },
  ];

  const body = `/** Auto-generated by DailyBrief publish-allenspace — do not edit by hand */
module.exports = ${JSON.stringify(items, null, 2)}
`;

  fs.mkdirSync(path.dirname(BRIEF_NAV_JS), { recursive: true });
  fs.writeFileSync(BRIEF_NAV_JS, body, "utf8");
  console.log(`[publish-allenspace] wrote brief-nav.js (${recent.length} recent)`);
}

function writeBriefArchiveMd(manifest) {
  const entries = manifest.dates || [];
  const latest = manifest.latest || entries[0]?.date || "";
  const rows =
    entries.length === 0
      ? "<li>暂无晚报</li>"
      : entries
          .map((item) => {
            const headline =
              item.headline && item.headline !== item.date
                ? `\n  <span class="headline">${escapeHtml(item.headline)}</span>`
                : "";
            return `<li><a href="/pages/brief-reader/#${item.date}">${item.date}</a>${headline}</li>`;
          })
          .join("\n");

  const body = `---
title: AI 资讯归档
date: ${latest || new Date().toISOString().slice(0, 10)} 00:00:00
permalink: /pages/brief-archive/
sidebar: false
article: false
comment: false
editLink: false
---

<p class="brief-archive-meta">${entries.length} 期晚报 · 最新 ${latest || "—"}</p>

<ul class="brief-archive-list">
${rows}
</ul>

<p><a href="/pages/brief-reader/">→ 阅读最新晚报</a></p>

<style>
.brief-archive-meta { color: #888; font-size: 0.92rem; }
.brief-archive-list { list-style: none; padding: 0; margin: 1.5rem 0; }
.brief-archive-list li {
  padding: 0.85rem 0;
  border-bottom: 1px solid #eee;
}
.brief-archive-list a { font-weight: 600; text-decoration: none; }
.brief-archive-list a:hover { text-decoration: underline; }
.brief-archive-list .headline {
  display: block;
  margin-top: 0.25rem;
  font-weight: 400;
  color: #666;
  font-size: 0.92rem;
}
</style>
`;

  fs.mkdirSync(path.dirname(BRIEF_ARCHIVE_MD), { recursive: true });
  fs.writeFileSync(BRIEF_ARCHIVE_MD, body, "utf8");
  console.log("[publish-allenspace] wrote brief-archive.md");
}

function gitPushBlog() {
  if (!GIT_PUSH) {
    console.log("[publish-allenspace] GIT_PUSH=false — skipping git commit");
    return;
  }

  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: ALLENSPACE_REPO,
    encoding: "utf8",
  });
  if (status.status !== 0) die("git status failed in blog repo");

  const dirty = (status.stdout || "").trim();
  if (!dirty) {
    console.log("[publish-allenspace] blog repo clean — nothing to commit");
    return;
  }

  const latest = listDates()[0] ?? "unknown";
  spawnSync(
    "git",
    [
      "add",
      "docs/.vuepress/public/brief",
      "docs/.vuepress/config/themeConfig/brief-nav.js",
      "docs/_posts/brief-archive.md",
    ],
    {
    cwd: ALLENSPACE_REPO,
    stdio: "inherit",
  });

  const msg = `brief: publish ${latest} to Allen Space`;
  const commit = spawnSync("git", ["commit", "-m", msg], {
    cwd: ALLENSPACE_REPO,
    stdio: "inherit",
  });
  if (commit.status !== 0) die("git commit failed");

  const push = spawnSync("git", ["push", "origin", "HEAD"], {
    cwd: ALLENSPACE_REPO,
    stdio: "inherit",
  });
  if (push.status !== 0) die("git push failed — commit is local only");

  console.log("[publish-allenspace] pushed blog repo → GitHub Actions will deploy");
}

runBuildSite();
const dates = syncBriefFiles();
const manifest = writeManifest(dates);
writeBriefNav(dates);
writeBriefArchiveMd(manifest);
gitPushBlog();

console.log(
  `[publish-allenspace] done — live after deploy at https://a11en4z.github.io/brief/`,
);
