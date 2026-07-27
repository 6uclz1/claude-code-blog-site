#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""はてなブックマークの前日分を Gemini で要約し、1本のまとめ記事を生成する。

この記事は「朝にパラッと目を通す」ためのものなので、分量を絞ることを最優先にしている。
1ブックマークあたり "1行サマリ + 箇条書き最大3点" に固定し、
モデルの出力が長すぎる場合はスクリプト側で切り詰める（プロンプトだけでは長さが安定しないため）。
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable, Sequence

import feedparser
import google.generativeai as genai
import pytz
import requests
import yaml
from bs4 import BeautifulSoup

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

RSS_URL = "https://b.hatena.ne.jp/Buchi_6uclz1/rss"
GEMINI_MODEL = "gemini-2.5-flash"
POSTS_DIR = Path("_posts")
JST = pytz.timezone("Asia/Tokyo")

# 記事本文の取得まわり
HTTP_TIMEOUT_SEC = 15
ARTICLE_TEXT_LIMIT = 3000
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
)
CONTENT_SELECTORS = (
    "article",
    '[role="main"]',
    ".entry-content",
    ".post-content",
    ".article-body",
    ".content",
    "main",
    ".main-content",
)

# 要約の分量。ここを変えると記事全体のボリュームが変わる
SUMMARY_MAX_CHARS = 120
POINT_MAX_CHARS = 45
MAX_POINTS = 3

# Gemini のレート制限対策（記事ごとの待機）
API_INTERVAL_SEC = 2

SUMMARY_FALLBACK = "要約を生成できませんでした。詳しくは元記事をご覧ください。"


@dataclass(frozen=True)
class Bookmark:
    """ブックマーク1件（RSSエントリから必要な情報だけ取り出したもの）"""

    title: str
    url: str


@dataclass(frozen=True)
class Digest:
    """1件分の短い要約。summary は1行、points は箇条書き（最大 MAX_POINTS 件）"""

    summary: str
    points: tuple[str, ...] = ()


# --------------------------------------------------------------------------
# 日付
# --------------------------------------------------------------------------

def yesterday_in_jst(now: datetime | None = None) -> date:
    """日本時間での「昨日」を返す"""
    now_jst = now or datetime.now(JST)
    return (now_jst - timedelta(days=1)).date()


def _entry_dates_jst(entry) -> set[date]:
    """エントリが持つ日付の候補をすべて集める

    はてなのRSSは dc:date / エントリID（/user/20250620#bookmark-xxx）/ published が
    それぞれ食い違うことがあるため、どれか1つでも対象日と一致すれば採用する。
    """
    candidates: set[date] = set()

    dc_date = getattr(entry, "dc_date", None)
    if dc_date:
        try:
            parsed = datetime.fromisoformat(str(dc_date).replace("Z", "+00:00"))
            candidates.add(parsed.astimezone(JST).date())
        except ValueError:
            logger.debug("Unparsable dc:date: %r", dc_date)

    entry_id = getattr(entry, "id", None)
    if entry_id:
        match = re.search(r"/(\d{8})#", str(entry_id))
        if match:
            try:
                candidates.add(datetime.strptime(match.group(1), "%Y%m%d").date())
            except ValueError:
                logger.debug("Unparsable date in entry id: %r", entry_id)

    published = getattr(entry, "published_parsed", None)
    if published:
        try:
            utc = datetime(*published[:6], tzinfo=pytz.UTC)
            candidates.add(utc.astimezone(JST).date())
        except (TypeError, ValueError):
            logger.debug("Unparsable published_parsed: %r", published)

    return candidates


def _entry_title(entry) -> str:
    return str(getattr(entry, "title", "") or "")


# --------------------------------------------------------------------------
# RSS
# --------------------------------------------------------------------------

