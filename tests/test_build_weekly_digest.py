#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""週刊まとめ(scripts/build_weekly_digest.py)のテスト"""

import os
import sys
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

import yaml

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.build_weekly_digest import (
    AbortRun,
    Bookmark,
    DailyDigest,
    collect_week,
    extract_bookmarks,
    post_path,
    read_daily_digest,
    render_post,
    run,
    top_hosts,
    week_start,
    write_post,
)

# 現在の日次記事の形式
NEW_FORMAT = """---
title: はてなブックマーク 2026年07月20日 の記事まとめ (2件)
---

## [記事A](https://example.com/a)

要約A

## [記事B](https://blog.example.org/b)

要約B
"""

# 既存記事の形式（見出しに番号、URLは次の行）
OLD_FORMAT = """---
title: はてなブックマーク 2026年07月21日 の記事まとめ (1件)
---

## 1. 記事C

**URL:** [https://example.com/c](https://example.com/c)

### AI要約

要点：
*   なにか
"""


def front_matter_of(markdown):
    _, raw, _ = markdown.split('---\n', 2)
    return yaml.safe_load(raw)


def body_of(markdown):
    return markdown.split('---\n', 2)[2]


class TestExtractBookmarks(unittest.TestCase):

    def test_new_format(self):
        self.assertEqual(
            extract_bookmarks(body_of(NEW_FORMAT)),
            [
                Bookmark('記事A', 'https://example.com/a'),
                Bookmark('記事B', 'https://blog.example.org/b'),
            ])

    def test_old_format_takes_url_from_next_line(self):
        self.assertEqual(
            extract_bookmarks(body_of(OLD_FORMAT)),
            [Bookmark('記事C', 'https://example.com/c')])

    def test_section_headings_are_ignored(self):
        self.assertEqual(extract_bookmarks('## 要点\n\n### AI要約\n'), [])

    def test_numbered_heading_without_url_is_kept(self):
        self.assertEqual(extract_bookmarks('## 1. 記事D\n\n本文\n'),
                         [Bookmark('記事D', None)])


class TestCollectWeek(unittest.TestCase):

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.posts_dir = Path(self.tmp.name) / '_posts'
        self.posts_dir.mkdir()

    def _write(self, day, content):
        (self.posts_dir / ('%s-hatena-bookmarks.md' % day)).write_text(
            content, encoding='utf-8')

    def test_collects_only_existing_days_in_order(self):
        self._write('2026-07-20', NEW_FORMAT)
        self._write('2026-07-21', OLD_FORMAT)
        # 対象期間の外なので拾わない
        self._write('2026-07-19', NEW_FORMAT)

        digests = collect_week(date(2026, 7, 26), self.posts_dir)

        self.assertEqual([d.day for d in digests], [date(2026, 7, 20), date(2026, 7, 21)])

    def test_missing_day_is_skipped(self):
        self.assertEqual(collect_week(date(2026, 7, 26), self.posts_dir), [])

    def test_post_without_bookmarks_is_skipped(self):
        self._write('2026-07-20', '---\ntitle: t\n---\n\n本文だけ\n')
        self.assertIsNone(read_daily_digest(date(2026, 7, 20), self.posts_dir))


class TestRenderPost(unittest.TestCase):

    def setUp(self):
        self.digests = [
            DailyDigest(date(2026, 7, 20), (
                Bookmark('記事A', 'https://example.com/a'),
                Bookmark('記事B', 'https://example.com/b'),
            )),
            DailyDigest(date(2026, 7, 21), (
                Bookmark('記事C', 'https://other.example/c'),
            )),
        ]
        self.markdown = render_post(self.digests, date(2026, 7, 26))

    def test_front_matter_is_derived_from_the_week(self):
        front = front_matter_of(self.markdown)

        self.assertIn('(3件)', front['title'])
        self.assertEqual(front['permalink'], '/2026/07/26/weekly-digest/')
        # 実行時刻ではなく週の最終日から決める（表示日付とURLをそろえる）
        self.assertEqual(front['date'], '2026-07-26 09:00:00 +0900')

    def test_body_lists_bookmarks_by_day(self):
        body = body_of(self.markdown)

        self.assertIn('## 2026年07月20日 (2件)', body)
        self.assertIn('- [記事A](https://example.com/a)', body)
        self.assertIn('## 2026年07月21日 (1件)', body)

    def test_bookmark_without_url_is_plain_text(self):
        markdown = render_post(
            [DailyDigest(date(2026, 7, 20), (Bookmark('記事D'),))], date(2026, 7, 26))
        self.assertIn('- 記事D\n', body_of(markdown))

    def test_top_hosts_only_lists_repeats(self):
        digests = [
            DailyDigest(date(2026, 7, 20), (
                Bookmark('a', 'https://example.com/1'),
                Bookmark('b', 'https://example.com/2'),
                Bookmark('c', 'https://once.example/3'),
            )),
        ]
        self.assertEqual(top_hosts(digests), [('example.com', 2)])


class TestWritePost(unittest.TestCase):

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.posts_dir = Path(self.tmp.name) / '_posts'
        self.digests = [
            DailyDigest(date(2026, 7, 20), (Bookmark('記事A', 'https://example.com/a'),))
        ]
        self.end = date(2026, 7, 26)

    def test_creates_file(self):
        self.assertTrue(write_post(self.digests, self.end, self.posts_dir))
        self.assertTrue(post_path(self.end, self.posts_dir).exists())

    def test_existing_file_is_kept(self):
        path = post_path(self.end, self.posts_dir)
        path.parent.mkdir(parents=True)
        path.write_text('existing', encoding='utf-8')

        self.assertFalse(write_post(self.digests, self.end, self.posts_dir))
        self.assertEqual(path.read_text(encoding='utf-8'), 'existing')

    def test_no_digests(self):
        self.assertFalse(write_post([], self.end, self.posts_dir))


class TestRun(unittest.TestCase):

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.posts_dir = Path(self.tmp.name) / '_posts'
        self.posts_dir.mkdir()
        self.end = date(2026, 7, 26)

    def _write_daily(self, day):
        (self.posts_dir / ('%s-hatena-bookmarks.md' % day)).write_text(
            NEW_FORMAT, encoding='utf-8')

    def test_creates_weekly_post(self):
        self._write_daily('2026-07-20')

        self.assertEqual(run(self.end, posts_dir=self.posts_dir), 1)
        self.assertTrue(post_path(self.end, self.posts_dir).exists())

    def test_aborts_without_any_daily_post(self):
        """日次が1本も無いのは、日次側の失敗が続いているサイン"""
        with self.assertRaises(AbortRun):
            run(self.end, posts_dir=self.posts_dir)

    def test_existing_weekly_post_is_kept(self):
        path = post_path(self.end, self.posts_dir)
        path.write_text('existing', encoding='utf-8')
        self._write_daily('2026-07-20')

        self.assertEqual(run(self.end, posts_dir=self.posts_dir), 0)
        self.assertEqual(path.read_text(encoding='utf-8'), 'existing')

    def test_dry_run_does_not_write(self):
        self._write_daily('2026-07-20')

        self.assertEqual(run(self.end, dry_run=True, posts_dir=self.posts_dir), 0)
        self.assertFalse(post_path(self.end, self.posts_dir).exists())


class TestWeekStart(unittest.TestCase):

    def test_week_is_seven_days_inclusive(self):
        self.assertEqual(week_start(date(2026, 7, 26)), date(2026, 7, 20))


if __name__ == '__main__':
    unittest.main()
