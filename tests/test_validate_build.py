#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""公開前ゲート(scripts/validate_build.py)のテスト"""

import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.validate_build import check_feed, check_log, check_pages, main

FEED_HEADER = '<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom">'


def entry(title='はてなブックマーク 2026年07月25日 の記事まとめ (9件)',
          href='https://example.com/blog/2026/07/25/hatena-bookmarks/',
          published='2026-07-25T23:56:15+00:00'):
    return """
  <entry>
    <title type="html">%s</title>
    <link href="%s" rel="alternate" type="text/html"/>
    <published>%s</published>
    <updated>%s</updated>
  </entry>""" % (title, href, published, published)


def feed(*entries):
    return FEED_HEADER + ''.join(entries) + '\n</feed>\n'


class TestCheckLog(unittest.TestCase):

    def _errors(self, log_text):
        with tempfile.NamedTemporaryFile('w', suffix='.log', delete=False, encoding='utf-8') as f:
            f.write(log_text)
            path = f.name
        try:
            errors = []
            check_log(path, errors)
            return errors
        finally:
            os.unlink(path)

    def test_clean_log_passes(self):
        self.assertEqual(self._errors('[build] 361 page(s) built in 5.41s\n'), [])

    def test_yaml_exception_is_detected(self):
        errors = self._errors(
            'YAMLException: end of the stream or a document separator is expected '
            '(_posts/2025-12-18-hatena-bookmarks.md)\n')
        self.assertEqual(len(errors), 1)
        self.assertIn('YAML', errors[0])

    def test_schema_error_is_detected(self):
        errors = self._errors(
            '[ERROR] [InvalidContentEntryDataError] posts → 2025-12-18-hatena-bookmarks '
            'data does not match collection schema.\n')
        # [ERROR] とスキーマ不一致の両方に当たる
        self.assertEqual(len(errors), 2)
        self.assertTrue(any('スキーマ' in e for e in errors))

    def test_url_conflict_is_detected(self):
        errors = self._errors(
            'Error: permalink が重複しています: /2026/07/07/hatena-bookmarks/ '
            '(2026-07-07-hatena-bookmarks.md と 2026-07-07-bookmark-summary.md)\n')
        self.assertEqual(len(errors), 1)
        self.assertIn('同じURL', errors[0])

    def test_ansi_colored_log_is_detected(self):
        """Astro はファイルへリダイレクトしても色付けコードを出す"""
        errors = self._errors(
            '\x1b[31m[ERROR]\x1b[0m Could not render /2026/07/07/hatena-bookmarks/\n')
        self.assertEqual(len(errors), 1)
        self.assertIn('エラー', errors[0])

    def test_missing_log_is_reported(self):
        errors = []
        check_log('/nonexistent/build.log', errors)
        self.assertEqual(len(errors), 1)


