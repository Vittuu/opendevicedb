import rss from "@astrojs/rss";
import type { APIContext } from "astro";
import { posts, postUrl } from "../lib/news.ts";

export async function GET(context: APIContext) {
  const all = await posts();
  return rss({
    title: "OpenDeviceDB news",
    description: "News from OpenDeviceDB, the open directory of reverse-engineered devices.",
    site: context.site!,
    items: all.map((p) => ({
      title: p.data.draft ? `[draft] ${p.data.title}` : p.data.title,
      pubDate: p.data.date,
      description: p.data.summary,
      link: postUrl(p),
      categories: p.data.tags,
    })),
  });
}
