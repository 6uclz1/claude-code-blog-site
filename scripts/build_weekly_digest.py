#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""日次のまとめ記事を1週間分たばねた「週刊まとめ」を生成する。

日次の記事は毎朝流れていくため、1週間経つとトップページから押し出されて
読み返す機会がなくなる。週の終わりに1本だけ振り返り用の記事を作る。

要約はすでに日次の記事にあるので、ここではAIを呼ばずに
`_posts/` にある日次記事からブックマークの見出しを集めて並べ直すだけにしている
（APIキー不要・毎回同じ出力になるため、失敗しても影響が小さい）。

使い方:
    python scripts/build_weekly_digest.py [--week-ending YYYY-MM-DD] [--dry-run]
"""

from __future__ import annotations

import argparse
import logging
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from datetime import time as clock_time
from pathlib import Path
from typing import Sequence
from urllib.parse import urlparse

import pytz
import yaml

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

POSTS_DIR = Path("_posts")
JST = pytz.timezone("Asia/Tokyo")

# 日次記事のファイル名（YYYY-MM-DD-hatena-bookmarks.md）
DAILY_SLUG = "hatena-bookmarks"
WEEKLY_SLUG = "weekly-digest"

# まとめる日数
WEEK_DAYS = 7

# 記事の date に使う時刻（JST）。日次記事と同じ考え方で、実行時刻ではなく
# 対象日から決める（JSTの9時 = UTCの0時。表示はUTC基準なので日付がずれない）
POST_TIME_JST = clock_time(9, 0)

# 「よく読んだサイト」に出す上限
TOP_HOSTS = 5

FRONT_MATTER_RE = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)

# 日次記事の見出し。src/lib/bookmarks.ts と同じ2形式を扱う
HEADING_WITH_LINK_RE = re.compile(r"^##\s+\[(.+)\]\((https?://[^)]+)\)\s*$")
HEADING_NUMBERED_RE = re.compile(r"^##\s+\d+\.\s+(.+?)\s*$")
URL_LINE_RE = re.compile(r"^\*\*URL:\*\*\s*\[[^\]]*\]\((https?://[^)]+)\)")


class AbortRun(RuntimeError):
    """記事を作らずに異常終了すべき状況"""


@dataclass(frozen=True)
class Bookmark:
    title: str
    url: str | None = None


@dataclass(frozen=True)
class DailyDigest:
    """日次記事1本ぶん"""

    day: date
    bookmarks: tuple[Bookmark, ...]


# --------------------------------------------------------------------------
# 日次記事の読み取り
# --------------------------------------------------------------------------

def _clean_title(raw: str) -> str:
    return re.sub(r"\s+", " ", raw.replace("*", "").replace("`", "").replace("_", "")).strip()


def extract_bookmarks(body: str) -> list[Bookmark]:
    """日次記事の本文からブックマーク（タイトルとURL）を出現順に取り出す"""
    bookmarks: list[Bookmark] = []
    # 旧形式は見出しの下の `**URL:**` 行にURLがあるため、後から補う
    pending_title: str | None = None

    for line in body.split("\n"):
        linked = HEADING_WITH_LINK_RE.match(line)
        if linked:
            if pending_title:
                bookmarks.append(Bookmark(pending_title))
                pending_title = None
            title = _clean_title(linked.group(1))
            if title:
                bookmarks.append(Bookmark(title, linked.group(2)))
            continue

        numbered = HEADING_NUMBERED_RE.match(line)
        if numbered:
            if pending_title:
                bookmarks.append(Bookmark(pending_title))
            pending_title = _clean_title(numbered.group(1)) or None
            continue

        if pending_title:
            url_line = URL_LINE_RE.match(line)
            if url_line:
                bookmarks.append(Bookmark(pending_title, url_line.group(1)))
                pending_title = None

    if pending_title:
        bookmarks.append(Bookmark(pending_title))

    return bookmarks


def read_daily_digest(day: date, posts_dir: Path = POSTS_DIR) -> DailyDigest | None:
    """その日の日次記事を読む。無ければ None（休みの日もあるので異常ではない）"""
    path = Path(posts_dir) / f"{day:%Y-%m-%d}-{DAILY_SLUG}.md"
    if not path.exists():
        return None

    text = path.read_text(encoding="utf-8")
    match = FRONT_MATTER_RE.match(text)
    body = text[match.end():] if match else text

    bookmarks = extract_bookmarks(body)
    if not bookmarks:
        logger.warning("No bookmarks found in %s", path)
        return None

    return DailyDigest(day=day, bookmarks=tuple(bookmarks))


def collect_week(end: date, posts_dir: Path = POSTS_DIR) -> list[DailyDigest]:
    """end を最終日とする7日分の日次記事を古い順に集める"""
    days = [end - timedelta(days=offset) for offset in reversed(range(WEEK_DAYS))]
    digests = [read_daily_digest(day, posts_dir) for day in days]
    return [digest for digest in digests if digest]


# --------------------------------------------------------------------------
# 週刊記事の生成
# --------------------------------------------------------------------------

def week_start(end: date) -> date:
    return end - timedelta(days=WEEK_DAYS - 1)


def post_path(end: date, posts_dir: Path = POSTS_DIR) -> Path:
    return Path(posts_dir) / f"{end:%Y-%m-%d}-{WEEKLY_SLUG}.md"


def post_datetime(end: date) -> datetime:
    return JST.localize(datetime.combine(end, POST_TIME_JST))


def _host_of(url: str | None) -> str | None:
    if not url:
        return None
    host = (urlparse(url).hostname or "").lower()
    return host.removeprefix("www.") or None


def top_hosts(digests: Sequence[DailyDigest], limit: int = TOP_HOSTS) -> list[tuple[str, int]]:
    """その週によく読んだサイト（2件以上のものだけ）"""
    counter: Counter[str] = Counter()
    for digest in digests:
        for bookmark in digest.bookmarks:
            host = _host_of(bookmark.url)
            if host:
                counter[host] += 1
    return [(host, count) for host, count in counter.most_common(limit) if count > 1]


def build_front_matter(front_matter: dict) -> str:
    body = yaml.dump(
        front_matter,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=10**6,
    )
    return f"---\n{body}---\n"


def render_post(digests: Sequence[DailyDigest], end: date) -> str:
    """週刊まとめのMarkdownを組み立てる"""
    start = week_start(end)
    total = sum(len(digest.bookmarks) for digest in digests)
    span = f"{start:%Y年%m月%d日}〜{end:%m月%d日}"

    front_matter = build_front_matter(
        {
            "title": f"週刊まとめ {span} ({total}件)",
            "date": post_datetime(end).strftime("%Y-%m-%d %H:%M:%S %z"),
            "permalink": f"/{end:%Y/%m/%d}/{WEEKLY_SLUG}/",
            "excerpt": f"{span}にブックマークした{total}件を、日別に並べ直しました。",
        }
    )

    sections: list[str] = []

    hosts = top_hosts(digests)
    if hosts:
        lines = ["**よく読んだサイト**", ""]
        lines.extend(f"- {host} ({count}件)" for host, count in hosts)
        sections.append("\n".join(lines))

    for digest in digests:
        block = [f"## {digest.day:%Y年%m月%d日} ({len(digest.bookmarks)}件)", ""]
        for bookmark in digest.bookmarks:
            block.append(
                f"- [{bookmark.title}]({bookmark.url})" if bookmark.url
                else f"- {bookmark.title}"
            )
        sections.append("\n".join(block))

    sections.append(
        "---\n\n"
        "*日次のまとめ記事から自動生成しています。"
        "各記事の要約はその日のまとめをご覧ください。*"
    )

    return front_matter + "\n" + "\n\n".join(sections) + "\n"


def write_post(
    digests: Sequence[DailyDigest],
    end: date,
    posts_dir: Path = POSTS_DIR,
) -> bool:
    """週刊まとめを書き出す。作成したら True"""
    if not digests:
        logger.info("No daily posts in the week, skipping")
        return False

    path = post_path(end, posts_dir)
    if path.exists():
        logger.warning("Weekly post already exists, keeping it: %s", path)
        return False

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_post(digests, end), encoding="utf-8")
    except OSError as e:
        logger.error("Error creating weekly post: %s", e)
        return False

    logger.info("Created weekly digest: %s from %d daily posts", path, len(digests))
    return True


# --------------------------------------------------------------------------
# エントリポイント
# --------------------------------------------------------------------------

def yesterday_in_jst(now: datetime | None = None) -> date:
    now_jst = now or datetime.now(JST)
    return (now_jst - timedelta(days=1)).date()


def run(end: date | None = None, dry_run: bool = False, posts_dir: Path = POSTS_DIR) -> int:
    """メイン処理。作成した記事数（0 or 1）を返す"""
    end = end or yesterday_in_jst()
    logger.info("Building weekly digest for %s - %s", week_start(end), end)

    if not dry_run and post_path(end, posts_dir).exists():
        logger.warning("Weekly post for %s already exists, nothing to do", end)
        return 0

    digests = collect_week(end, posts_dir)
    if not digests:
        # 日次の記事が1本も無い週。日次側の失敗が続いている可能性が高い
        raise AbortRun(
            "%s〜%s の日次記事が1本も見つからないため、週刊まとめを作成しません"
            % (week_start(end), end)
        )

    if dry_run:
        print(render_post(digests, end))
        return 0

    return 1 if write_post(digests, end, posts_dir) else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="日次のまとめ記事から週刊まとめを作る")
    parser.add_argument("--week-ending", help="週の最終日 (YYYY-MM-DD)。既定は日本時間の昨日")
    parser.add_argument("--dry-run", action="store_true", help="ファイルを書かずに標準出力へ表示する")
    args = parser.parse_args(argv)

    end = (
        datetime.strptime(args.week_ending, "%Y-%m-%d").date()
        if args.week_ending
        else None
    )
    try:
        run(end=end, dry_run=args.dry_run)
    except AbortRun as e:
        logger.error("%s", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
