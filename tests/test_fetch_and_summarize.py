#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
import re
import sys
import unittest
from datetime import date, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

import pytz
import yaml

# テスト対象のモジュールをインポート
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.fetch_and_summarize import (  # noqa: E402
    MAX_POINTS,
    POINT_MAX_CHARS,
    SUMMARY_FALLBACK,
    SUMMARY_MAX_CHARS,
    Bookmark,
    Digest,
    GeminiSummarizer,
    fetch_article_text,
    fetch_article_text_direct,
    fetch_article_text_via_jina,
    fetch_entries,
    parse_digest,
    post_path,
    prefers_jina,
    render_post,
    run,
    select_bookmarks,
    summarize_bookmarks,
    write_post,
    yesterday_in_jst,
)

JST = pytz.timezone('Asia/Tokyo')


def front_matter_of(markdown: str) -> dict:
    match = re.match(r'\A---\n(.*?)\n---\n', markdown, re.S)
    assert match is not None, "フロントマターが見つからない"
    return yaml.safe_load(match.group(1))


def body_of(markdown: str) -> str:
    return markdown.split('\n---\n', 1)[1]


class TestDates(unittest.TestCase):

    def test_yesterday_in_jst(self):
        now = JST.localize(datetime(2025, 6, 22, 10, 0, 0))
        self.assertEqual(yesterday_in_jst(now), date(2025, 6, 21))

    def test_yesterday_in_jst_uses_jst_not_utc(self):
        """UTCではまだ前日でも、JSTの日付基準で判定する"""
        now = JST.localize(datetime(2025, 6, 22, 8, 0, 0))
        self.assertEqual(yesterday_in_jst(now), date(2025, 6, 21))


class TestFetchEntries(unittest.TestCase):

    @patch('scripts.fetch_and_summarize.feedparser')
    def test_success(self, mock_feedparser):
        feed = Mock(bozo=False, entries=[{'title': 'A'}, {'title': 'B'}])
        mock_feedparser.parse.return_value = feed

        result = fetch_entries('https://example.com/rss')

        self.assertEqual(len(result), 2)
        mock_feedparser.parse.assert_called_once_with('https://example.com/rss')

    @patch('scripts.fetch_and_summarize.feedparser')
    def test_error_returns_empty(self, mock_feedparser):
        mock_feedparser.parse.side_effect = Exception("Network error")

        self.assertEqual(fetch_entries('https://example.com/rss'), [])


class TestSelectBookmarks(unittest.TestCase):

    def _entry(self, title, link='https://example.com/1', dc_date=None, entry_id=None,
               published_parsed=None):
        return Mock(title=title, link=link, dc_date=dc_date, id=entry_id,
                    published_parsed=published_parsed)

    def test_filters_by_dc_date_and_entry_id(self):
        target = date(2025, 6, 21)
        entries = [
            self._entry('Yesterday 1', 'https://example.com/1',
                        dc_date='2025-06-21T08:42:35Z', entry_id='/u/20250621#bookmark-1'),
            self._entry('Today', 'https://example.com/2',
                        dc_date='2025-06-22T08:42:35Z', entry_id='/u/20250622#bookmark-2'),
            self._entry('Yesterday 2', 'https://example.com/3',
                        dc_date=None, entry_id='/u/20250621#bookmark-3'),
        ]

        result = select_bookmarks(entries, target)

        self.assertEqual([b.title for b in result], ['Yesterday 1', 'Yesterday 2'])
        self.assertEqual(result[0].url, 'https://example.com/1')

    def test_falls_back_to_published_parsed(self):
        entry = self._entry('Published only', dc_date=None, entry_id=None,
                            published_parsed=(2025, 6, 20, 23, 30, 0, 0, 0, 0))  # UTC → JST で21日

        result = select_bookmarks([entry], date(2025, 6, 21))

        self.assertEqual([b.title for b in result], ['Published only'])

    def test_skips_entries_without_date_or_link(self):
        entries = [
            self._entry('No date', dc_date=None, entry_id=None, published_parsed=None),
            self._entry('No link', link='', dc_date='2025-06-21T08:42:35Z'),
        ]

        self.assertEqual(select_bookmarks(entries, date(2025, 6, 21)), [])

    def test_deduplicates_same_url(self):
        entries = [
            self._entry('A', 'https://example.com/same', dc_date='2025-06-21T01:00:00Z'),
            self._entry('A (再ブクマ)', 'https://example.com/same', dc_date='2025-06-21T02:00:00Z'),
        ]

        result = select_bookmarks(entries, date(2025, 6, 21))

        self.assertEqual(len(result), 1)


