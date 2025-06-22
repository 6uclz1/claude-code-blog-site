#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
テスト実行用スクリプト

使用方法:
    python test_runner.py                    # 全テスト実行
    python test_runner.py --coverage         # カバレッジ付きでテスト実行
    python test_runner.py --unittest         # unittestで実行
"""

import sys
import subprocess
import argparse


def run_pytest(with_coverage=False):
    """pytestでテストを実行"""
    cmd = ['python', '-m', 'pytest', '-v', 'tests/', '--ignore=_site', '--ignore=.jekyll-cache']
    
    if with_coverage:
        try:
            # pytest-covが利用可能かチェック
            subprocess.run(['python', '-c', 'import pytest_cov'], check=True, capture_output=True)
            cmd.extend(['--cov=scripts', '--cov-report=html', '--cov-report=term'])
        except subprocess.CalledProcessError:
            print("警告: pytest-covが見つかりません。カバレッジなしで実行します。")
            print("カバレッジを使用するには: pip install pytest-cov")
    
    try:
        result = subprocess.run(cmd, check=True)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"pytest実行でエラーが発生しました: {e}")
        return False


def run_unittest():
    """unittestでテストを実行"""
    cmd = ['python', '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_*.py', '-v']
    
    try:
        result = subprocess.run(cmd, check=True)
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"unittest実行でエラーが発生しました: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='テスト実行スクリプト')
    parser.add_argument('--coverage', action='store_true', help='カバレッジを計測')
    parser.add_argument('--unittest', action='store_true', help='unittestで実行')
    
    args = parser.parse_args()
    
    if args.unittest:
        print("unittestでテストを実行中...")
        success = run_unittest()
    else:
        print("pytestでテストを実行中...")
        success = run_pytest(with_coverage=args.coverage)
    
    if success:
        print("✅ すべてのテストが成功しました!")
        sys.exit(0)
    else:
        print("❌ テストが失敗しました")
        sys.exit(1)


if __name__ == '__main__':
    main()