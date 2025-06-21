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
        self.model = genai.GenerativeModel('gemini-1.5-flash')
        
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
        yesterday_entries = []
        
        for entry in entries:
            try:
                # published_parsedを使用
                if hasattr(entry, 'published_parsed') and entry.published_parsed:
                    entry_date = datetime(*entry.published_parsed[:6], tzinfo=pytz.UTC)
                    entry_date_jst = entry_date.astimezone(self.jst).date()
                    
                    if entry_date_jst == yesterday:
                        yesterday_entries.append(entry)
                        logger.info(f"Found yesterday's entry: {entry.title}")
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
            prompt = f"""以下の記事を日本語で3-5文程度に要約してください。
技術的な内容の場合は、主要なポイントを明確に説明してください。
要約は読みやすく、興味深い内容にしてください。

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
    
    def create_markdown_post(self, entries_summaries, date):
        """Markdown形式のブログ投稿を作成"""
        date_str = date.strftime('%Y-%m-%d')
        filename = f"_posts/{date_str}-bookmark-summary.md"
        
        # ファイルが既に存在するかチェック
        if os.path.exists(filename):
            logger.info(f"Post for {date_str} already exists, skipping...")
            return False
        
        if not entries_summaries:
            logger.info("No entries to summarize, skipping post creation")
            return False
        
        content = f"""---
layout: post
title: "はてなブックマーク記事まとめ - {date.strftime('%Y年%m月%d日')}"
date: {date_str} 09:00:00 +0900
excerpt: "昨日のはてなブックマークから気になった記事をAIで要約しました"
---

昨日のはてなブックマークから気になった記事をAIで要約してお届けします。

"""
        
        for i, (entry, summary) in enumerate(entries_summaries, 1):
            content += f"""
## {i}. {entry['title']}

**URL:** [{entry['url']}]({entry['url']})

**要約:**
{summary}

---
"""
        
        content += f"""

*このまとめは、はてなブックマークのRSSフィードから自動生成されました。*
*要約はAI（Gemini）によって生成されており、元記事の内容を正確に反映していない場合があります。*
"""
        
        try:
            os.makedirs('_posts', exist_ok=True)
            with open(filename, 'w', encoding='utf-8') as f:
                f.write(content)
            
            logger.info(f"Created blog post: {filename}")
            return True
            
        except Exception as e:
            logger.error(f"Error creating markdown post: {e}")
            return False
    
    def run(self):
        """メイン処理を実行"""
        logger.info("Starting Hatena Bookmark summarization process")
        
        # RSSフィードを取得
        entries = self.fetch_rss()
        if not entries:
            logger.warning("No entries found in RSS feed")
            return
        
        # 昨日の記事をフィルタリング
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
        
        # Markdownファイルを作成
        yesterday_date = self.get_yesterday_date()
        if entries_summaries:
            success = self.create_markdown_post(entries_summaries, yesterday_date)
            if success:
                logger.info("Blog post created successfully")
            else:
                logger.error("Failed to create blog post")
        else:
            logger.info("No valid entries to create blog post")

if __name__ == "__main__":
    summarizer = HatenaBookmarkSummarizer()
    summarizer.run()