/**
 * Gemini でブックマーク1件分の短い要約（1行 + 箇条書き）を作る。
 */

import { GoogleGenAI, type GenerateContentConfig } from '@google/genai';

import type { Bookmark } from './bookmark-feed.ts';
import { describeError, logger } from './logger.ts';
import { sleep } from './sleep.ts';
// パーセントエンコードのままのタイトルを戻す処理はサイト側と同じものを使う
import { displayTitle } from '../../src/lib/url.ts';

export const GEMINI_MODEL = 'gemini-2.5-flash';
/**
 * 混雑(503)やレート制限(429)が続いたときに切り替えるモデル。
 * 別モデルは別の枠で動くので、同じモデルを待ち続けるより通ることが多い。
 */
export const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash-lite';
/**
 * 一時的なエラーでの再試行の待ち時間（ミリ秒）。要素数が再試行の回数。
 * 2026-10-29 の実行は 503 "high demand" を1回受けただけで2件とも要約を諦め、
 * 2026-10-28 の記事が作られなかった。数十秒待てば戻ることが多い。
 */
export const GEMINI_RETRY_WAITS_MS = [5_000, 15_000, 30_000];

// 要約の分量。ここを変えると記事全体のボリュームが変わる
export const SUMMARY_MAX_CHARS = 120;
export const POINT_MAX_CHARS = 45;
export const MAX_POINTS = 3;

export const SUMMARY_FALLBACK = '要約を生成できませんでした。詳しくは元記事をご覧ください。';

/** 1件分の短い要約。summary は1行、points は箇条書き（最大 MAX_POINTS 件） */
export interface Digest {
  summary: string;
  points: string[];
}

export const digest = (summary: string, points: string[] = []): Digest => ({ summary, points });

export const PROMPT_TEMPLATE = `あなたは技術ブログの朝刊コーナーの編集者です。
読者が出勤前に数十秒で全体を把握できるよう、次の記事を短くまとめてください。

制約:
- summary: 記事の要点を1文で。{summary_max}文字以内。体言止めや「〜する内容」のような要約調で簡潔に。
- points: 補足したい具体的な情報を最大{max_points}個。各{point_max}文字以内の短い句。無ければ空配列。
- 前置き・感想・元記事へのリンク案内は書かない。
- 専門用語は必要な範囲で残しつつ、平易な日本語にする。

次のJSONのみを出力してください:
{"summary": "...", "points": ["...", "..."]}

タイトル: {title}
URL: {url}

記事内容:
{content}
`;

export function buildPrompt(bookmark: Bookmark, articleText: string): string {
  const values: Record<string, string> = {
    summary_max: String(SUMMARY_MAX_CHARS),
    point_max: String(POINT_MAX_CHARS),
    max_points: String(MAX_POINTS),
    // パーセントエンコードのままのタイトルは Gemini にも読めないので戻す
    title: displayTitle(bookmark.title),
    url: bookmark.url,
    content: articleText,
  };
  // 出力例の JSON にも `{...}` が出てくるので、既知のキーだけを置き換える
  return PROMPT_TEMPLATE.replace(/\{(summary_max|point_max|max_points|title|url|content)\}/g,
    (_, key: string) => values[key] ?? '');
}

/** 箇条書き記号や余分な空白・強調記法を落として1行にする */
function normalize(text: unknown): string {
  let value = String(text ?? '').replace(/\s+/g, ' ').trim();
  value = value.replace(/^[-*・•\d]+[.)]?\s*/, '');
  return value.replace(/\*\*/g, '').trim();
}

/** limit 文字以内に収める。文の途中で切れないよう句点を優先する */
function shorten(text: unknown, limit: number): string {
  const value = normalize(text);
  if (value.length <= limit) return value;

  const head = value.slice(0, limit);
  const sentenceEnd = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'));
  if (sentenceEnd >= Math.floor(limit / 2)) return head.slice(0, sentenceEnd + 1);
  // 末尾の「…」も1文字分なので、その分だけ短く切る
  return `${value.slice(0, limit - 1).replace(/\s+$/, '')}…`;
}

