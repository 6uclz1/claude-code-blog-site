/**
 * `/llms.txt` の組み立て（https://llmstxt.org/ の書式）。
 *
 * AIエージェントがこのサイトを使うときの入口。「何があるか」ではなく
 * 「どう辿れば本文に届くか」を書く — 検索は `/search/?q=`、本文は記事URL + `.md`。
 * astro:content を読まないので単体テストできる（`src/pages/llms.txt.ts` が使う）。
 */

import { toDescription } from './format';

export interface LlmsPostRef {
  title: string;
  /** HTML版の絶対URL */
  url: string;
  /** Markdown版の絶対URL */
  markdownUrl: string;
  date: Date;
  excerpt?: string;
}

export interface LlmsTxtInput {
  title: string;
  description: string;
  /** サイト内の主要ページ（すべて絶対URL） */
  urls: {
    home: string;
    /** `/search/`。末尾スラッシュ付き */
    search: string;
    /** `/index.json`。全記事とブックマークの機械可読なインデックス */
    index: string;
    archive: string;
    sites: string;
    feed: string;
  };
  /** 公開中の記事数 */
  postCount: number;
  /** 新しい順。llms.txt に一覧として載せる */
  recent: LlmsPostRef[];
}

/** 日付は permalink と同じ暦日（UTC表示）で出す */
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** 一覧に載せる記事数。多すぎると llms.txt 自体が読みにくくなる */
export const LLMS_RECENT_LIMIT = 20;

/**
 * 一覧に添える説明の長さ。旧い記事の excerpt はブックマークのタイトルを
 * すべて並べた数百字のものがあり、そのまま出すと1行が画面を埋める。
 */
const EXCERPT_MAX_CHARS = 120;

export function renderLlmsTxt(input: LlmsTxtInput): string {
  const { urls } = input;
  const searchExample = `${urls.search}?q=Claude+Code`;

  const lines = [
    `# ${input.title}`,
    '',
    `> ${input.description}。${input.postCount}本の記事があり、1本が1日分のブックマークのまとめです。記事にはブックマークごとに見出し・元記事へのリンク・1行要約・要点が入っています。`,
    '',
    '## 読み方',
    '',
    `- 本文の取得: 記事URLの末尾のスラッシュを \`.md\` に替えると Markdown 原文が返ります（例: \`${input.recent[0]?.url ?? urls.home}\` → \`${input.recent[0]?.markdownUrl ?? `${urls.home}...`}\`）。HTMLを解析する必要はありません`,
    `- 検索（JavaScript が使える場合）: [検索](${urls.search}) は \`?q=\` にキーワードを渡せます（例: ${searchExample}）。結果の描画に JavaScript が必要です`,
    `- 検索（JavaScript が使えない場合）: [${urls.index}](${urls.index}) に全${input.postCount}記事とブックマーク（タイトル・リンク先・ホスト名・1行要約）が入っています。1回取得すれば手元で絞り込めます（全文で1MB近くあるので、通しで読むより検索語で絞り込む方が向いています）。当たった記事の \`markdown\` を読めば本文まで届きます`,
    `- 全記事の一覧: [アーカイブ](${urls.archive}) に年ごとの全記事（タイトルと日付）が1ページで載っています`,
    '',
    '## 一覧ページ',
    '',
    `- [インデックス（JSON）](${urls.index}): 全記事とブックマークの機械可読な一覧`,
    `- [アーカイブ](${urls.archive}): 全記事を年ごとにまとめた一覧`,
    `- [ブックマーク先サイト](${urls.sites}): ブックマークされたサイトを件数順に集計`,
    `- [Atomフィード](${urls.feed}): 最新記事の更新通知（本文は含みません）`,
    '',
    '## 最近の記事',
    '',
    ...input.recent.map((post) => {
      const summary = post.excerpt
        ? `: ${toDescription(post.excerpt, EXCERPT_MAX_CHARS)}`
        : '';
      return `- [${isoDate(post.date)} ${post.title}](${post.markdownUrl})${summary}`;
    }),
    '',
  ];

  return lines.join('\n');
}
