#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ビルド結果を公開前に検証するスクリプト

ビルドが成功しても記事が壊れたまま公開されることがあるため
(タイトルなし・URL衝突・記事の消失)、ビルドログと生成された feed.xml を
機械的に検査して、問題があれば非ゼロで終了する。

使い方:
    python scripts/validate_build.py --log build.log --feed dist/feed.xml
"""

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

ATOM = '{http://www.w3.org/2005/Atom}'

# Astro はファイルへリダイレクトしても色付けのエスケープシーケンスを出すため、
# パターンマッチの前に取り除く
ANSI_RE = re.compile(r'\x1b\[[0-9;]*m')

# ビルドログに出たら公開を止めるパターン
LOG_PATTERNS = [
    (re.compile(r'\[ERROR\]'), 'ビルドがエラーを報告している'),
    (re.compile(r'InvalidContentEntryDataError|does not match collection schema'),
     'フロントマターがスキーマに合わない記事がある'),
    (re.compile(r'YAMLException|YAML Exception'), 'フロントマターのYAMLが壊れている記事がある'),
    (re.compile(r'permalink が重複|Duplicate route'),
     '複数の記事が同じURLに出力されている(片方が消える)'),
]

# 記事のURLは /YYYY/MM/DD/slug/ 形式
POST_URL_RE = re.compile(r'/\d{4}/\d{2}/\d{2}/[^/]+/$')

# dist の中の記事ページ: YYYY/MM/DD/slug/index.html
POST_PAGE_RE = re.compile(r'^\d{4}/\d{2}/\d{2}/[^/]+/index\.html$')

# フロントマターが壊れた記事はビルド時刻を持つため、同一秒のentryが束になって現れる。
# 過去の記事が偶然同じ時刻を持っていても異常ではないので、
# 「ビルド時刻に近い」ものだけを異常として扱う。
BUILD_TIME_WINDOW = timedelta(hours=6)


def check_log(path, errors):
    """Astroのビルドログを検査する"""
    if not path:
        return
    if not os.path.exists(path):
        errors.append('ビルドログが見つからない: %s' % path)
        return

    with open(path, encoding='utf-8', errors='replace') as f:
        log = ANSI_RE.sub('', f.read())

    for pattern, message in LOG_PATTERNS:
        hits = pattern.findall(log)
        if hits:
            errors.append('ビルドログ: %s (%d件)' % (message, len(hits)))


def _count_post_pages(dist_dir):
    """dist に出力された記事ページ (YYYY/MM/DD/slug/index.html) の数"""
    count = 0
    for current, _dirs, files in os.walk(dist_dir):
        for name in files:
            if name != 'index.html':
                continue
            rel = os.path.relpath(os.path.join(current, name), dist_dir)
            if POST_PAGE_RE.match(rel.replace(os.sep, '/')):
                count += 1
    return count


def check_pages(dist_dir, posts_dir, errors):
    """_posts の記事がすべてページとして出力されているかを検査する

    feed.xml は最新20件しか載らないため、それより古い記事が消えても
    feed の検査では気づけない。ここで件数を突き合わせる。
    """
    if not dist_dir:
        return
    if not os.path.isdir(dist_dir):
        errors.append('ビルド結果が見つからない: %s' % dist_dir)
        return
    if not os.path.isdir(posts_dir):
        errors.append('記事ディレクトリが見つからない: %s' % posts_dir)
        return

    sources = [
        name for name in os.listdir(posts_dir)
        if name.endswith('.md') and not name.startswith('.')
    ]
    generated = _count_post_pages(dist_dir)

    # 1記事につき1ページ。少なければ記事が読み込まれずに落ちている
    if generated < len(sources):
        errors.append(
            '記事の出力数が足りない: _posts %d件に対して %d ページ (%d件が公開されない)'
            % (len(sources), generated, len(sources) - generated))


def _text(entry, tag):
    node = entry.find(ATOM + tag)
    return (node.text or '').strip() if node is not None else ''


def check_feed(path, errors, min_entries=1):
    """生成された feed.xml を検査する"""
    if not os.path.exists(path):
        errors.append('feed.xml が生成されていない: %s' % path)
        return

    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as e:
        errors.append('feed.xml がXMLとして壊れている: %s' % e)
        return

    entries = root.findall(ATOM + 'entry')
    if len(entries) < min_entries:
        errors.append('feed.xml のentryが少なすぎる: %d件 (最低%d件)' % (len(entries), min_entries))
        return

    now = datetime.now(timezone.utc)
    links, published_at = [], []

    for i, entry in enumerate(entries, 1):
        title = _text(entry, 'title')
        link_node = entry.find(ATOM + 'link')
        href = link_node.get('href', '') if link_node is not None else ''
        label = href or 'entry #%d' % i

        # フロントマターが壊れた記事はタイトルが空になる
        if not title:
            errors.append('feed.xml: タイトルが空のentryがある: %s' % label)

        if not href:
            errors.append('feed.xml: linkがないentryがある: entry #%d' % i)
        else:
            links.append(href)
            path_part = href.split('://', 1)[-1]
            path_part = path_part[path_part.index('/'):] if '/' in path_part else ''
            if not POST_URL_RE.search(path_part):
                errors.append('feed.xml: URLの形式が想定と違う: %s' % href)

        published = _text(entry, 'published')
        if not published:
            errors.append('feed.xml: publishedがないentryがある: %s' % label)
            continue
        try:
            dt = datetime.fromisoformat(published.replace('Z', '+00:00'))
        except ValueError:
            errors.append('feed.xml: publishedが日付として読めない: %s (%s)' % (published, label))
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        # 未来日付は時計ずれ以外ありえない
        if dt > now + timedelta(hours=1):
            errors.append('feed.xml: publishedが未来になっている: %s (%s)' % (published, label))
        published_at.append(dt)

    duplicates = sorted({link for link in links if links.count(link) > 1})
    for link in duplicates:
        errors.append('feed.xml: URLが重複している(記事が上書きされている): %s' % link)

    # 壊れた記事はビルド時刻を持つため、同一秒のentryが束になって現れる
    if len(published_at) >= 2:
        newest = max(published_at)
        same_second = [dt for dt in published_at if dt == newest]
        if len(same_second) > 1 and abs(now - newest) <= BUILD_TIME_WINDOW:
            errors.append(
                'feed.xml: publishedが同一時刻のentryが%d件ある(ビルド時刻が入り込んでいる可能性)'
                % len(same_second))


def main(argv=None):
    parser = argparse.ArgumentParser(description='ビルド結果を公開前に検証する')
    parser.add_argument('--log', help='Astroのビルドログ')
    parser.add_argument('--feed', default='dist/feed.xml', help='生成された feed.xml')
    parser.add_argument('--min-entries', type=int, default=1, help='feed.xml の最低entry数')
    parser.add_argument('--dist', help='ビルド結果のディレクトリ（記事の出力数を検査する）')
    parser.add_argument('--posts', default='_posts', help='記事のソースディレクトリ')
    args = parser.parse_args(argv)

    errors = []
    check_log(args.log, errors)
    check_feed(args.feed, errors, args.min_entries)
    check_pages(args.dist, args.posts, errors)

    if errors:
        print('❌ 検証に失敗しました。サイトを公開しません:', file=sys.stderr)
        for error in errors:
            print('  - %s' % error, file=sys.stderr)
        return 1

    print('✅ 検証OK: ビルドログ・feed.xml に問題はありません')
    return 0


if __name__ == '__main__':
    sys.exit(main())
