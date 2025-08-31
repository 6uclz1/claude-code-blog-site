#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import sys
import feedparser
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timedelta
import pytz
import google.generativeai as genai
import re
import time
from urllib.parse import urljoin, urlparse
import logging

# ログ設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class HatenaBookmarkSummarizer:
    def __init__(self):
        self.rss_url = "https://b.hatena.ne.jp/Buchi_6uclz1/rss"
        self.gemini_api_key = os.getenv('GEMINI_API_KEY')
        
        if not self.gemini_api_key:
            logger.error("GEMINI_API_KEY environment variable is not set")
            sys.exit(1)
        
        # Gemini API設定
        genai.configure(api_key=self.gemini_api_key)
        self.model = genai.GenerativeModel('gemini-2.5-flash')

        # 日本時間のタイムゾーン
        self.jst = pytz.timezone('Asia/Tokyo')
    
    def get_yesterday_date(self):
        """昨日の日付を日本時間で取得"""
        now_jst = datetime.now(self.jst)
        yesterday = now_jst - timedelta(days=1)
        return yesterday.date()
    
    def fetch_rss(self):
        """RSSフィードを取得"""
        try:
            logger.info(f"Fetching RSS from {self.rss_url}")
            feed = feedparser.parse(self.rss_url)
            
            if feed.bozo:
                logger.warning("Feed parsing had issues, but continuing...")
            
            return feed.entries
        except Exception as e:
            logger.error(f"Error fetching RSS: {e}")
            return []
    
    def filter_yesterday_entries(self, entries):
        """昨日の記事のみフィルタリング"""
        yesterday = self.get_yesterday_date()
        yesterday_str = yesterday.strftime('%Y%m%d')  # 20250619形式
        yesterday_entries = []
        
        for entry in entries:
            try:
                # 1. dc:dateフィールドを使用（優先）
                dc_date = getattr(entry, 'dc_date', None)
                entry_date_jst = None
                
                if dc_date:
                    # ISO形式の日付をパース（例: 2025-06-20T08:42:35Z）
                    entry_date = datetime.fromisoformat(dc_date.replace('Z', '+00:00'))
                    entry_date_jst = entry_date.astimezone(self.jst).date()
                
                # 2. 念のため、entryのIDやlinkからも日付を抽出を試行
                # はてなブックマークのURLパターン: /Buchi_6uclz1/20250620#bookmark-xxx
                date_from_url = None
                if hasattr(entry, 'id') and entry.id:
                    # entry.idから日付を抽出
                    import re
                    match = re.search(r'/(\d{8})#', entry.id)
                    if match:
                        date_from_url = match.group(1)
                
                # 3. dc_dateが利用できない場合はURLから抽出した日付を使用
                if not entry_date_jst and date_from_url:
                    try:
                        url_date = datetime.strptime(date_from_url, '%Y%m%d')
                        entry_date_jst = url_date.date()
                    except:
                        pass
                
                # 4. 最後の手段：published_parsedを使用
                if not entry_date_jst and hasattr(entry, 'published_parsed') and entry.published_parsed:
                    entry_date = datetime(*entry.published_parsed[:6], tzinfo=pytz.UTC)
                    entry_date_jst = entry_date.astimezone(self.jst).date()
                
                # 日付が取得できない場合はスキップ
                if not entry_date_jst:
                    logger.warning(f"No date found for entry: {entry.get('title', 'Unknown')}")
                    continue
                
                # 昨日の記事かチェック
                if entry_date_jst == yesterday:
                    yesterday_entries.append(entry)
                    logger.info(f"Found yesterday's entry: {entry.title} (date: {entry_date_jst})")
                
                # URLから抽出した日付もチェック（dc:dateと異なる場合がある）
                elif date_from_url == yesterday_str:
                    yesterday_entries.append(entry)
                    logger.info(f"Found yesterday's entry from URL: {entry.title} (URL date: {date_from_url})")
                    
            except Exception as e:
                logger.warning(f"Error parsing date for entry {entry.get('title', 'Unknown')}: {e}")
                continue
        
        logger.info(f"Found {len(yesterday_entries)} entries from yesterday")
        return yesterday_entries
    
    def extract_article_content(self, url):
        """記事のメイン内容を抽出"""
        try:
            headers = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
            
            response = requests.get(url, headers=headers, timeout=15)
            response.raise_for_status()
            response.encoding = response.apparent_encoding
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # 不要な要素を削除
            for element in soup(['script', 'style', 'nav', 'header', 'footer', 'aside', 'advertisement']):
                element.decompose()
            
            # メイン内容を抽出する候補セレクタ
            content_selectors = [
                'article',
                '[role="main"]',
                '.entry-content',
                '.post-content',
                '.article-body',
                '.content',
                'main',
                '.main-content'
            ]
            
            content = ""
            for selector in content_selectors:
                elements = soup.select(selector)
                if elements:
                    content = elements[0].get_text(strip=True)
                    break
            
            # セレクタで見つからない場合は、body全体から抽出
            if not content:
                body = soup.find('body')
                if body:
                    content = body.get_text(strip=True)
            
            # 内容をクリーンアップ
            content = re.sub(r'\s+', ' ', content)
            content = content[:3000]  # 最大3000文字に制限
            
            return content if content else "コンテンツを取得できませんでした"
            
        except Exception as e:
            logger.error(f"Error extracting content from {url}: {e}")
            return "コンテンツの取得に失敗しました"
    
    def summarize_with_gemini(self, title, url, content):
        """Gemini APIを使用して要約を生成"""
        try:
            prompt = f"""以下の記事を日本語で要約してください。
まず、初めに要点を箇条書きで示し、その後に詳細な要約を提供してください。
要点は、記事の重要なポイントを簡潔にまとめてください。
詳細な要約は、記事の内容を正確に反映し、読者が理解しやすいようにしてください。
特に、記事のテーマや目的、重要な情報を含めてください。
記事の内容が技術的なものであれば、専門用語を避け、一般の読者にも理解できるようにしてください。
要約は、記事の内容を正確に反映し、読者が興味を持てるようにしてください。
要約の長さは、300文字以上500文字以内にしてください。
記事の内容が長い場合は、重要なポイントを中心に要約してください。
要約は読みやすく、興味深い内容にしてください。
「はい」などの回答は行わず、記事に使用する文章のみを提供してください。

タイトル: {title}
URL: {url}

記事内容:
{content}

要約:"""

            response = self.model.generate_content(prompt)
            summary = response.text.strip()
            
            # 要約の長さをチェック
            if len(summary) < 50:
                return f"この記事は{title}について説明しています。詳細な内容については元記事をご確認ください。"
            
            return summary
            
        except Exception as e:
            logger.error(f"Error generating summary with Gemini: {e}")
            return f"この記事は「{title}」について書かれています。要約の生成に失敗しましたが、詳細は元記事をご確認ください。"
    

    def create_daily_markdown_post(self, entries_summaries, date):
        """一日分のブックマークをまとめて一つのMarkdown記事を作成"""
        if not entries_summaries:
            logger.info("No entries to summarize, skipping post creation")
            return 0
        
        # ファイル名生成：日付のみ
        date_str = date.strftime('%Y-%m-%d')
        filename = f"_posts/{date_str}-hatena-bookmarks.md"
        
        # ファイルが既に存在するかチェック
        if os.path.exists(filename):
            logger.info(f"Post already exists, skipping: {filename}")
            return 0
        
        # 記事の公開日時は現在時刻を使用（RSS通知のため）
        now_jst = datetime.now(self.jst)
        publish_date_str = now_jst.strftime('%Y-%m-%d %H:%M:%S %z')
        
        # 記事数に応じたタイトル
        article_count = len(entries_summaries)

        excerpt = f"はてなブックマークで気になった記事をAIで要約してお届けします。{date.strftime('%Y年%m月%d日')}分の{article_count}件の記事をまとめました。"
        
        for i, (entry, summary) in enumerate(entries_summaries, 1):
            logger.info(f"Entry {i}: {entry['title']} - {entry['url']}")
            excerpt += f"\n{i}. {entry['title']}"
        
        content = f"""---
layout: post
title: "はてなブックマーク {date.strftime('%Y年%m月%d日')} の記事まとめ ({article_count}件)"
date: {publish_date_str}
excerpt: "{excerpt}"
---

はてなブックマークで気になった記事をAIで要約してお届けします。
{date.strftime('%Y年%m月%d日')}分の{article_count}件の記事をまとめました。

"""
        
        # 各記事を追加
        for i, (entry, summary) in enumerate(entries_summaries, 1):
            content += f"""## {i}. {entry['title']}

**URL:** [{entry['url']}]({entry['url']})

### AI要約

{summary}

---

"""
        
        # フッター
        content += """*この記事は、はてなブックマークのRSSフィードから自動生成されました。*  
*要約はAI（Gemini）によって生成されており、元記事の内容を正確に反映していない場合があります。*  
*詳細な内容については、各URLから元記事をご確認ください。*
"""
        
        try:
            os.makedirs('_posts', exist_ok=True)
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(content)
            
            logger.info(f"Created daily blog post: {filename} with {article_count} articles")
            return 1
            
        except Exception as e:
            logger.error(f"Error creating daily post: {e}")
            return 0
    
    def run(self):
        """メイン処理を実行"""
        logger.info("Starting Hatena Bookmark summarization process")
        
        # RSSフィードを取得
        entries = self.fetch_rss()
        if not entries:
            logger.warning("No entries found in RSS feed")
            return

        # # 昨日の記事をフィルタリング
        yesterday_entries = self.filter_yesterday_entries(entries)
        if not yesterday_entries:
            logger.info("No entries from yesterday found")
            return
        
        # 各記事を処理
        entries_summaries = []
        for entry in yesterday_entries:
            try:
                title = entry.title
                url = entry.link
                
                logger.info(f"Processing: {title}")
                
                # 記事内容を取得
                content = self.extract_article_content(url)
                
                # コンテンツ取得に失敗した場合はスキップ
                if content == "コンテンツの取得に失敗しました":
                    logger.warning(f"Skipping entry due to content extraction failure: {title}")
                    continue
                
                # 要約を生成
                summary = self.summarize_with_gemini(title, url, content)
                
                
                entries_summaries.append((
                    {'title': title, 'url': url},
                    summary
                ))
                
                # API制限を考慮して少し待機
                time.sleep(2)
                
            except Exception as e:
                logger.error(f"Error processing entry {entry.get('title', 'Unknown')}: {e}")
                continue
        
        # 一日分のMarkdownファイルを作成
        yesterday_date = self.get_yesterday_date()
        if entries_summaries:
            created_count = self.create_daily_markdown_post(entries_summaries, yesterday_date)
            if created_count > 0:
                logger.info(f"Successfully created daily blog post with {len(entries_summaries)} articles")
            else:
                logger.info("No new blog post was created (may already exist)")
        else:
            logger.info("No valid entries to create blog posts")

if __name__ == "__main__":
    summarizer = HatenaBookmarkSummarizer()
    summarizer.run()