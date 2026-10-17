import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"news">;

/** All posts, newest first. Prototype: drafts are listed too, with a "draft" badge. */
export async function posts(): Promise<Post[]> {
  const all = await getCollection("news");
  return all.sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

export const postUrl = (p: Post) => `/news/${p.id}/`;
export const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