def html_response(body: bytes) -> Mock:
    return Mock(content=body, apparent_encoding='utf-8')


def long_article_html(marker: str = 'main content') -> bytes:
    filler = ('本文のテキストです。' * 40).encode()
    return (b'<html><body><article><h1>Test Article</h1><p>This is the '
            + marker.encode() + b'.</p><p>' + filler + b'</p></article></body></html>')


class TestFetchArticleTextDirect(unittest.TestCase):

    @patch('scripts.fetch_and_summarize.requests')
    def test_success(self, mock_requests):
        mock_requests.get.return_value = html_response(long_article_html())

        result = fetch_article_text_direct('https://example.com/test')

        self.assertIn('Test Article', result)
        self.assertIn('main content', result)
        mock_requests.get.assert_called_once()

    @patch('scripts.fetch_and_summarize.requests')
    def test_error_returns_none(self, mock_requests):
        mock_requests.get.side_effect = Exception("Request failed")

        self.assertIsNone(fetch_article_text_direct('https://example.com/test'))

    @patch('scripts.fetch_and_summarize.requests')
    def test_empty_body_returns_none(self, mock_requests):
        mock_requests.get.return_value = html_response(b'<html><body></body></html>')

        self.assertIsNone(fetch_article_text_direct('https://example.com/test'))


class TestFetchArticleTextViaJina(unittest.TestCase):

    @patch.dict(os.environ, {}, clear=True)
    @patch('scripts.fetch_and_summarize.requests')
    def test_prefixes_reader_url_and_returns_text(self, mock_requests):
        mock_requests.get.return_value = Mock(text='  ツイート本文\n\nです  ')

        result = fetch_article_text_via_jina('https://x.com/user/status/123')

        self.assertEqual(result, 'ツイート本文 です')
        called_url = mock_requests.get.call_args[0][0]
        self.assertEqual(called_url, 'https://r.jina.ai/https://x.com/user/status/123')
        self.assertNotIn('Authorization', mock_requests.get.call_args[1]['headers'])

    @patch.dict(os.environ, {'JINA_API_KEY': 'secret-token'}, clear=True)
    @patch('scripts.fetch_and_summarize.requests')
    def test_sends_api_key_when_available(self, mock_requests):
        mock_requests.get.return_value = Mock(text='本文')

        fetch_article_text_via_jina('https://x.com/user/status/123')

        headers = mock_requests.get.call_args[1]['headers']
        self.assertEqual(headers['Authorization'], 'Bearer secret-token')

    @patch('scripts.fetch_and_summarize.requests')
    def test_empty_returns_none(self, mock_requests):
        mock_requests.get.return_value = Mock(text='   ')

        self.assertIsNone(fetch_article_text_via_jina('https://x.com/user/status/123'))

    @patch('scripts.fetch_and_summarize.requests')
    def test_error_returns_none(self, mock_requests):
        mock_requests.get.side_effect = Exception("Request failed")

        self.assertIsNone(fetch_article_text_via_jina('https://x.com/user/status/123'))


class TestPrefersJina(unittest.TestCase):

    def test_twitter_and_x_use_jina_first(self):
        for url in (
            'https://x.com/user/status/1',
            'https://twitter.com/user/status/1',
            'https://mobile.twitter.com/user/status/1',
            'https://www.x.com/user/status/1',
        ):
            self.assertTrue(prefers_jina(url), url)

    def test_other_hosts_do_not(self):
        for url in ('https://example.com/x.com', 'https://notx.com/a', 'https://example.com/'):
            self.assertFalse(prefers_jina(url), url)


