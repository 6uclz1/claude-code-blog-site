/**
 * 記事の日付まわり。
 *
 * ブックマーク日（暦日）と、記事の front matter に入れる日時を扱う。
 * JST は夏時間を持たない固定オフセット(+09:00)なので、タイムゾーンDBは使わずに
 * オフセット計算だけで済ませている。
 */

/** 時刻を持たない暦日。JS の Date はタイムゾーンが混ざるので値オブジェクトにする */
export interface CivilDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** JST の UTC からのオフセット（分）。夏時間はない */
export const JST_OFFSET_MINUTES = 9 * 60;

/**
 * 記事の date に使う時刻（JST）。
 * JST の9時 = UTC の0時。表示は UTC 基準（src/lib/posts.ts）なので、
 * ここを9時に固定しておけばいつ実行しても表示日付がパーマリンクと一致する。
 */
export const POST_TIME_JST = { hour: 9, minute: 0, second: 0 };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

export function civilDate(year: number, month: number, day: number): CivilDate {
  return { year, month, day };
}

/** 暦日を「UTCの0時」の Date にして日数計算に使う */
function toUtcMidnight(date: CivilDate): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function fromUtcParts(instant: Date): CivilDate {
  return civilDate(instant.getUTCFullYear(), instant.getUTCMonth() + 1, instant.getUTCDate());
}

/** `YYYY-MM-DD` を暦日にする。形式が違う・存在しない日付なら undefined */
export function parseCivilDate(text: string): CivilDate | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return undefined;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // 2025-02-30 のような存在しない日付は Date が繰り上げるので、往復させて確かめる
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() + 1 !== month ||
    parsed.getUTCDate() !== day
  ) {
    return undefined;
  }
  return civilDate(year, month, day);
}

/** `YYYYMMDD` を暦日にする（はてなのエントリIDに埋まっている形式） */
export function parseCompactCivilDate(text: string): CivilDate | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  if (!match) return undefined;
  return parseCivilDate(`${match[1]}-${match[2]}-${match[3]}`);
}

export function formatCivilDate(date: CivilDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** 2025年06月21日 */
export function formatJapaneseDate(date: CivilDate): string {
  return `${date.year}年${pad(date.month)}月${pad(date.day)}日`;
}

/** 06月21日（週の範囲表記の後半に使う） */
export function formatJapaneseMonthDay(date: CivilDate): string {
  return `${pad(date.month)}月${pad(date.day)}日`;
}

/** パーマリンクの `YYYY/MM/DD` 部分 */
export function formatDatePath(date: CivilDate): string {
  return `${date.year}/${pad(date.month)}/${pad(date.day)}`;
}

export function addDays(date: CivilDate, days: number): CivilDate {
  return fromUtcParts(new Date(toUtcMidnight(date).getTime() + days * MS_PER_DAY));
}

export function isSameDate(a: CivilDate, b: CivilDate): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** ある瞬間を JST で見たときの暦日 */
export function jstDateOf(instant: Date): CivilDate {
  return fromUtcParts(new Date(instant.getTime() + JST_OFFSET_MINUTES * MS_PER_MINUTE));
}

/** 日本時間での「昨日」 */
export function yesterdayInJst(now: Date = new Date()): CivilDate {
  return addDays(jstDateOf(now), -1);
}

/**
 * front matter の date に入れる文字列（`2025-06-21 09:00:00 +0900`）。
 *
 * 実行時刻ではなく対象日から決める。実行時刻を入れていた頃は cron の時間帯
 * （23:00 UTC）でたまたま日付が一致していただけで、日中に手動実行すると
 * 表示日付（UTC基準）がパーマリンクと1日ずれていた。
 */
export function postDateStamp(date: CivilDate): string {
  const { hour, minute, second } = POST_TIME_JST;
  return (
    `${formatCivilDate(date)} ${pad(hour)}:${pad(minute)}:${pad(second)} ` +
    `+${pad(Math.floor(JST_OFFSET_MINUTES / 60))}${pad(JST_OFFSET_MINUTES % 60)}`
  );
}

/** ISO 8601 などの日時文字列を Date にする。読めなければ undefined */
export function parseInstant(text: string): Date | undefined {
  const parsed = new Date(text.trim());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
