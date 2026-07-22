/**
 * Frontier AI labs tracked for the 巨头动态 L2 and editor-picks priority.
 * Anchored to LMArena Overall Top 15 ∪ Coding Top 10 model providers (2026-07).
 */

export interface FrontierLab {
  id: string;
  /** Display name in zh reports */
  nameZh: string;
  nameEn: string;
  aliases: string[];
}

export const FRONTIER_LABS: FrontierLab[] = [
  {
    id: "openai",
    nameZh: "OpenAI",
    nameEn: "OpenAI",
    aliases: ["OpenAI", "GPT", "ChatGPT", "o1", "o3", "o4"],
  },
  {
    id: "anthropic",
    nameZh: "Anthropic",
    nameEn: "Anthropic",
    aliases: ["Anthropic", "Claude", "Fable"],
  },
  {
    id: "google",
    nameZh: "Google DeepMind",
    nameEn: "Google DeepMind",
    aliases: ["Google", "DeepMind", "Gemini", "Google DeepMind"],
  },
  {
    id: "xai",
    nameZh: "xAI",
    nameEn: "xAI",
    aliases: ["xAI", "Grok"],
  },
  {
    id: "meta",
    nameZh: "Meta",
    nameEn: "Meta",
    aliases: ["Meta", "Llama", "Muse"],
  },
  {
    id: "moonshot",
    nameZh: "月之暗面",
    nameEn: "Moonshot AI",
    aliases: ["Moonshot", "Kimi", "月之暗面", "Moonshot AI"],
  },
  {
    id: "deepseek",
    nameZh: "DeepSeek",
    nameEn: "DeepSeek",
    aliases: ["DeepSeek", "深度求索"],
  },
  {
    id: "alibaba",
    nameZh: "阿里通义",
    nameEn: "Alibaba Qwen",
    aliases: ["Alibaba", "Qwen", "通义", "阿里", "千问"],
  },
];

/** Official blog RSS sources registered under subcategory `frontier`. */
export const FRONTIER_OFFICIAL_SOURCE_IDS = new Set([
  "openai-news",
  "deepmind-blog",
  "anthropic-news",
  "meta-ai-blog",
  "google-ai-blog",
  "xai-news",
  "qwen-blog",
  "deepseek-news",
  "moonshot-news",
]);

const ALIAS_ENTRIES: Array<{ lab: FrontierLab; re: RegExp }> = FRONTIER_LABS.flatMap(
  (lab) =>
    lab.aliases.map((alias) => ({
      lab,
      re: new RegExp(alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
    })),
);

export function matchFrontierLab(text: string): FrontierLab | undefined {
  if (!text.trim()) return undefined;
  for (const { lab, re } of ALIAS_ENTRIES) {
    if (re.test(text)) return lab;
  }
  return undefined;
}

/** Official blog entries first, then keyword-promoted media coverage. */
export function sortFrontierArticles<T extends { sourceId: string; publishedAt?: Date }>(
  items: T[],
): T[] {
  const byDate = (x: T, y: T) =>
    (y.publishedAt?.getTime() ?? 0) - (x.publishedAt?.getTime() ?? 0);
  const official = items
    .filter((a) => FRONTIER_OFFICIAL_SOURCE_IDS.has(a.sourceId))
    .sort(byDate);
  const rest = items
    .filter((a) => !FRONTIER_OFFICIAL_SOURCE_IDS.has(a.sourceId))
    .sort(byDate);
  return [...official, ...rest];
}
