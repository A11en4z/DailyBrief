import "./_env";

import fs from "node:fs";
import path from "node:path";

import { generateEditorPicks } from "../lib/ai/editor-picks";
import {
  generateDailyReport,
  type ArticleInput,
} from "../lib/ai/pipeline";
import { getModelTag, validateBackendCredentials } from "../lib/ai/llm";
import {
  enrichFinanceNewsSummaries,
  enrichFrontierSummaries,
  enrichGithubTrendingSummaries,
  enrichQbitaiRewrites,
  enrichTrendingPapersSummaries,
  enrichXViralSummaries,
} from "../lib/ai/enrich";
import { sortFrontierArticles } from "../lib/frontier-labs";
import {
  groupRaw,
  isSportsArticle,
  MERGED_SUBGROUP_LIMITS,
  renderHtml,
  renderMarkdown,
  SOURCE_DISPLAY_LIMITS,
} from "../lib/output/render";
import { promoteFrontierArticles } from "../lib/sources/promote-frontier";
import { sources, REPORT_LOCALE } from "../lib/sources/registry";
import { fetchSource } from "../lib/sources/dispatch";
import { analyzeWatchlist } from "../lib/trading/runner";
import { fetchCryptoFearGreed } from "../lib/trading/fear-greed";
import { fetchCryptoGlobal } from "../lib/trading/coingecko";
import { generateTradingCommentary } from "../lib/ai/trading-commentary";
import type { TradingSection } from "../lib/ai/pipeline";
import { todayKey } from "../lib/utils";

const OUTPUT_DIR = "daily_reports";

function displayCap(key: string, fallback: number): number {
  return SOURCE_DISPLAY_LIMITS[key] ?? fallback;
}