class TestFetchArticleText(unittest.TestCase):

    @patch('scripts.fetch_and_summarize.fetch_article_text_via_jina')
    @patch('scripts.fetch_and_summarize.fetch_article_text_direct')
    def test_normal_url_uses_direct_only(self, mock_direct, mock_jina):
        mock_direct.return_value = 'あ' * 500

        result = fetch_article_text('https://example.com/test')

        self.assertEqual(result, 'あ' * 500)
        mock_jina.assert_not_called()

    @patch('scripts.fetch_and_summarize.fetch_article_text_via_jina')
    @patch('scripts.fetch_and_summarize.fetch_article_text_direct')
    def test_falls_back_to_jina_when_direct_fails(self, mock_direct, mock_jina):
        mock_direct.return_value = None
        mock_jina.return_value = 'r.jina.ai の本文'

        self.assertEqual(fetch_article_text('https://example.com/test'), 'r.jina.ai の本文')
        mock_jina.assert_called_once_with('https://example.com/test')

    @patch('scripts.fetch_and_summarize.fetch_article_text_via_jina')
    @patch('scripts.fetch_and_summarize.fetch_article_text_direct')
    def test_falls_back_to_jina_when_direct_is_too_short(self, mock_direct, mock_jina):
        mock_direct.return_value = 'ログインしてください'
        mock_jina.return_value = 'r.jina.ai の本文'

        self.assertEqual(fetch_article_text('https://example.com/test'), 'r.jina.ai の本文')

    @patch('scripts.fetch_and_summarize.fetch_article_text_via_jina')
    @patch('scripts.fetch_and_summarize.fetch_article_text_direct')
    def test_keeps_short_direct_text_when_jina_fails(self, mock_direct, mock_jina):
        mock_direct.return_value = '短い本文'
        mock_jina.return_value = None

        self.assertEqual(fetch_article_text('https://example.com/test'), '短い本文')

    @patch('scripts.fetch_and_summarize.fetch_article_text_via_jina')
    @patch('scripts.fetch_and_summarize.fetch_article_text_direct')
    def test_twitter_uses_jina_first(self, mock_direct, mock_jina):
        mock_jina.return_value = 'ツイート本文'

        result = fetch_article_text('https://x.com/user/status/123')

        self.assertEqual(result, 'ツイート本文')
        mock_direct.assert_not_called()

    @patch('scripts.fetch_and_summarize.fetch_article_text_via_jina')
    @patch('scripts.fetch_and_summarize.fetch_article_text_direct')
    def test_twitter_falls_back_to_direct(self, mock_direct, mock_jina):
        mock_jina.return_value = None
        mock_direct.return_value = 'HTMLから取れた本文'

        result = fetch_article_text('https://x.com/user/status/123')

        self.assertEqual(result, 'HTMLから取れた本文')


class TestParseDigest(unittest.TestCase):

    def test_parses_json(self):
        digest = parse_digest('{"summary": "要点を1行で。", "points": ["補足A", "補足B"]}')

        self.assertEqual(digest.summary, '要点を1行で。')
        self.assertEqual(digest.points, ('補足A', '補足B'))

    def test_parses_fenced_json(self):
        digest = parse_digest('```json\n{"summary": "フェンス付き。", "points": []}\n```')

        self.assertEqual(digest.summary, 'フェンス付き。')
        self.assertEqual(digest.points, ())

    def test_truncates_long_summary_and_points(self):
        digest = parse_digest(json.dumps({
            'summary': 'あ' * (SUMMARY_MAX_CHARS + 200),
            'points': ['い' * (POINT_MAX_CHARS + 50)],
        }))

        self.assertLessEqual(len(digest.summary), SUMMARY_MAX_CHARS)
        self.assertLessEqual(len(digest.points[0]), POINT_MAX_CHARS)

    def test_truncation_prefers_sentence_boundary(self):
        text = 'あ' * (SUMMARY_MAX_CHARS - 20) + '。' + 'い' * 50
        digest = parse_digest('{"summary": "%s", "points": []}' % text)

        self.assertTrue(digest.summary.endswith('。'))
        self.assertLessEqual(len(digest.summary), SUMMARY_MAX_CHARS)

    def test_caps_number_of_points(self):
        points = ', '.join('"点%d"' % i for i in range(MAX_POINTS + 3))
        digest = parse_digest('{"summary": "まとめ。", "points": [%s]}' % points)

        self.assertEqual(len(digest.points), MAX_POINTS)

    def test_strips_bullet_markers_and_emphasis(self):
        digest = parse_digest('{"summary": "まとめ。", "points": ["- **強調**された点"]}')

        self.assertEqual(digest.points, ('強調された点',))

    def test_falls_back_to_first_line_when_not_json(self):
        digest = parse_digest('要点はこれです。\n\n続きの説明。')

        self.assertEqual(digest.summary, '要点はこれです。')
        self.assertEqual(digest.points, ())

    def test_empty_response_uses_fallback(self):
        self.assertEqual(parse_digest('').summary, SUMMARY_FALLBACK)


