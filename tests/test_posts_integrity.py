#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_posts配下の記事が正しく読めることを検証するテスト

フロントマターのYAMLが壊れている記事はビルド時に読み込みに失敗し、
記事がサイトとRSSから消えるため、リポジトリ全体を常にチェックする。
"""

import glob
import os
import re
import unittest
from datetime import date, datetime, timezone

import yaml

POSTS_DIR = os.path.join(os.path.dirname(__file__), '..', '_posts')
FRONT_MATTER_RE = re.compile(r'\A---\s*\n(.*?)\n---\s*\n', re.S)


def _posts():
    return sorted(glob.glob(os.path.join(POSTS_DIR, '*.md')))


def _as_datetime(value):
    """フロントマターの date を datetime にする（読めなければ None）

    "2026-07-27 08:56:04 +0900" のようなオフセット表記は YAML のタイムスタンプ形式に
    合わず文字列のまま渡ってくるため、Astro (z.coerce.date) と同じように解釈する。
    """
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, date):
        return datetime(value.year, value.month, value.day, tzinfo=timezone.utc)
    if not isinstance(value, str):
        return None

    text = value.strip()
    for fmt in ('%Y-%m-%d %H:%M:%S %z', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d'):
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


class TestPostsIntegrity(unittest.TestCase):

    def test_posts_exist(self):
        self.assertGreater(len(_posts()), 0, "_posts に記事が見つからない")

    def test_front_matter_is_valid_yaml(self):
        """全記事のフロントマターがYAMLとしてパースできること"""
        failures = []
        for path in _posts():
            with open(path, encoding='utf-8') as f:
                text = f.read()

            match = FRONT_MATTER_RE.match(text)
            if not match:
                failures.append('%s: フロントマターがない' % os.path.basename(path))
                continue

            try:
                data = yaml.safe_load(match.group(1))
            except yaml.YAMLError as e:
                failures.append('%s: YAMLエラー: %s' %
                                (os.path.basename(path), str(e).splitlines()[0]))
                continue

            if not isinstance(data, dict):
                failures.append('%s: フロントマターがマッピングでない' % os.path.basename(path))
            elif not data.get('title'):
                failures.append('%s: title がない' % os.path.basename(path))
            elif not data.get('date'):
                failures.append('%s: date がない' % os.path.basename(path))

        self.assertEqual(failures, [], "フロントマターが壊れている記事:\n" + "\n".join(failures))

    def test_permalinks_are_unique_and_match_filename(self):
        """パーマリンクが一意で、ファイル名の日付と一致すること

        重複するとビルド時に上書きされ、その日の記事がサイトから消える。
        """
        seen = {}
        failures = []
        for path in _posts():
            base = os.path.basename(path)
            with open(path, encoding='utf-8') as f:
                match = FRONT_MATTER_RE.match(f.read())
            if not match:
                continue
            try:
                data = yaml.safe_load(match.group(1))
            except yaml.YAMLError:
                continue
            if not isinstance(data, dict):
                continue

            permalink = data.get('permalink')
            if not permalink:
                failures.append('%s: permalink がない' % base)
                continue

            expected_prefix = '/%s/' % base[:10].replace('-', '/')
            if not permalink.startswith(expected_prefix):
                failures.append('%s: permalink %s がファイル名の日付と不一致' % (base, permalink))

            if permalink in seen:
                failures.append('%s: permalink %s が %s と重複' % (base, permalink, seen[permalink]))
            else:
                seen[permalink] = base

        self.assertEqual(failures, [], "パーマリンクの問題:\n" + "\n".join(failures))

    def test_date_matches_permalink(self):
        """date のUTC日付がパーマリンクの日付と一致すること

        記事一覧・記事ページの日付表示は UTC 基準(src/lib/posts.ts)なので、
        ここがずれると「表示は7月27日なのにURLは7月26日」という記事ができる。
        公開前ゲート(validate_build.py)はフィードの新しい20件しか見ないため、
        全記事を対象にするこのテストで担保する。
        """
        failures = []
        for path in _posts():
            base = os.path.basename(path)
            with open(path, encoding='utf-8') as f:
                match = FRONT_MATTER_RE.match(f.read())
            if not match:
                continue
            try:
                data = yaml.safe_load(match.group(1))
            except yaml.YAMLError:
                continue
            if not isinstance(data, dict):
                continue

            permalink, raw_date = data.get('permalink'), data.get('date')
            if not permalink or not raw_date:
                continue

            parsed = _as_datetime(raw_date)
            if parsed is None:
                failures.append('%s: date が日付として読めない: %r' % (base, raw_date))
                continue
            displayed = parsed.astimezone(timezone.utc).date()

            expected = '/%s/' % displayed.strftime('%Y/%m/%d')
            if not permalink.startswith(expected):
                failures.append('%s: 表示日付 %s とパーマリンク %s がずれている'
                                % (base, displayed, permalink))

        self.assertEqual(failures, [], "日付の不一致:\n" + "\n".join(failures))


if __name__ == '__main__':
    unittest.main()
