import { jsonrepair } from "jsonrepair";
import { matchFrontierLab } from "../frontier-labs";
import { REPORT_LOCALE } from "../sources/registry";
import type { ArticleInput, EditorPickItem } from "./pipeline";
import { extractJson } from "./json-util";
import { runLlm } from "./llm";

export type { EditorPickItem };

const SYSTEM_ZH = `你是 AI 晚报的主编。从候选新闻中挑出 5-8 条「今日必看」。

优先级（从高到低）：
1. 前沿实验室（OpenAI / Anthropic / Google / Meta / xAI / Moonshot / DeepSeek / 阿里通义等）的模型发布、API/产品上线、重大融资、安全政策
2. 改变竞争格局或能力边界的行业动态
3. 跨源重复报道的重要事件（合并为一条）

禁止：
- 纯教程、周刊目录、小工具评测凑数
- 编造 url 或事实

输出严格 JSON：
{
  "picks": [
    {
      "title": "≤25字中文标题",
      "url": "必须从输入复制",
      "source": "原样回填",
      "summary": "30-80字事实摘要",
      "importance": 1-10,
      "lab": "实验室 id 或空"
    }
  ]
}

importance 8-10 仅给「改变能力边界或竞争格局」级；按 importance 降序排列。`;

const SYSTEM_EN = `You are the editor of an AI evening brief. Pick 5-8 must-read items.

Priority (high to low):
1. Frontier lab news: model releases, API/product launches, major funding, safety policy
2. Industry shifts that change the competitive landscape or capability frontier
3. Cross-source coverage of the same major event (merge into one)

Do NOT pick pure tutorials, newsletter digests, or minor tool reviews.
Never invent urls or facts.

Output STRICT JSON:
{
  "picks": [
    {
      "title": "rewritten headline ≤25 words",
      "url": "copied exactly from input",
      "source": "verbatim from input",
      "summary": "30-80 word factual summary",
      "importance": 1-10,
      "lab": "lab id or empty"
    }
  ]
}

Use 8-10 only for landscape-changing items; sort by importance descending.`;

function effectiveSubcategory(
  a: ArticleInput,
  registrySub: string | undefined,
): string | undefined {
  return a.displaySubcategory ?? registrySub;
}

function collectCandidates(
  articles: ArticleInput[],
  registrySubOf: Map<string, string | undefined>,
): ArticleInput[] {
  const frontierLimit = 10;
  const aiNewsLimit = 15;

  const frontier: ArticleInput[] = [];
  const aiNews: ArticleInput[] = [];
  const extras: ArticleInput[] = [];

  for (const a of articles) {
    if (a.category !== "tech") continue;
    const sub = effectiveSubcategory(a, registrySubOf.get(a.sourceId));
    if (sub === "frontier") frontier.push(a);
    else if (sub === "ai-news") aiNews.push(a);
    else if (
      a.sourceId === "github-trending" ||
      a.sourceId === "huggingface-papers" ||
      a.sourceId === "attentionvc-ai"
    ) {
      extras.push(a);
    }
  }

  const byDate = (x: ArticleInput, y: ArticleInput) =>
    (y.publishedAt?.getTime() ?? 0) - (x.publishedAt?.getTime() ?? 0);

  frontier.sort(byDate);
  aiNews.sort(byDate);
  extras.sort(byDate);

  const gh = extras.filter((a) => a.sourceId === "github-trending").slice(0, 2);
  const papers = extras
    .filter((a) => a.sourceId === "huggingface-papers")
    .slice(0, 2);
  const xPosts = extras
    .filter((a) => a.sourceId === "attentionvc-ai")
    .slice(0, 2);

  const seen = new Set<string>();
  const out: ArticleInput[] = [];
  for (const a of [
    ...frontier.slice(0, frontierLimit),
    ...aiNews.slice(0, aiNewsLimit),
    ...gh,
    ...papers,
    ...xPosts,
  ]) {
    if (seen.has(a.url)) continue;
    seen.add(a.url);
    out.push(a);
  }
  return out;
}

export async function generateEditorPicks(
  articles: ArticleInput[],
  registrySubOf: Map<string, string | undefined>,
): Promise<EditorPickItem[]> {
  const candidates = collectCandidates(articles, registrySubOf);
  if (candidates.length === 0) return [];

  const payload = candidates.map((a, i) => ({
    n: i + 1,
    title: a.title,
    url: a.url,
    source: a.source,
    summary: a.summary ?? (a.excerpt ?? "").slice(0, 200),
    lab: matchFrontierLab(a.title)?.id ?? matchFrontierLab(a.source)?.id ?? "",
  }));

  const systemPrompt = REPORT_LOCALE === "en" ? SYSTEM_EN : SYSTEM_ZH;
  const userPrompt =
    REPORT_LOCALE === "en"
      ? [
          "**Output language: ENGLISH ONLY.**",
          "",
          `Pick 5-8 items from these ${payload.length} candidates:`,
          JSON.stringify(payload),
        ].join("\n")
      : [
          "**输出语言：仅中文。**",
          "",
          `从以下 ${payload.length} 条候选中挑选 5-8 条：`,
          JSON.stringify(payload),
        ].join("\n");

  try {
    const { text } = await runLlm({ systemPrompt, userPrompt, timeoutMs: 120_000 });
    const cleaned = extractJson(text);
    let parsed: { picks?: EditorPickItem[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = JSON.parse(jsonrepair(cleaned));
    }
    const picks = (parsed.picks ?? [])
      .filter((p) => p.url && p.title && p.summary)
      .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
      .slice(0, 8);
    return picks;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[editor-picks] failed: ${msg}`);
    return [];
  }
}
