import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// Jekyll 時代の `_posts/` をそのままコンテンツソースとして使う。
// 記事を自動生成する scripts/fetch_and_summarize.py の出力先を変えずに済ませるため。
const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './_posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // Jekyll の permalink をそのまま記事URLに使う（既存URLを維持する）
    permalink: z.string(),
    excerpt: z.string().optional(),
    // Jekyll 用の指定。Astro では使わないが、既存記事に残っているため許容する
    layout: z.string().optional(),
  }),
});

export const collections = { posts };