def fetch_entries(rss_url: str = RSS_URL) -> list:
    """RSSフィードのエントリを取得する（失敗時は空リスト）"""
    try:
        logger.info("Fetching RSS from %s", rss_url)
        feed = feedparser.parse(rss_url)
        if getattr(feed, "bozo", False):
            logger.warning("Feed parsing had issues, but continuing...")
        return list(feed.entries)
    except Exception as e:  # noqa: BLE001 - RSS取得の失敗で全体を止めない
        logger.error("Error fetching RSS: %s", e)
        return []


def select_bookmarks(entries: Iterable, target: date) -> list[Bookmark]:
    """対象日のエントリを Bookmark に変換する（同一URLは先勝ちで重複排除）"""
    bookmarks: list[Bookmark] = []
    seen: set[str] = set()

    for entry in entries:
        title = _entry_title(entry)
        url = str(getattr(entry, "link", "") or "")
        if not url:
            logger.warning("Skipping entry without link: %s", title or "Unknown")
            continue

        dates = _entry_dates_jst(entry)
        if not dates:
            logger.warning("No date found for entry: %s", title or "Unknown")
            continue
        if target not in dates:
            continue
        if url in seen:
            logger.info("Skipping duplicated bookmark: %s", url)
            continue

        seen.add(url)
        bookmarks.append(Bookmark(title=title, url=url))
        logger.info("Found entry for %s: %s", target, title)

    logger.info("Selected %d entries for %s", len(bookmarks), target)
    return bookmarks


# --------------------------------------------------------------------------
# 記事本文
# --------------------------------------------------------------------------

def fetch_article_text(url: str) -> str | None:
    """記事のメイン本文を抽出する。取得できなければ None"""
    try:
        response = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=HTTP_TIMEOUT_SEC)
        response.raise_for_status()
        response.encoding = response.apparent_encoding

        soup = BeautifulSoup(response.content, "html.parser")
        for element in soup(["script", "style", "nav", "header", "footer", "aside"]):
            element.decompose()

        text = ""
        for selector in CONTENT_SELECTORS:
            elements = soup.select(selector)
            if elements:
                text = elements[0].get_text(" ", strip=True)
                break
        if not text:
            body = soup.find("body")
            text = body.get_text(" ", strip=True) if body else ""

        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            logger.warning("No content extracted from %s", url)
            return None
        return text[:ARTICLE_TEXT_LIMIT]

    except Exception as e:  # noqa: BLE001 - 1記事の失敗で全体を止めない
        logger.error("Error extracting content from %s: %s", url, e)
        return None


# --------------------------------------------------------------------------
# 要約
# --------------------------------------------------------------------------

PROMPT_TEMPLATE = """あなたは技術ブログの朝刊コーナーの編集者です。
読者が出勤前に数十秒で全体を把握できるよう、次の記事を短くまとめてください。

制約:
- summary: 記事の要点を1文で。{summary_max}文字以内。体言止めや「〜する内容」のような要約調で簡潔に。
- points: 補足したい具体的な情報を最大{max_points}個。各{point_max}文字以内の短い句。無ければ空配列。
- 前置き・感想・元記事へのリンク案内は書かない。
- 専門用語は必要な範囲で残しつつ、平易な日本語にする。

次のJSONのみを出力してください:
{{"summary": "...", "points": ["...", "..."]}}

タイトル: {title}
URL: {url}

記事内容:
{content}
"""


def _normalize(text: str) -> str:
    """箇条書き記号や余分な空白・強調記法を落として1行にする"""
    text = re.sub(r"\s+", " ", str(text)).strip()
    text = re.sub(r"^[-*・•\d]+[.)]?\s*", "", text)
    text = text.replace("**", "").strip()
    return text


def _shorten(text: str, limit: int) -> str:
    """limit 文字以内に収める。文の途中で切れないよう句点を優先する"""
    text = _normalize(text)
    if len(text) <= limit:
        return text

    head = text[:limit]
    sentence_end = max(head.rfind("。"), head.rfind("！"), head.rfind("？"))
    if sentence_end >= limit // 2:
        return head[: sentence_end + 1]
    # 末尾の「…」も1文字分なので、その分だけ短く切る
    return text[: limit - 1].rstrip() + "…"


