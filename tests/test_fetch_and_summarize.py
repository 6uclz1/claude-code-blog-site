#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import unittest
from unittest.mock import Mock, patch, mock_open, MagicMock
import os
import sys
from datetime import datetime, date, timedelta
import pytz
import tempfile
import shutil

# テスト対象のモジュールをインポート
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
from scripts.fetch_and_summarize import HatenaBookmarkSummarizer


class TestHatenaBookmarkSummarizer(unittest.TestCase):
    
    def setUp(self):
        """テストの前準備"""
        # 環境変数を設定
        os.environ['GEMINI_API_KEY'] = 'test_api_key'
        
        # Gemini APIをモック
        self.gemini_patcher = patch('scripts.fetch_and_summarize.genai')
        self.mock_genai = self.gemini_patcher.start()
        
        # モックモデルの設定
        self.mock_model = Mock()
        self.mock_genai.GenerativeModel.return_value = self.mock_model
        
        # テスト用のインスタンスを作成
        self.summarizer = HatenaBookmarkSummarizer()
        
        # 一時ディレクトリを作成
        self.temp_dir = tempfile.mkdtemp()
        self.original_cwd = os.getcwd()
        os.chdir(self.temp_dir)
    
    def tearDown(self):
        """テストの後片付け"""
        self.gemini_patcher.stop()
        os.chdir(self.original_cwd)
        shutil.rmtree(self.temp_dir)
        if 'GEMINI_API_KEY' in os.environ:
            del os.environ['GEMINI_API_KEY']
    
    def test_init_without_api_key(self):
        """API キーが設定されていない場合のテスト"""
        del os.environ['GEMINI_API_KEY']
        
        with self.assertRaises(SystemExit):
            HatenaBookmarkSummarizer()
    
    def test_get_yesterday_date(self):
        """昨日の日付取得のテスト"""
        with patch('scripts.fetch_and_summarize.datetime') as mock_datetime:
            # 2025-06-22 10:00:00 JST をモック
            mock_now = datetime(2025, 6, 22, 10, 0, 0, tzinfo=pytz.timezone('Asia/Tokyo'))
            mock_datetime.now.return_value = mock_now
            
            result = self.summarizer.get_yesterday_date()
            expected = date(2025, 6, 21)
            
            self.assertEqual(result, expected)
    
    @patch('scripts.fetch_and_summarize.feedparser')
    def test_fetch_rss_success(self, mock_feedparser):
        """RSS取得成功のテスト"""
        # モックのフィードデータ
        mock_feed = Mock()
        mock_feed.bozo = False
        mock_feed.entries = [
            {'title': 'Test Article 1', 'link': 'https://example.com/1'},
            {'title': 'Test Article 2', 'link': 'https://example.com/2'}
        ]
        mock_feedparser.parse.return_value = mock_feed
        
        result = self.summarizer.fetch_rss()
        
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]['title'], 'Test Article 1')
        mock_feedparser.parse.assert_called_once_with(self.summarizer.rss_url)
    
    @patch('scripts.fetch_and_summarize.feedparser')
    def test_fetch_rss_error(self, mock_feedparser):
        """RSS取得エラーのテスト"""
        mock_feedparser.parse.side_effect = Exception("Network error")
        
        result = self.summarizer.fetch_rss()
        
        self.assertEqual(result, [])
    
    def test_filter_yesterday_entries(self):
        """昨日の記事フィルタリングのテスト"""
        yesterday = date(2025, 6, 21)
        yesterday_str = '20250621'
        
        # テストデータ
        entries = [
            # 昨日の記事（dc_date使用）
            Mock(
                title='Yesterday Article 1',
                dc_date='2025-06-21T08:42:35Z',
                id=f'/Buchi_6uclz1/{yesterday_str}#bookmark-123'
            ),
            # 今日の記事
            Mock(
                title='Today Article',
                dc_date='2025-06-22T08:42:35Z',
                id='/Buchi_6uclz1/20250622#bookmark-456'
            ),
            # 昨日の記事（URLから日付抽出）
            Mock(
                title='Yesterday Article 2',
                dc_date=None,
                id=f'/Buchi_6uclz1/{yesterday_str}#bookmark-789'
            )
        ]
        
        with patch.object(self.summarizer, 'get_yesterday_date', return_value=yesterday):
            result = self.summarizer.filter_yesterday_entries(entries)
        
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0].title, 'Yesterday Article 1')
        self.assertEqual(result[1].title, 'Yesterday Article 2')
    
    @patch('scripts.fetch_and_summarize.requests')
    def test_extract_article_content_success(self, mock_requests):
        """記事内容抽出成功のテスト"""
        # モックのHTMLレスポンス
        mock_response = Mock()
        mock_response.content = b'''
        <html>
            <body>
                <article>
                    <h1>Test Article</h1>
                    <p>This is the main content of the article.</p>
                    <p>More content here.</p>
                </article>
            </body>
        </html>
        '''
        mock_response.apparent_encoding = 'utf-8'
        mock_requests.get.return_value = mock_response
        
        result = self.summarizer.extract_article_content('https://example.com/test')
        
        self.assertIn('Test Article', result)
        self.assertIn('main content', result)
        mock_requests.get.assert_called_once()
    
    @patch('scripts.fetch_and_summarize.requests')
    def test_extract_article_content_error(self, mock_requests):
        """記事内容抽出エラーのテスト"""
        mock_requests.get.side_effect = Exception("Request failed")
        
        result = self.summarizer.extract_article_content('https://example.com/test')
        
        self.assertEqual(result, "コンテンツの取得に失敗しました")
    
    def test_summarize_with_gemini_success(self):
        """Gemini要約生成成功のテスト"""
        # モックの応答（50文字以上にする）
        mock_response = Mock()
        mock_response.text = "これはテスト記事の要約です。主要なポイントを説明しています。詳細な技術的内容が含まれており、実装方法についても説明されています。"
        self.mock_model.generate_content.return_value = mock_response
        
        result = self.summarizer.summarize_with_gemini(
            "Test Title",
            "https://example.com/test",
            "Test content here"
        )
        
        self.assertEqual(result, "これはテスト記事の要約です。主要なポイントを説明しています。詳細な技術的内容が含まれており、実装方法についても説明されています。")
        self.mock_model.generate_content.assert_called_once()
    
    def test_summarize_with_gemini_short_response(self):
        """Gemini要約が短すぎる場合のテスト"""
        # 短い応答をモック
        mock_response = Mock()
        mock_response.text = "短い"
        self.mock_model.generate_content.return_value = mock_response
        
        result = self.summarizer.summarize_with_gemini(
            "Test Title",
            "https://example.com/test",
            "Test content"
        )
        
        self.assertIn("Test Title", result)
        self.assertIn("について説明しています", result)
    
    def test_summarize_with_gemini_error(self):
        """Gemini要約生成エラーのテスト"""
        self.mock_model.generate_content.side_effect = Exception("API Error")
        
        result = self.summarizer.summarize_with_gemini(
            "Test Title",
            "https://example.com/test", 
            "Test content"
        )
        
        self.assertIn("Test Title", result)
        self.assertIn("要約の生成に失敗しました", result)
    
    def test_generate_excerpt(self):
        """エクセルプト生成のテスト"""
        # モックの応答
        mock_response = Mock()
        mock_response.text = "技術記事とビジネス記事の要約をまとめました。"
        self.mock_model.generate_content.return_value = mock_response
        
        entries_summaries = [
            ({'title': 'Tech Article', 'url': 'https://example.com/tech'}, 'Tech summary'),
            ({'title': 'Business Article', 'url': 'https://example.com/biz'}, 'Business summary')
        ]
        
        result = self.summarizer.generate_excerpt(entries_summaries)
        
        expected = "技術記事とビジネス記事の要約をまとめました。\n\n- [Tech Article](https://example.com/tech)\n- [Business Article](https://example.com/biz)"
        self.assertEqual(result, expected)
    
    def test_generate_excerpt_error(self):
        """エクセルプト生成エラーのテスト"""
        self.mock_model.generate_content.side_effect = Exception("API Error")
        
        entries_summaries = [
            ({'title': 'Article', 'url': 'https://example.com'}, 'Summary')
        ]
        
        result = self.summarizer.generate_excerpt(entries_summaries)
        
        self.assertIn("1件の記事をAIで要約しました", result)
        self.assertIn("- [Article](https://example.com)", result)
    
    def test_create_markdown_post_success(self):
        """Markdownファイル作成成功のテスト"""
        # エクセルプト生成をモック
        with patch.object(self.summarizer, 'generate_excerpt', return_value='テスト要約'):
            entries_summaries = [
                ({'title': 'Test Article', 'url': 'https://example.com'}, 'Test summary')
            ]
            
            # _postsディレクトリを作成
            os.makedirs('_posts', exist_ok=True)
            
            # ファイルが存在しないことを確認
            expected_file = '_posts/2025-06-21-bookmark-summary.md'
            if os.path.exists(expected_file):
                os.remove(expected_file)
            
            result = self.summarizer.create_markdown_post(
                entries_summaries, 
                date(2025, 6, 21)
            )
            
            self.assertTrue(result)
            
            # ファイルが作成されたかチェック
            self.assertTrue(os.path.exists(expected_file))
            
            # ファイル内容をチェック
            with open(expected_file, 'r', encoding='utf-8') as f:
                content = f.read()
                self.assertIn('Test Article', content)
                self.assertIn('Test summary', content)
                self.assertIn('テスト要約', content)
    
    @patch('scripts.fetch_and_summarize.os.path.exists')
    def test_create_markdown_post_file_exists(self, mock_exists):
        """ファイルが既に存在する場合のテスト"""
        mock_exists.return_value = True
        
        result = self.summarizer.create_markdown_post([], date(2025, 6, 21))
        
        self.assertFalse(result)
    
    def test_create_markdown_post_no_entries(self):
        """エントリがない場合のテスト"""
        result = self.summarizer.create_markdown_post([], date(2025, 6, 21))
        
        self.assertFalse(result)
    
    @patch.object(HatenaBookmarkSummarizer, 'fetch_rss')
    @patch.object(HatenaBookmarkSummarizer, 'filter_yesterday_entries')
    @patch.object(HatenaBookmarkSummarizer, 'extract_article_content')
    @patch.object(HatenaBookmarkSummarizer, 'summarize_with_gemini')
    @patch.object(HatenaBookmarkSummarizer, 'create_markdown_post')
    def test_run_success(self, mock_create_post, mock_summarize, mock_extract, 
                        mock_filter, mock_fetch):
        """メイン処理の成功テスト"""
        # モックの設定
        mock_fetch.return_value = [Mock(title='Test', link='https://example.com')]
        mock_filter.return_value = [Mock(title='Test', link='https://example.com')]
        mock_extract.return_value = "Test content"
        mock_summarize.return_value = "Test summary"
        mock_create_post.return_value = True
        
        # 実行
        self.summarizer.run()
        
        # 各メソッドが呼ばれたことを確認
        mock_fetch.assert_called_once()
        mock_filter.assert_called_once()
        mock_extract.assert_called_once()
        mock_summarize.assert_called_once()
        mock_create_post.assert_called_once()
    
    @patch.object(HatenaBookmarkSummarizer, 'fetch_rss')
    def test_run_no_entries(self, mock_fetch):
        """エントリがない場合のメイン処理テスト"""
        mock_fetch.return_value = []
        
        # 実行（例外が発生しないことを確認）
        self.summarizer.run()
        
        mock_fetch.assert_called_once()
    
    @patch.object(HatenaBookmarkSummarizer, 'fetch_rss')
    @patch.object(HatenaBookmarkSummarizer, 'filter_yesterday_entries')
    def test_run_no_yesterday_entries(self, mock_filter, mock_fetch):
        """昨日のエントリがない場合のメイン処理テスト"""
        mock_fetch.return_value = [Mock()]
        mock_filter.return_value = []
        
        # 実行
        self.summarizer.run()
        
        mock_fetch.assert_called_once()
        mock_filter.assert_called_once()


if __name__ == '__main__':
    unittest.main()