class TestCheckFeed(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _errors(self, content, min_entries=1):
        path = os.path.join(self.tmpdir, 'feed.xml')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        errors = []
        check_feed(path, errors, min_entries)
        return errors

    def test_valid_feed_passes(self):
        content = feed(
            entry(),
            entry(title='はてなブックマーク 2026年07月24日 の記事まとめ (4件)',
                  href='https://example.com/blog/2026/07/24/hatena-bookmarks/',
                  published='2026-07-24T23:58:57+00:00'))
        self.assertEqual(self._errors(content), [])

    def test_empty_title_is_detected(self):
        """フロントマターが壊れた記事はタイトルが空になる(今回の実際の症状)"""
        content = feed(entry(title=''), entry())
        errors = self._errors(content)
        self.assertTrue(any('タイトルが空' in e for e in errors), errors)

    def test_duplicate_url_is_detected(self):
        """URL衝突は片方の記事が上書きされて消えることを意味する"""
        content = feed(entry(), entry(published='2026-07-24T23:58:57+00:00'))
        errors = self._errors(content)
        self.assertTrue(any('重複' in e for e in errors), errors)

    def test_future_published_is_detected(self):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        content = feed(entry(published=future))
        errors = self._errors(content)
        self.assertTrue(any('未来' in e for e in errors), errors)

    def test_same_second_entries_at_build_time_are_detected(self):
        """ビルド時刻を持つ壊れた記事は同一秒で束になって現れる"""
        stamp = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        content = feed(
            entry(href='https://example.com/blog/2026/07/26/a-post/', published=stamp),
            entry(href='https://example.com/blog/2026/07/26/b-post/', published=stamp))
        errors = self._errors(content)
        self.assertTrue(any('同一時刻' in e for e in errors), errors)

    def test_same_second_entries_in_the_past_are_allowed(self):
        """過去の記事がたまたま同時刻でも、ビルド時刻の混入ではないので通す"""
        stamp = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        content = feed(
            entry(href='https://example.com/blog/2026/07/26/a-post/', published=stamp),
            entry(href='https://example.com/blog/2026/07/26/b-post/', published=stamp))
        errors = self._errors(content)
        self.assertFalse(any('同一時刻' in e for e in errors), errors)

    def test_unexpected_url_shape_is_detected(self):
        content = feed(entry(href='https://example.com/blog/2026/07/26/2025-12-18-hatena-bookmarks'))
        errors = self._errors(content)
        self.assertTrue(any('形式' in e for e in errors), errors)

    def test_malformed_xml_is_detected(self):
        errors = self._errors(FEED_HEADER + entry() + '\n')  # 閉じタグなし
        self.assertTrue(any('XML' in e for e in errors), errors)

    def test_missing_feed_is_detected(self):
        errors = []
        check_feed(os.path.join(self.tmpdir, 'nope.xml'), errors)
        self.assertTrue(any('生成されていない' in e for e in errors), errors)

    def test_too_few_entries_is_detected(self):
        errors = self._errors(feed(entry()), min_entries=5)
        self.assertTrue(any('少なすぎる' in e for e in errors), errors)


class TestCheckPages(unittest.TestCase):
    """_posts の記事がすべてページとして出ているかの検査"""

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.dist = os.path.join(self.tmpdir, 'dist')
        self.posts = os.path.join(self.tmpdir, '_posts')
        os.makedirs(self.posts)

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _add_post(self, name):
        with open(os.path.join(self.posts, name), 'w', encoding='utf-8') as f:
            f.write('---\ntitle: t\n---\n')

    def _add_page(self, rel_dir):
        path = os.path.join(self.dist, *rel_dir.split('/'))
        os.makedirs(path, exist_ok=True)
        with open(os.path.join(path, 'index.html'), 'w', encoding='utf-8') as f:
            f.write('<html></html>')

    def _errors(self):
        errors = []
        check_pages(self.dist, self.posts, errors)
        return errors

    def test_ok_when_all_posts_are_generated(self):
        self._add_post('2026-07-25-hatena-bookmarks.md')
        self._add_post('2026-07-26-hatena-bookmarks.md')
        self._add_page('2026/07/25/hatena-bookmarks')
        self._add_page('2026/07/26/hatena-bookmarks')
        # 一覧ページは記事として数えない
        self._add_page('page2')

        self.assertEqual(self._errors(), [])

    def test_missing_page_is_detected(self):
        """feed.xml は最新20件しか見ないため、古い記事の消失はここで捕まえる"""
        self._add_post('2026-07-25-hatena-bookmarks.md')
        self._add_post('2026-07-26-hatena-bookmarks.md')
        self._add_page('2026/07/26/hatena-bookmarks')

        errors = self._errors()
        self.assertTrue(any('出力数が足りない' in e for e in errors), errors)

    def test_missing_dist_is_detected(self):
        self._add_post('2026-07-26-hatena-bookmarks.md')

        errors = self._errors()
        self.assertTrue(any('ビルド結果が見つからない' in e for e in errors), errors)

    def test_skipped_when_dist_is_not_given(self):
        errors = []
        check_pages(None, self.posts, errors)
        self.assertEqual(errors, [])


class TestMain(unittest.TestCase):

    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _feed_path(self, content):
        path = os.path.join(self.tmpdir, 'feed.xml')
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        return path

    def test_exit_zero_when_healthy(self):
        path = self._feed_path(feed(entry()))
        self.assertEqual(main(['--feed', path]), 0)

    def test_exit_nonzero_when_broken(self):
        path = self._feed_path(feed(entry(title='')))
        self.assertEqual(main(['--feed', path]), 1)


if __name__ == '__main__':
    unittest.main()