async function fetchAll(): Promise<ArticleInput[]> {
  const articles: ArticleInput[] = [];
  const enabled = sources.filter((s) => s.enabled !== false);
  for (const source of enabled) {
    try {
      const items = await fetchSource(source);
      console.log(`  ${source.id.padEnd(20)} ${items.length}`);
      articles.push(...items.map((it) => ({ ...it, source: source.name })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  ${source.id.padEnd(20)} FAILED — ${msg}`);
    }
  }
  return articles;
}

async function enrichGhTrending(articles: ArticleInput[]): Promise<void> {
  const cap = displayCap("tech:github-trending", 10);
  const gh = articles
    .filter((a) => a.sourceId === "github-trending")
    .slice(0, cap);
  if (gh.length === 0) return;
  console.log(
    `[daily] enriching ${gh.length} GitHub Trending repos with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichGithubTrendingSummaries(gh);
  for (const a of gh) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${gh.length}`,
  );
}

async function enrichFinanceNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "finance", "news");
}

async function enrichPolitics(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "politics", "world");
}

async function enrichAiNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "tech", "ai-news");
}

/**
 * 量子位：rewrite marketing titles + distill factual summaries.
 * Runs on all fetched qbitai items that may appear in frontier or ai-news.
 */
async function enrichQbitai(articles: ArticleInput[]): Promise<void> {
  const items = articles.filter((a) => a.sourceId === "qbitai");
  if (items.length === 0) return;
  console.log(
    `[daily] rewriting ${items.length} 量子位 titles + summaries…`,
  );
  const t0 = Date.now();
  const rewrites = await enrichQbitaiRewrites(
    items.map((a) => ({
      url: a.url,
      title: a.title,
      excerpt: a.excerpt,
      source: a.source,
    })),
  );
  for (const a of items) {
    const r = rewrites.get(a.url);
    if (!r) continue;
    a.title = r.title;
    a.summary = r.summary;
  }
  console.log(
    `[daily] qbitai rewrite done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${rewrites.size}/${items.length}`,
  );
}

async function enrichFrontier(articles: ArticleInput[]): Promise<void> {
  const subSources = sources.filter(
    (s) =>
      s.category === "tech" &&
      s.subcategory === "frontier" &&
      s.enabled !== false,
  );
  const officialIds = new Set(subSources.map((s) => s.id));
  const limit = MERGED_SUBGROUP_LIMITS["tech:frontier"] ?? 10;

  const pool = articles.filter(
    (a) =>
      a.displaySubcategory === "frontier" || officialIds.has(a.sourceId),
  );
  // Skip qbitai — handled by enrichQbitai (title rewrite + summary).
  const top = sortFrontierArticles(pool)
    .filter((a) => a.sourceId !== "qbitai")
    .slice(0, limit);
  const toEnrich = top.filter((a) => !a.summary);
  if (toEnrich.length === 0) return;

  console.log(
    `[daily] enriching ${toEnrich.length}/${top.length} tech:frontier items with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichFrontierSummaries(toEnrich);
  for (const a of toEnrich) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${toEnrich.length}`,
  );
}

async function enrichXViral(articles: ArticleInput[]): Promise<void> {
  const cap = displayCap("tech:x-viral", 10);
  const xPosts = articles
    .filter((a) => a.sourceId === "attentionvc-ai")
    .slice(0, cap);
  if (xPosts.length === 0) return;
  console.log(`[daily] enriching ${xPosts.length} X posts with ${REPORT_LOCALE} summaries…`);
  const t0 = Date.now();
  const summaries = await enrichXViralSummaries(
    xPosts.map((a) => ({
      url: a.url,
      title: a.title,
      excerpt: a.excerpt,
      author: a.url.match(/x\.com\/([^/]+)\//)?.[1] ?? "",
    })),
  );
  for (const a of xPosts) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${xPosts.length}`,
  );
}

async function enrichTrendingPapers(articles: ArticleInput[]): Promise<void> {
  const cap = displayCap("tech:trending-papers", 10);
  const papers = articles
    .filter((a) => a.sourceId === "huggingface-papers")
    .slice(0, cap);
  if (papers.length === 0) return;
  console.log(
    `[daily] enriching ${papers.length} trending papers with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichTrendingPapersSummaries(
    papers.map((a) => ({ url: a.url, title: a.title, excerpt: a.excerpt })),
  );
  for (const a of papers) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${papers.length}`,
  );
}

async function enrichMergedSubgroup(
  articles: ArticleInput[],
  category: "tech" | "finance" | "politics",
  subcategory: string,
): Promise<void> {
  const subSources = sources.filter(
    (s) =>
      s.category === category &&
      s.subcategory === subcategory &&
      s.enabled !== false,
  );
  const enabledIds = new Set(subSources.map((s) => s.id));
  const sameLocaleIds = new Set(
    subSources.filter((s) => (s.lang ?? "en") === REPORT_LOCALE).map((s) => s.id),
  );
  const limit = MERGED_SUBGROUP_LIMITS[`${category}:${subcategory}`] ?? 12;
  const top = articles
    .filter((a) => enabledIds.has(a.sourceId))
    .filter((a) => (a.displaySubcategory ?? subcategory) === subcategory)
    .filter((a) => category !== "politics" || !isSportsArticle(a.title))
    .sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    )
    .slice(0, limit);
  // Tech tabs hide English excerpts and need a 中文介绍 even for zh sources
  // (distill / de-clickbait). Finance/politics still skip same-locale sources.
  const toEnrich =
    category === "tech"
      ? top.filter((a) => a.sourceId !== "qbitai" && !a.summary)
      : top.filter((a) => !sameLocaleIds.has(a.sourceId));
  if (toEnrich.length === 0) return;
  console.log(
    `[daily] enriching ${toEnrich.length}/${top.length} ${category}:${subcategory} items with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichFinanceNewsSummaries(toEnrich);
  for (const a of toEnrich) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${toEnrich.length}`,
  );
}

async function runTrading(): Promise<TradingSection | null> {
  console.log(`[daily] analyzing watchlist + crypto context (Yahoo / alt.me / CoinGecko)…`);
  const t0 = Date.now();
  const [tickers, cryptoFearGreed, cryptoGlobal] = await Promise.all([
    analyzeWatchlist(),
    fetchCryptoFearGreed(),
    fetchCryptoGlobal(),
  ]);
  console.log(
    `[daily] indicators ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${tickers.length} tickers` +
      (cryptoFearGreed ? `, F&G ${cryptoFearGreed.value}` : ", F&G ✗") +
      (cryptoGlobal
        ? `, BTC dom ${cryptoGlobal.btcDominance.toFixed(1)}%`
        : ", CG ✗"),
  );
  if (tickers.length === 0) return null;
  console.log(`[daily] generating trading commentary with ${getModelTag()}…`);
  const t1 = Date.now();
  const commentary = await generateTradingCommentary({
    tickers,
    cryptoFearGreed: cryptoFearGreed ?? undefined,
    cryptoGlobal: cryptoGlobal ?? undefined,
  });
  console.log(
    `[daily] trading commentary ready in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
  );
  return {
    ...commentary,
    tickers,
    crypto_fear_greed: cryptoFearGreed ?? undefined,
    crypto_global: cryptoGlobal ?? undefined,
    generated_at: new Date().toISOString(),
  };
}

function registrySubcategoryMap(): Map<string, string | undefined> {
  const m = new Map<string, string | undefined>();
  for (const s of sources) m.set(s.id, s.subcategory);
  return m;
}

async function main() {
  validateBackendCredentials();

  const date = todayKey();
  console.log(`[daily] ${date} — fetching sources…\n`);
  const articles = await fetchAll();
  console.log(`\n[daily] total articles: ${articles.length}`);
  if (articles.length === 0) {
    throw new Error("no articles fetched — aborting");
  }

  const promoted = promoteFrontierArticles(articles);
  if (promoted > 0) {
    console.log(`[daily] promoted ${promoted} ai-news items → frontier`);
  }

  await enrichQbitai(articles);
  await enrichGhTrending(articles);
  await enrichTrendingPapers(articles);
  await enrichFinanceNews(articles);
  await enrichPolitics(articles);
  await enrichFrontier(articles);
  await enrichAiNews(articles);
  await enrichXViral(articles);

  console.log(`[daily] generating editor picks with ${getModelTag()}…`);
  const picksT0 = Date.now();
  const techEditorPicks = await generateEditorPicks(
    articles,
    registrySubcategoryMap(),
  );
  console.log(
    `[daily] editor picks ready in ${((Date.now() - picksT0) / 1000).toFixed(1)}s (${techEditorPicks.length} items)`,
  );

  let trading: TradingSection | null = null;
  if (process.env.REPORT_TRADING === "true") {
    try {
      trading = await runTrading();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[daily] trading section failed: ${msg}`);
    }
  } else {
    console.log(`[daily] trading section disabled (set REPORT_TRADING=true to enable)`);
  }

  console.log(`[daily] generating digest with ${getModelTag()}…`);
  const t0 = Date.now();
  const { report } = await generateDailyReport(articles);
  if (trading) report.trading = trading;
  if (techEditorPicks.length > 0) report.tech_editor_picks = techEditorPicks;
  console.log(`[daily] digest ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);
  const raw = groupRaw(articles, sources);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(
    `${base}-articles.json`,
    JSON.stringify({ date, articles }, null, 2),
    "utf8",
  );
  fs.writeFileSync(`${base}.html`, renderHtml(report, raw, date), "utf8");
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(report, date), "utf8");
    console.log(`[daily] wrote ${base}.{json,html,md,articles.json}`);
  } else {
    console.log(`[daily] wrote ${base}.{json,html,articles.json}`);
  }

  console.log(`[daily] done.`);
}

main().catch((e) => {
  console.error(`[daily] FAILED:`, e);
  process.exit(1);
});
