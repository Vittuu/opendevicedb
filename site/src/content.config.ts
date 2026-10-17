import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

// News posts live at the repository root: news/YYYY-MM-DD-slug.md
const news = defineCollection({
  loader: glob({ pattern: "*.md", base: "../news" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { news };