class TestGeminiSummarizer(unittest.TestCase):

    def setUp(self):
        patcher = patch('scripts.fetch_and_summarize.genai')
        self.mock_genai = patcher.start()
        self.addCleanup(patcher.stop)
        self.mock_model = Mock()
        self.mock_genai.GenerativeModel.return_value = self.mock_model
        self.summarizer = GeminiSummarizer('test_api_key')
        self.bookmark = Bookmark(title='Test Title', url='https://example.com/test')

    def test_summarize_success(self):
        self.mock_model.generate_content.return_value = Mock(
            text='{"summary": "短い要約。", "points": ["点1"]}')

        digest = self.summarizer.summarize(self.bookmark, '記事本文')

        self.assertEqual(digest, Digest(summary='短い要約。', points=('点1',)))
        prompt = self.mock_model.generate_content.call_args[0][0]
        self.assertIn('Test Title', prompt)
        self.assertIn('記事本文', prompt)

    def test_summarize_requests_json_output(self):
        self.mock_model.generate_content.return_value = Mock(text='{"summary": "x", "points": []}')

        self.summarizer.summarize(self.bookmark, '記事本文')

        config = self.mock_model.generate_content.call_args.kwargs['generation_config']
        self.assertEqual(config['response_mime_type'], 'application/json')

    def test_summarize_error_uses_fallback(self):
        self.mock_model.generate_content.side_effect = Exception("API Error")

        digest = self.summarizer.summarize(self.bookmark, '記事本文')

        self.assertEqual(digest.summary, SUMMARY_FALLBACK)
        self.assertEqual(digest.points, ())


class TestRenderPost(unittest.TestCase):

    def setUp(self):
        self.digests = [
            (Bookmark('Test Article 1', 'https://example.com/1'),
             Digest('1本目の要約。', ('点A', '点B'))),
            (Bookmark('Test Article 2', 'https://example.com/2'), Digest('2本目の要約。')),
        ]
        self.target = date(2025, 6, 21)
        self.published = JST.localize(datetime(2025, 6, 22, 8, 30, 0))

    def test_front_matter(self):
        fm = front_matter_of(render_post(self.digests, self.target, self.published))

        self.assertEqual(fm['title'], 'はてなブックマーク 2025年06月21日 の記事まとめ (2件)')
        self.assertEqual(fm['date'], '2025-06-22 08:30:00 +0900')
        # パーマリンクはブックマーク日から生成する。
        # date は実行時刻（翌朝）なので、date 任せだとURLが翌日にずれて衝突する。
        self.assertEqual(fm['permalink'], '/2025/06/21/hatena-bookmarks/')

    def test_excerpt_is_one_line(self):
        fm = front_matter_of(render_post(self.digests, self.target, self.published))

        self.assertNotIn('\n', fm['excerpt'].strip())
        self.assertIn('2件', fm['excerpt'])

    def test_body_links_title_and_lists_points(self):
        body = body_of(render_post(self.digests, self.target, self.published))

        self.assertIn('## [Test Article 1](https://example.com/1)', body)
        self.assertIn('## [Test Article 2](https://example.com/2)', body)
        self.assertIn('1本目の要約。', body)
        self.assertIn('- 点A', body)
        self.assertIn('- 点B', body)

    def test_body_stays_short(self):
        """朝にパラッと読める分量（1件あたり数行）に収まっていること"""
        body = body_of(render_post(self.digests, self.target, self.published))

        self.assertLess(len(body), 600)
        self.assertNotIn('### AI要約', body)
        self.assertNotIn('詳細な要約', body)

    def test_front_matter_is_valid_yaml_with_quotes_and_backslashes(self):
        """タイトルに " や \\ が含まれてもフロントマターが壊れないテスト

        フロントマターが壊れるとAstroが記事を読み込めず、
        RSSからその日の記事が消える（タイトルなしの記事が混入する）。
        """
        digests = [
            (Bookmark('Skillsは"業務マニュアル付きの道具箱"', 'https://example.com/1'),
             Digest('AIに "賭ける" 話。')),
            (Bookmark('パス C:\\Users\\test と : コロン', 'https://example.com/2'),
             Digest('バックスラッシュ \\ を含む要約。')),
        ]

        markdown = render_post(digests, self.target, self.published)
        fm = front_matter_of(markdown)

        self.assertIsInstance(fm, dict)
        self.assertIn('2025年06月21日', fm['title'])
        self.assertIn('Skillsは"業務マニュアル付きの道具箱"', body_of(markdown))

    def test_keeps_braces_as_is(self):
        """本文中の波括弧がそのまま残るテスト

        Jekyll時代は {{ }} が Liquid として解釈されるため raw で囲んでいたが、
        Astro は .md をテンプレートとして評価しないためエスケープ不要。
        """
        digests = [
            (Bookmark('GitHub Actionsの${{ }}記法', 'https://example.com'),
             Digest('`${{ secrets.TOKEN }}` を直接展開しない。', ('{% if %} も同様',)))
        ]

        body = body_of(render_post(digests, self.target, self.published))

        self.assertIn('${{ secrets.TOKEN }}', body)
        self.assertIn('{% if %}', body)
        self.assertNotIn('{% raw %}', body)