def _extract_json(raw: str) -> dict | None:
    """モデル出力からJSONオブジェクトを取り出す（```json フェンス付きにも対応）"""
    text = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(.+?)```", text, re.S)
    if fenced:
        text = fenced.group(1).strip()
    else:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            text = text[start : end + 1]

    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, ValueError):
        return None
    return parsed if isinstance(parsed, dict) else None


def parse_digest(raw: str) -> Digest:
    """モデル出力を Digest に変換する。JSONで返らなかった場合は本文の先頭を使う"""
    payload = _extract_json(raw) or {}

    summary = _shorten(payload.get("summary", ""), SUMMARY_MAX_CHARS)
    if not summary:
        # JSONとして壊れていても、プレーンテキストの1行目が使えることが多い
        first_line = next((line for line in raw.splitlines() if _normalize(line)), "")
        summary = _shorten(first_line, SUMMARY_MAX_CHARS)

    raw_points = payload.get("points") or []
    if not isinstance(raw_points, list):
        raw_points = [raw_points]

    points: list[str] = []
    for point in raw_points:
        shortened = _shorten(point, POINT_MAX_CHARS)
        if shortened and shortened != summary:
            points.append(shortened)
        if len(points) >= MAX_POINTS:
            break

    return Digest(summary=summary or SUMMARY_FALLBACK, points=tuple(points))


class GeminiSummarizer:
    """Gemini で1件分の短い要約を作る"""

    def __init__(self, api_key: str, model_name: str = GEMINI_MODEL):
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model_name)

    def summarize(self, bookmark: Bookmark, article_text: str) -> Digest:
        prompt = PROMPT_TEMPLATE.format(
            summary_max=SUMMARY_MAX_CHARS,
            point_max=POINT_MAX_CHARS,
            max_points=MAX_POINTS,
            title=bookmark.title,
            url=bookmark.url,
            content=article_text,
        )
        try:
            response = self._model.generate_content(
                prompt,
                generation_config={"response_mime_type": "application/json", "temperature": 0.2},
            )
            return parse_digest(response.text)
        except Exception as e:  # noqa: BLE001 - 1記事の失敗で全体を止めない
            logger.error("Error generating summary for %s: %s", bookmark.url, e)
            return Digest(summary=SUMMARY_FALLBACK)


# --------------------------------------------------------------------------
# 記事生成
# --------------------------------------------------------------------------

def build_front_matter(front_matter: dict) -> str:
    """YAMLとして安全なフロントマターを生成する

    タイトルや要約に含まれる " や \\ を手動で埋め込むとYAMLが壊れ、
    Astroが記事を読み込めずRSSから記事が消えるため、必ずyaml.dumpを通す。
    """
    body = yaml.dump(
        front_matter,
        allow_unicode=True,
        default_flow_style=False,
        sort_keys=False,
        width=10**6,
    )
    return f"---\n{body}---\n"


def post_path(target_date: date, posts_dir: Path = POSTS_DIR) -> Path:
    return Path(posts_dir) / f"{target_date:%Y-%m-%d}-hatena-bookmarks.md"


def render_post(
    digests: Sequence[tuple[Bookmark, Digest]],
    target_date: date,
    published_at: datetime | None = None,
) -> str:
    """まとめ記事のMarkdownを組み立てる"""
    published_at = published_at or datetime.now(JST)
    count = len(digests)
    date_label = f"{target_date:%Y年%m月%d日}"

    front_matter = build_front_matter(
        {
            # パーマリンクはブックマーク日から生成する。
            # published_at は実行時刻（RSS通知のため翌朝）なので、ビルド環境のタイムゾーン次第で
            # /:year/:month/:day/ が翌日にずれ、翌日分の記事とURLが衝突してしまう。
            "title": f"はてなブックマーク {date_label} の記事まとめ ({count}件)",
            "date": published_at.strftime("%Y-%m-%d %H:%M:%S %z"),
            "permalink": f"/{target_date:%Y/%m/%d}/hatena-bookmarks/",
            "excerpt": f"{date_label}にブックマークした{count}件を、1行ずつまとめました。",
        }
    )

    # 本文の導入文は置かない。タイトルに日付と件数が入っており、
    # 一覧やフィードには excerpt が出るので、記事側で繰り返すと読む量が増えるだけ。
    sections: list[str] = []
    for bookmark, digest in digests:
        block = [f"## [{bookmark.title}]({bookmark.url})", "", digest.summary]
        if digest.points:
            block.append("")
            block.extend(f"- {point}" for point in digest.points)
        sections.append("\n".join(block))

    sections.append(
        "---\n\n"
        "*はてなブックマークのRSSから自動生成しています。"
        "要約はAI（Gemini）によるもので、正確さは元記事をご確認ください。*"
    )

    return front_matter + "\n" + "\n\n".join(sections) + "\n"


def write_post(
    digests: Sequence[tuple[Bookmark, Digest]],
    target_date: date,
    posts_dir: Path = POSTS_DIR,
) -> bool:
    """まとめ記事を書き出す。作成したら True、スキップ・失敗なら False"""
    if not digests:
        logger.info("No entries to summarize, skipping post creation")
        return False

    path = post_path(target_date, posts_dir)
    if path.exists():
        logger.info("Post already exists, skipping: %s", path)
        return False

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render_post(digests, target_date), encoding="utf-8")
    except OSError as e:
        logger.error("Error creating daily post: %s", e)
        return False

    logger.info("Created daily blog post: %s with %d articles", path, len(digests))
    return True


# --------------------------------------------------------------------------
# エントリポイント
# --------------------------------------------------------------------------

def summarize_bookmarks(
    bookmarks: Sequence[Bookmark],
    summarizer: GeminiSummarizer,
    interval_sec: float = API_INTERVAL_SEC,
) -> list[tuple[Bookmark, Digest]]:
    """各ブックマークの本文を取得して要約する（本文が取れないものはスキップ）"""
    digests: list[tuple[Bookmark, Digest]] = []

    for index, bookmark in enumerate(bookmarks):
        logger.info("Processing: %s", bookmark.title)
        article_text = fetch_article_text(bookmark.url)
        if not article_text:
            logger.warning("Skipping entry due to content extraction failure: %s", bookmark.title)
            continue

        digests.append((bookmark, summarizer.summarize(bookmark, article_text)))

        if interval_sec and index < len(bookmarks) - 1:
            time.sleep(interval_sec)

    return digests


def run(target_date: date | None = None, dry_run: bool = False) -> int:
    """メイン処理。作成した記事数（0 or 1）を返す"""
    logger.info("Starting Hatena Bookmark summarization process")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY environment variable is not set")
        sys.exit(1)

    target_date = target_date or yesterday_in_jst()

    entries = fetch_entries()
    if not entries:
        logger.warning("No entries found in RSS feed")
        return 0

    bookmarks = select_bookmarks(entries, target_date)
    if not bookmarks:
        logger.info("No entries from %s found", target_date)
        return 0

    digests = summarize_bookmarks(bookmarks, GeminiSummarizer(api_key))
    if not digests:
        logger.info("No valid entries to create blog posts")
        return 0

    if dry_run:
        print(render_post(digests, target_date))
        return 0

    return 1 if write_post(digests, target_date) else 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="はてなブックマークの前日分を要約して記事にする")
    parser.add_argument("--date", help="対象日 (YYYY-MM-DD)。既定は日本時間の昨日")
    parser.add_argument("--dry-run", action="store_true", help="ファイルを書かずに標準出力へ表示する")
    args = parser.parse_args(argv)

    target_date = datetime.strptime(args.date, "%Y-%m-%d").date() if args.date else None
    run(target_date=target_date, dry_run=args.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
