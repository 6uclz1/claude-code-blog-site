---
layout: post
title: "はてなブックマーク記事まとめ - 2025年06月26日"
date: 2025-06-27 08:15:24 +0900
excerpt: "これらの記事は、AIツール（`gemini-cli`、`claude-code`）の進化と実用的なCLI活用が共通テーマで、機能強化（ウェブ検索連携など）やリッチUI実現技術（React Ink）が注目される一方で、データプライバシーや技術的負債といったAI利用に伴う運用上の課題も議論されています。

- [gemini-cli の google_web_search が最高](https://zenn.dev/mizchi/articles/gemini-cli-for-google-search)


- [GitHub - shinshin86/oh-my-logo: Display giant ASCII-art logos with colorful gradients in your terminal — like Claude Code or Gemini CLI.](https://github.com/shinshin86/oh-my-logo)


- [React Ink によるリッチ CLI (ClaudeCodeの裏側のアレ)](https://zenn.dev/mizchi/articles/react-ink-renderer-for-ai-age)


- [【CSS】まだ width: 100% つかってるやついる⁉︎ いねぇよな⁉︎ - Qiita](https://qiita.com/degudegu2510/items/7079d76beeaa40c206d3)


- [Gemini CLI利用時の認証方法別プライバシーポリシー](https://zenn.dev/nuits_jp/articles/2025-06-26-gemini-cli-privacy-policy)


- [25分で解説する「最小権限の原則」を実現するための AWS「ポリシー」大全](https://speakerdeck.com/opelab/25fen-dejie-shuo-suru-zui-xiao-quan-xian-noyuan-ze-woshi-xian-surutameno-aws-porisi-da-quan)


- [Claude Code Deep Dive (2025/06/30 12:00〜)](https://cartaholdings.connpass.com/event/360380/)


- [gemini-cli の google_web_search が最高](https://zenn.dev/mizchi/articles/gemini-cli-for-google-search)

"
---

昨日のはてなブックマークから気になった記事をAIで要約してお届けします。


## 1. gemini-cli の google_web_search が最高

**URL:** [https://zenn.dev/mizchi/articles/gemini-cli-for-google-search](https://zenn.dev/mizchi/articles/gemini-cli-for-google-search)

**要約:**
この記事は、Google GeminiのCLIツールである`gemini-cli`が、Google Web Search機能を内蔵している点を高く評価しています。この強力なビルトイン検索機能は、Web検索能力が乏しいとされる`claude-code`のような他のAIツールの弱点を補完する上で特に有用です。

ユーザーは`gemini-cli`をインストール後、プロンプトに直接検索クエリを入力するだけで、馴染み深いGoogleの検索結果をAIから手軽に得ることができます。著者はさらに、この`gemini-cli`の検索機能を`claude-code`と連携させ、`claude-code`が内蔵のWeb検索機能ではなく`gemini-cli`を外部ツールとして利用するよう設定する試みも行っています。これにより、AIアシスタントがより効率的に最新情報を参照できる環境が構築されます。

---

## 2. GitHub - shinshin86/oh-my-logo: Display giant ASCII-art logos with colorful gradients in your terminal — like Claude Code or Gemini CLI.

**URL:** [https://github.com/shinshin86/oh-my-logo](https://github.com/shinshin86/oh-my-logo)

**要約:**
`oh-my-logo`は、ターミナルに鮮やかなグラデーションカラーの巨大なASCIIアートロゴを生成するユニークなツールです。アウトラインと塗りつぶしの2つの表示モード、13種類の美しいプリセットパレット、多様なグラデーション方向に対応し、プロジェクトのブランディングやターミナルを魅力的に飾るのに役立ちます。`npx`コマンドで手軽に試用でき、フォントや独自の配色も柔軟にカスタマイズ可能です。

---

## 3. React Ink によるリッチ CLI (ClaudeCodeの裏側のアレ)

**URL:** [https://zenn.dev/mizchi/articles/react-ink-renderer-for-ai-age](https://zenn.dev/mizchi/articles/react-ink-renderer-for-ai-age)

**要約:**
この記事は、ClaudeCodeやGemini-CLIに見られるような高機能なCLI（コマンドラインインターフェース）が、Reactのカスタムレンダラーである「React Ink」によって実現されていると解説しています。ReactやReactNativeの知識を活かし、useStateやuseEffectといったHooksもそのまま利用して、ターミナル上でリッチなASCIIアートのUIを構築できるのが特徴です。実際に複雑なターミナルゲームも実装されており、その可能性を示しています。VitestやPrismaなど多数の有名ツールでも採用されており、GUI開発の複雑さやAIとの親和性から、CLIが再評価される「AI時代」における重要な技術として注目されています。

---

## 4. 【CSS】まだ width: 100% つかってるやついる⁉︎ いねぇよな⁉︎ - Qiita

**URL:** [https://qiita.com/degudegu2510/items/7079d76beeaa40c206d3](https://qiita.com/degudegu2510/items/7079d76beeaa40c206d3)

**要約:**
CSSに新しく加わったキーワード「stretch」は、従来の`width: 100%`では対応しきれなかった要素のサイズ指定をより直感的にします。この`stretch`を使うと、`margin`を含めて親要素の利用可能なスペースにぴったりフィットするよう要素を拡大でき、煩わしい`calc()`関数が不要になります。さらに、flexやgridレイアウトにおいても、個々のアイテムを柔軟にグリッドいっぱいに配置できる利点があります。現在はChrome 138以降での限定的な対応ですが、将来的にはCSSレイアウト設計における強力なツールとなることが期待されます。

---

## 5. Gemini CLI利用時の認証方法別プライバシーポリシー

**URL:** [https://zenn.dev/nuits_jp/articles/2025-06-26-gemini-cli-privacy-policy](https://zenn.dev/nuits_jp/articles/2025-06-26-gemini-cli-privacy-policy)

**要約:**
Gemini CLIを利用する際、認証方法によってデータプライバシーポリシーが大きく異なります。特に「API無料サービス」では、送信されたプロンプトや回答がGoogleのモデル改善に利用され、オプトアウトもできないため、機密情報や個人情報を送信しないよう注意が必要です。

対照的に、有料のAPIサービスやVertex AIを用いた認証ではデータが収集・利用されることはありません。個人向けGoogle認証にはオプトアウトの可能性が示唆されていますが、CLIでのサポートは未確認です。したがって、Gemini CLIの利用者は、自身のデータプライバシー要件を考慮し、適切な認証方法を選択することが重要です。

---

## 6. 25分で解説する「最小権限の原則」を実現するための AWS「ポリシー」大全

**URL:** [https://speakerdeck.com/opelab/25fen-dejie-shuo-suru-zui-xiao-quan-xian-noyuan-ze-woshi-xian-surutameno-aws-porisi-da-quan](https://speakerdeck.com/opelab/25fen-dejie-shuo-suru-zui-xiao-quan-xian-noyuan-ze-woshi-xian-surutameno-aws-porisi-da-quan)

**要約:**
この記事は、AWS環境におけるセキュリティの要である「最小権限の原則」について解説しています。これは、ユーザーやシステムに必要最小限のアクセス権限のみを付与し、セキュリティリスクを大幅に低減する考え方です。記事では、AWSのIdentity and Access Management（IAM）ポリシーをはじめとする多様な「ポリシー」を最大限に活用し、この原則を具体的にAWS環境で実践するための方法論が詳説されています。これにより、クラウド環境の安全性を高め、不正アクセスや誤操作による損害を防ぐための実践的な知識が提供されます。

---

## 7. Claude Code Deep Dive (2025/06/30 12:00〜)

**URL:** [https://cartaholdings.connpass.com/event/360380/](https://cartaholdings.connpass.com/event/360380/)

**要約:**
2025年6月30日にCARTA HOLDINGSが開催するオンラインイベント「Claude Code Deep Dive」は、最前線のエンジニアたちがAI Coding AgentであるClaude Codeの「今」に深く迫ります。t-wada氏やmizchi氏らが登壇し、AI生成コードに伴う技術的負債やレビュー負荷、持続可能な運用といった実践的な課題について議論を深めます。

イベントでは、AIによる「脳のリミッターが外れる」感覚や、AIのコード生成量に人間のレビュー能力が追いつかない現状への対応策、そして破壊的な価格設定の持続可能性といったテーマが扱われます。日常的にClaude CodeなどのAgentic Codingツールを使用し、その未来や運用上の課題に関心があるエンジニアにとって、貴重な洞察とライブデモが提供されるでしょう。

---

## 8. gemini-cli の google_web_search が最高

**URL:** [https://zenn.dev/mizchi/articles/gemini-cli-for-google-search](https://zenn.dev/mizchi/articles/gemini-cli-for-google-search)

**要約:**
この記事は、Googleの`gemini-cli`に内蔵されたウェブ検索機能が非常に優れていると評価しています。この機能は、`claude-code`など他のAIが持つ検索能力の弱点を効果的に補完し、ユーザーが慣れ親しんだGoogleの検索結果をコマンドラインから直接取得できるため、高い利便性を提供します。筆者は実際に`gemini-cli`を`claude-code`に連携させ、AIがウェブ検索を必要とする際にGeminiの機能を利用するように設定する応用例を提示しており、AIの活用範囲を広げる実用的なアプローチを示しています。

---


*このまとめは、はてなブックマークのRSSフィードから自動生成されました。*
*要約はAI（Gemini）によって生成されており、元記事の内容を正確に反映していない場合があります。*
