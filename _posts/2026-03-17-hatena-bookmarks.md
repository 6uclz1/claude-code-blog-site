---
layout: post
title: "はてなブックマーク 2026年03月17日 の記事まとめ (1件)"
date: 2026-03-18 08:26:31 +0900
excerpt: "はてなブックマークで気になった記事をAIで要約してお届けします。2026年03月17日分の1件の記事をまとめました。

- GitHub Actions 互換のローカルタスクランナーを作った
"
---

はてなブックマークで気になった記事をAIで要約してお届けします。
2026年03月17日分の1件の記事をまとめました。

## 1. GitHub Actions 互換のローカルタスクランナーを作った

**URL:** [https://zenn.dev/mizchi/articles/introduce-actrun](https://zenn.dev/mizchi/articles/introduce-actrun)

### AI要約

要点：
*   GitHub Actionsのワークフローをローカルで高速に実行できるツール「actrun」を開発。
*   クラウド実行の立ち上がりの遅さやデバッグの困難さ、artifactsの取り扱いを改善するのが目的。
*   npx、curl、npm、Dockerなど多様な方法で手軽に利用でき、クロスコンパイルされたバイナリで動作。
*   `run`ステップの実行に特化し、`actions/checkout`などの一部アクションはローカル環境向けにエミュレートまたはスキップ可能。
*   `--dry-run`で実行計画の確認やJSON出力が可能で、デバッグや自動化に貢献。

詳細な要約：
この記事は、GitHub Actionsのワークフローをローカル環境で実行するためのツール「actrun」の紹介と、その開発目的、機能、使用方法を解説しています。著者は、GitHub Actionsが便利である一方で、クラウド上での実行による起動の遅さや、実行時間が長いCIのデバッグ、特にartifacts（ビルド成果物）の取り出しの煩雑さに課題を感じていました。既存のローカル実行ツール「act」がDocker前提でmacOSでの利用が難しいと感じたため、ホストのツールチェーンをそのまま利用して`run:`ステップを実行できる「actrun」を開発しました。

「actrun」はMoonBitで記述され、クロスコンパイルされているため、npx、curl、npm、Dockerといった様々な方法で簡単にインストール・実行できます。特に、インストール不要な`npx @mizchi/actrun`コマンドでの試用が可能です。実行計画を事前に確認できる`--dry-run`オプションや、その結果をJSON形式で取得する機能も備わっており、デバッグやスクリプト連携に役立ちます。

また、GitHub ActionsがクラウドのUbuntuランナーを前提としているため、ローカル実行時に発生する齟齬を解消するため、`actions/checkout`などのアクションをスキップする設定や、実行環境（worktree、tmp、local）を選択するオプションも提供しています。`actions/checkout`、`actions/upload-artifact`/`download-artifact`、`actions/cache`、`actions/setup-node`といった標準アクションは、actrun側で独自にエミュレーションすることで、ローカル環境でもスムーズなワークフロー実行を実現しています。

---

*この記事は、はてなブックマークのRSSフィードから自動生成されました。*  
*要約はAI（Gemini）によって生成されており、元記事の内容を正確に反映していない場合があります。*  
*詳細な内容については、各URLから元記事をご確認ください。*