class TestWritePost(unittest.TestCase):

    def setUp(self):
        self.tmp = TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.posts_dir = Path(self.tmp.name) / '_posts'
        self.digests = [(Bookmark('Test Article', 'https://example.com'), Digest('要約。'))]
        self.target = date(2025, 6, 21)

    def test_creates_file(self):
        self.assertTrue(write_post(self.digests, self.target, self.posts_dir))

        path = post_path(self.target, self.posts_dir)
        self.assertTrue(path.exists())
        self.assertIn('Test Article', path.read_text(encoding='utf-8'))

    def test_no_entries(self):
        self.assertFalse(write_post([], self.target, self.posts_dir))

    def test_existing_file_is_kept(self):
        path = post_path(self.target, self.posts_dir)
        path.parent.mkdir(parents=True)
        path.write_text('existing content', encoding='utf-8')

        self.assertFalse(write_post(self.digests, self.target, self.posts_dir))
        self.assertEqual(path.read_text(encoding='utf-8'), 'existing content')


class TestSummarizeBookmarks(unittest.TestCase):

    @patch('scripts.fetch_and_summarize.fetch_article_text')
    def test_skips_entries_without_content(self, mock_fetch):
        mock_fetch.side_effect = ['本文あり', None]
        summarizer = Mock()
        summarizer.summarize.return_value = Digest('要約。')
        bookmarks = [Bookmark('A', 'https://example.com/1'), Bookmark('B', 'https://example.com/2')]

        result = summarize_bookmarks(bookmarks, summarizer, interval_sec=0)

        self.assertEqual([b.title for b, _ in result], ['A'])
        summarizer.summarize.assert_called_once()


class TestRun(unittest.TestCase):

    def setUp(self):
        os.environ['GEMINI_API_KEY'] = 'test_api_key'
        self.addCleanup(os.environ.pop, 'GEMINI_API_KEY', None)
        patcher = patch('scripts.fetch_and_summarize.GeminiSummarizer')
        self.mock_summarizer_cls = patcher.start()
        self.addCleanup(patcher.stop)

    def test_missing_api_key_exits(self):
        del os.environ['GEMINI_API_KEY']

        with self.assertRaises(SystemExit):
            run()

    @patch('scripts.fetch_and_summarize.write_post')
    @patch('scripts.fetch_and_summarize.summarize_bookmarks')
    @patch('scripts.fetch_and_summarize.select_bookmarks')
    @patch('scripts.fetch_and_summarize.fetch_entries')
    def test_success(self, mock_fetch, mock_select, mock_summarize, mock_write):
        mock_fetch.return_value = [Mock()]
        mock_select.return_value = [Bookmark('A', 'https://example.com/1')]
        mock_summarize.return_value = [(Bookmark('A', 'https://example.com/1'), Digest('要約。'))]
        mock_write.return_value = True

        self.assertEqual(run(date(2025, 6, 21)), 1)
        mock_write.assert_called_once()

    @patch('scripts.fetch_and_summarize.fetch_entries')
    def test_no_entries(self, mock_fetch):
        mock_fetch.return_value = []

        self.assertEqual(run(date(2025, 6, 21)), 0)

    @patch('scripts.fetch_and_summarize.select_bookmarks')
    @patch('scripts.fetch_and_summarize.fetch_entries')
    def test_no_entries_for_target_date(self, mock_fetch, mock_select):
        mock_fetch.return_value = [Mock()]
        mock_select.return_value = []

        self.assertEqual(run(date(2025, 6, 21)), 0)

    @patch('scripts.fetch_and_summarize.write_post')
    @patch('scripts.fetch_and_summarize.summarize_bookmarks')
    @patch('scripts.fetch_and_summarize.select_bookmarks')
    @patch('scripts.fetch_and_summarize.fetch_entries')
    def test_dry_run_does_not_write(self, mock_fetch, mock_select, mock_summarize, mock_write):
        mock_fetch.return_value = [Mock()]
        mock_select.return_value = [Bookmark('A', 'https://example.com/1')]
        mock_summarize.return_value = [(Bookmark('A', 'https://example.com/1'), Digest('要約。'))]

        self.assertEqual(run(date(2025, 6, 21), dry_run=True), 0)
        mock_write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
