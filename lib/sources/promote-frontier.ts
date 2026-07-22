import { matchFrontierLab } from "../frontier-labs";
import { sources } from "./registry";
import type { RawArticle } from "./types";

const AI_NEWS_SOURCE_IDS = new Set(
  sources
    .filter(
      (s) =>
        s.category === "tech" &&
        s.subcategory === "ai-news" &&
        s.enabled !== false,
    )
    .map((s) => s.id),
);

/**
 * Promote ai-news items that mention a frontier lab into the frontier
 * subcategory for display (via displaySubcategory override).
 */
export function promoteFrontierArticles<
  T extends RawArticle & { source?: string },
>(articles: T[]): number {
  let n = 0;
  for (const a of articles) {
    if (!AI_NEWS_SOURCE_IDS.has(a.sourceId)) continue;
    if (a.displaySubcategory === "frontier") continue;
    const hit =
      matchFrontierLab(a.title) ??
      matchFrontierLab(a.source ?? "") ??
      (a.excerpt ? matchFrontierLab(a.excerpt) : undefined);
    if (!hit) continue;
    a.displaySubcategory = "frontier";
    n++;
  }
  return n;
}