/** モデル出力からJSONオブジェクトを取り出す（```json フェンス付きにも対応） */
function extractJson(raw: string): Record<string, unknown> | undefined {
  let text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]+?)```/.exec(text);
  if (fenced?.[1]) {
    text = fenced[1].trim();
  } else {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) text = text.slice(start, end + 1);
  }

  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** モデル出力を Digest に変換する。JSONで返らなかった場合は本文の先頭を使う */
export function parseDigest(raw: string): Digest {
  const payload = extractJson(raw) ?? {};

  let summary = shorten(payload.summary ?? '', SUMMARY_MAX_CHARS);
  if (!summary) {
    // JSONとして壊れていても、プレーンテキストの1行目が使えることが多い
    const firstLine = raw.split('\n').find((line) => normalize(line)) ?? '';
    summary = shorten(firstLine, SUMMARY_MAX_CHARS);
  }

  const rawPoints = payload.points ?? [];
  const candidates = Array.isArray(rawPoints) ? rawPoints : [rawPoints];

  const points: string[] = [];
  for (const candidate of candidates) {
    const shortened = shorten(candidate, POINT_MAX_CHARS);
    if (shortened && shortened !== summary) points.push(shortened);
    if (points.length >= MAX_POINTS) break;
  }

  return digest(summary || SUMMARY_FALLBACK, points);
}

/**
 * 要約リクエストの生成設定。
 *
 * SDKの型を通して組み立てるので、設定名がSDKのバージョンに存在しなくなれば
 * 型チェック（npm run check）で気づける。
 */
export function generationConfig(): GenerateContentConfig {
  return {
    responseMimeType: 'application/json',
    temperature: 0.2,
  };
}

export interface Summarizer {
  summarize(bookmark: Bookmark, articleText: string): Promise<Digest>;
}

/** テストから差し替えられるよう、SDKのうち実際に使う部分だけを型にしている */
export interface GenerativeClient {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config: GenerateContentConfig;
    }): Promise<{ text?: string | undefined }>;
  };
}

/**
 * 待てば通る見込みのある Gemini のエラーか。
 *
 * SDK の ApiError は `status` に HTTP ステータスを持つが、メッセージに
 * `{"error":{"code":503,...,"status":"UNAVAILABLE"}}` が入るだけのこともあるので両方を見る。
 * 400（プロンプト不正）や 403（APIキー）は何度試しても同じなので再試行しない。
 */
export function isTransientGeminiError(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return status === 408 || status === 429 || status >= 500;

  const message = error instanceof Error ? error.message : String(error);
  const code = /"code"\s*:\s*(\d{3})/.exec(message)?.[1];
  if (code) return code === '408' || code === '429' || Number(code) >= 500;
  return /UNAVAILABLE|RESOURCE_EXHAUSTED|DEADLINE_EXCEEDED|INTERNAL|overloaded|high demand|fetch failed|ECONNRESET|ETIMEDOUT|timed? ?out/i.test(
    message
  );
}

export interface GeminiSummarizerOptions {
  model?: string;
  /** 一時的なエラーが続いたときに切り替えるモデル。null なら切り替えない */
  fallbackModel?: string | null;
  client?: GenerativeClient;
  /** 再試行の待ち時間。要素数が再試行の回数 */
  retryWaitsMs?: number[];
  /** テストから待ち時間を潰すために差し替える */
  wait?: (ms: number) => Promise<void>;
}

/** Gemini で1件分の短い要約を作る */
export class GeminiSummarizer implements Summarizer {
  private readonly client: GenerativeClient;
  private readonly models: string[];
  private readonly retryWaitsMs: number[];
  private readonly wait: (ms: number) => Promise<void>;

  constructor(apiKey: string, options: GeminiSummarizerOptions = {}) {
    this.client = options.client ?? new GoogleGenAI({ apiKey });
    const model = options.model ?? GEMINI_MODEL;
    const fallback =
      options.fallbackModel === undefined ? GEMINI_FALLBACK_MODEL : options.fallbackModel;
    this.models = fallback && fallback !== model ? [model, fallback] : [model];
    this.retryWaitsMs = options.retryWaitsMs ?? GEMINI_RETRY_WAITS_MS;
    this.wait = options.wait ?? sleep;
  }

  async summarize(bookmark: Bookmark, articleText: string): Promise<Digest> {
    const contents = buildPrompt(bookmark, articleText);

    for (const [modelIndex, model] of this.models.entries()) {
      // 本命のモデルは待って再試行し、代替モデルは1回だけ試す
      const waits = modelIndex === 0 ? this.retryWaitsMs : [];

      for (let attempt = 0; ; attempt += 1) {
        try {
          const response = await this.client.models.generateContent({
            model,
            contents,
            config: generationConfig(),
          });
          return parseDigest(response.text ?? '');
        } catch (error) {
          const transient = isTransientGeminiError(error);
          logger.error(
            `Error generating summary for ${bookmark.url} (${model}, attempt ${attempt + 1}): ${describeError(error)}`
          );
          // 1記事の失敗で全体を止めない。一時的でないエラーは別モデルでも同じ
          if (!transient) return digest(SUMMARY_FALLBACK);

          const waitMs = waits[attempt];
          if (waitMs === undefined) break;
          logger.info(`Retrying in ${waitMs / 1000}s...`);
          await this.wait(waitMs);
        }
      }

      const next = this.models[modelIndex + 1];
      if (next) logger.warn(`Falling back to ${next} for ${bookmark.url}`);
    }

    return digest(SUMMARY_FALLBACK);
  }
}
