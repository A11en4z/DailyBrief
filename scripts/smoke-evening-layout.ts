/**
 * Smoke test for evening-report changes (no LLM / network).
 * Run: npx tsx scripts/smoke-evening-layout.ts
 */
import { promoteFrontierArticles } from "../lib/sources/promote-frontier";
import { matchFrontierLab } from "../lib/frontier-labs";
import type { ArticleInput } from "../lib/ai/pipeline";
import {
  groupRaw,
  renderHtml,
  SOURCE_DISPLAY_LIMITS,
  MERGED_SUBGROUP_LIMITS,
} from "../lib/output/render";
import { sources } from "../lib/sources/registry";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

function mkArticle(
  partial: Partial<ArticleInput> & Pick<ArticleInput, "sourceId" | "title" | "url">,
): ArticleInput {
  return {
    category: "tech",
    source: partial.sourceId,
    publishedAt: new Date("2026-07-22T12:00:00Z"),
    ...partial,
  };
}

// --- limits config ---
assert(SOURCE_DISPLAY_LIMITS["tech:github-trending"] === 10, "GH cap 10");
assert(SOURCE_DISPLAY_LIMITS["tech:x-viral"] === 10, "X cap 10");
assert(MERGED_SUBGROUP_LIMITS["tech:ai-news"] === 15, "ai-news cap 15");
assert(MERGED_SUBGROUP_LIMITS["tech:frontier"] === 10, "frontier cap 10");

// --- frontier matching ---
assert(matchFrontierLab("OpenAI releases GPT-5")?.id === "openai", "match OpenAI");
assert(matchFrontierLab("月之暗面发布 Kimi K3")?.id === "moonshot", "match Moonshot");

// --- promote ---
const articles: ArticleInput[] = [
  mkArticle({
    sourceId: "tldr-ai",
    title: "Anthropic launches Claude 4",
    url: "https://example.com/a",
    excerpt: "English excerpt should hide in ai-news render",
    summary: "Anthropic 发布 Claude 4，强化推理能力。",
  }),
  mkArticle({
    sourceId: "openai-news",
    title: "OpenAI blog post",
    url: "https://openai.com/1",
    summary: "OpenAI 官博更新。",
  }),
  mkArticle({
    sourceId: "qbitai",
    title: "重磅！一文看懂某某模型炸了",
    url: "https://qbitai.com/clickbait",
    excerpt: "某公司发布新模型，参数规模达千亿，在基准测试上取得领先。",
    // no summary — zh excerpt fallback should fill 中文介绍
  }),
  ...Array.from({ length: 12 }, (_, i) =>
    mkArticle({
      sourceId: "github-trending",
      title: `repo-${i}`,
      url: `https://github.com/o/r${i}`,
      excerpt: `desc ${i}`,
      summary: `中文介绍 repo-${i}`,
    }),
  ),
  ...Array.from({ length: 12 }, (_, i) =>
    mkArticle({
      sourceId: "huggingface-papers",
      title: `Paper ${i}`,
      url: `https://hf.co/p${i}`,
      excerpt: `Abstract ${i}`,
      summary: `中文介绍 ${i}`,
    }),
  ),
];

const promoted = promoteFrontierArticles(articles);
assert(promoted >= 1, "promote at least tldr anthropic item");
assert(
  articles.find((a) => a.url === "https://example.com/a")?.displaySubcategory ===
    "frontier",
  "promoted item tagged frontier",
);

const raw = groupRaw(articles, sources);
const ghSub = raw.tech.find((s) => s.id === "github-trending");
assert(ghSub?.sources[0]?.items.length === 10, "GH display capped at 10");
const papersSub = raw.tech.find((s) => s.id === "trending-papers");
assert(papersSub?.sources[0]?.items.length === 10, "papers capped at 10");
const frontierSub = raw.tech.find((s) => s.id === "frontier");
assert(frontierSub !== undefined, "frontier L2 exists");
assert(
  (frontierSub?.sources[0]?.items.length ?? 0) >= 2,
  "frontier has openai + promoted",
);
const aiNewsSub = raw.tech.find((s) => s.id === "ai-news");
const aiCount = aiNewsSub?.sources[0]?.items.length ?? 0;
assert(aiCount <= 15, "ai-news merge cap 15");

const html = renderHtml(
  {
    hero_headline: "测试头条",
    daily_overview: "测试总览",
    tech_briefs: [],
    finance_briefs: [],
    politics_briefs: [],
    editor_note: "",
    keywords: [],
    tech_editor_picks: [
      {
        title: "精选：Claude 发布",
        url: "https://example.com/pick",
        source: "TLDR AI",
        summary: "改变竞争格局的发布。",
        importance: 9,
        lab: "anthropic",
      },
    ],
  },
  raw,
  "2026-07-23",
);

assert(html.includes('id="top"'), "main anchor top");
assert(html.includes("back-to-top"), "back-to-top button");
assert(html.includes("今日精选"), "editor picks section zh");
assert(html.includes("9/10"), "importance badge");
assert(html.includes("巨头动态"), "frontier L2 label");
assert(html.includes("中文介绍"), "Chinese intro label present");
assert(html.includes("中文介绍 repo-0"), "GH shows Chinese summary");
assert(!html.includes("desc 0"), "GH English description hidden");
assert(html.includes("中文介绍 0"), "papers Chinese intro shown");
assert(!html.includes("Abstract 0"), "papers English abstract hidden");
assert(
  !html.includes("English excerpt should hide in ai-news render"),
  "promoted English excerpt hidden",
);
assert(
  html.includes("某公司发布新模型") || html.includes("参数规模达千亿"),
  "qbitai zh excerpt fallback as 中文介绍",
);
assert(!html.includes('<p class="article-excerpt">'), "no English excerpt paragraphs in tech");

console.log("✓ smoke-evening-layout: all checks passed");
console.log(`  frontier items: ${frontierSub?.sources[0]?.items.length}`);
console.log(`  ai-news items: ${aiCount}`);
