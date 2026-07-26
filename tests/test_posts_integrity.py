#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""_posts配下の記事がJekyllから正しく読めることを検証するテスト

フロントマターのYAMLが壊れている記事はJekyllが読み込みに失敗し、
タイトルなし・ビルド時刻付きの記事としてRSSに現れる（ビルドのたびに
「新着」として再配信される）ため、リポジトリ全体を常にチェックする。
"""

import glob
import os
import re
import unittest

import yaml

POSTS_DIR = os.path.join(os.path.dirname(__file__), '..', '_posts')
FRONT_MATTER_RE = re.compile(r'\A---\s*\n(.*?)\n---\s*\n', re.S)


def _posts():
    return sorted(glob.glob(os.path.join(POSTS_DIR, '*.md')))


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


if __name__ == '__main__':
    unittest.main()
