# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Astro-based Japanese blog site (Astro 7, static output). The site uses a
simple, modern design with pagination support and syntax highlighting. It was migrated
from Jekyll, so posts still live in `_posts/` and all published URLs are unchanged.

## Development Commands

### Local Development
```bash
# Install Node dependencies
npm ci

# Start the dev server (http://localhost:4000/claude-code-blog-site/)
npm run dev

# Build the site for production (output: dist/)
npm run build

# Preview the production build
npm run preview
```

### Testing and Validation
```bash
# Type check Astro/TypeScript files
npm run check

# Unit-test src/lib and the automation scripts (vitest)
npm test

# Build and validate before publishing (公開前ゲートと同じ検証)
npm run build 2>&1 | tee build.log
npm run validate -- --log build.log --feed dist/feed.xml --dist dist

# Render the coverage summary the way CI comments it on a pull request
npm run test:coverage
npm run coverage-report -- --min-lines 85

# Check the *published* site (更新が止まっていないか)
npm run health-check
```

**Publishing gate**: broken front matter fails the build via the content collection
schema in `src/content.config.ts`, and duplicate permalinks throw explicitly in
`src/pages/[...slug].astro`. On top of that, `scripts/validate-build.ts` scans the
build log and the generated `feed.xml` (empty titles, duplicate URLs, build-time
timestamps) and blocks the deploy. With `--dist dist` it also counts the generated
`YYYY/MM/DD/slug/index.html` pages against `_posts/*.md` — `feed.xml` only carries the
newest 20 entries, so anything older that stops being generated is invisible to the
feed checks. `checkPostContents()` also greps `_posts/*.md` for the
「要約を生成できませんでした」 fallback — 生成側でも載せないようにしているが、front matter も
URL も正常な記事なので他の検査では捕まらない。The daily automation runs this gate *before*
committing — nothing that fails validation is committed or published, and a failure
opens an issue automatically.

**Anomaly detection**: the publishing gate only sees a build that actually ran, so it
cannot notice the ways this repo breaks *quietly* — the cron stops firing, a run goes
green without producing a post, or Pages keeps serving a stale artifact. `health-check.yml`
covers that gap: it runs daily (2h after the daily post) and `scripts/check-site-health.ts`
fetches the **published** `feed.xml` to check that it parses, has no empty titles or
duplicate URLs, and that the newest entry is not older than `--max-age-hours` (36h — 24h
would false-alarm depending on when the run lands). A problem opens a `site-health` issue.

### Docker Development (Recommended)
```bash
# Start the Astro dev server with Docker
docker compose up astro

# Run in background
docker compose up -d astro

# Stop services
docker compose down

# Run the automation scripts with Docker
docker compose run --rm scripts npm run summarize
```

### Direct Development (Alternative)
```bash
# Install Node dependencies
npm ci

# Start the dev server
npm run dev

# Run Hatena bookmark summarization script manually
# (the automation scripts are TypeScript, run through tsx — no build step)
npm run summarize
```

### Testing
```bash
# Run all tests
npm test

# With coverage
npm run test:coverage

# Run a single file / a single test name
npx vitest run tests/fetch-and-summarize.test.ts
npx vitest run -t 'r.jina.ai'

# Run tests with Docker
docker compose run --rm scripts npm test
```

## Site Architecture

### Core Structure
- **astro.config.mjs**: `site` + `base` (GitHub Pages baseurl `/claude-code-blog-site`),
  `trailingSlash: 'always'`, Shiki syntax highlighting
- **package.json**: Node dependencies (astro, marked, and the automation stack —
  `@google/genai`, cheerio, fast-xml-parser, fast-xml-validator, js-yaml; pagefind,
  tsx and vitest for dev).
  `npm run summarize` / `npm run weekly-digest` / `npm run validate` run the scripts
  in `scripts/` through tsx (arguments go after `--`, e.g. `npm run summarize -- --dry-run`).
  `npm run build` runs `astro build` and then `pagefind --site dist` to write the
  search index into `dist/pagefind/` — `npm run dev` has no index, so `/search/` only
  works against a real build
- **Docker Environment**:
  - `Dockerfile`: Astro development environment
  - `Dockerfile.production`: Multi-stage build (Astro build → nginx)
  - `docker-compose.yml`: Development services (astro + scripts)
- **Astro sources**:
  - `src/content.config.ts`: content collection reading `_posts/**/*.md`
  - `src/site.ts`: site title / description / author / feed limit / OGP image
  - `src/lib/posts.ts`: astro:content を読む側（sorting, URL, excerpt rendering）
  - `src/lib/format.ts`: astro に依存しない整形（permalink→param, 日付, description）。
    `posts.ts` から再エクスポートしているので import 元は変わらない
  - `src/lib/bookmarks.ts`: 本文からブックマーク見出しを抽出（feed と `/sites/` が共用）
  - `src/lib/feed.ts` / `src/lib/xml.ts`: フィードの summary 生成と XML エスケープ
  - `src/lib/url.ts`: 表示用のURL整形（パーセントエンコードのデコード）。はてなのRSSは
    元記事のタイトルが無いブックマークのタイトルをURLのまま返し、そのURLの日本語は
    `%E7%99%BB%E5%A3%87...` のままなので、見出し・一覧・フィードに出す前にここで戻す。
    リンク先のURL自体は書き換えない
  - `src/lib/*.test.ts`: vitest（`npm test`）。astro を読まないモジュールだけが対象
  - `src/layouts/`: `BaseLayout.astro`, `PostLayout.astro`
  - `src/components/`: `Header`, `Footer`, `PostList`, `Pagination`,
    `PostIndexSection`（一覧の共通マークアップ）, `SiteNav`
  - `src/pages/`: `index.astro`, `page[num].astro`, `[...slug].astro`, `404.astro`,
    `archive.astro`, `sites.astro`, `search.astro`, `feed.xml.ts`, `sitemap.xml.ts`
  - `public/og.png`: 全ページ共通のOGP画像。`node scripts/generate_og_image.mjs` で再生成
  - `src/styles/global.css`: custom CSS (imported by `BaseLayout`)
  - `_posts/`: blog posts in Markdown with YAML front matter
- **Automation Pipeline** (TypeScript, executed with tsx — there is no build step):
  - `scripts/fetch-and-summarize.ts`: Hatena bookmark summarization with Gemini AI
  - `scripts/build-weekly-digest.ts`: 日次記事7本を束ねる週刊まとめ（AIは呼ばない）
  - `scripts/generate_og_image.mjs`: OGP画像の生成（手動実行、結果をコミットする）
  - `scripts/validate-build.ts`: pre-publish gate over the build log and feed.xml
  - `scripts/check-site-health.ts`: 公開中の feed.xml を外から検査する異常検知
  - `scripts/coverage-report.ts`: vitest のカバレッジを Markdown 化（PRコメント用）
  - `scripts/lib/`: 共通部品。`date.ts`（JST固定オフセットの暦日）, `frontmatter.ts`
    （front matter の生成／分割。Astro と同じ js-yaml を使う）, `http.ts`（タイムアウト・
    リトライ・読み込みサイズ上限・charset 判定）, `rss.ts`（RSS 1.0/2.0・Atom を同じ形に
    正規化）, `article.ts`（cheerio による本文抽出）, `boilerplate.ts`（ログイン誘導や
    ボット判定ページを本文と取り違えないための判定）, `sources/twitter.ts`（x.com の
    ポスト取得）, `summary.ts`（GitHub Actions のジョブサマリ）, `abort.ts`（`AbortRun`）,
    `markdown.ts`（壊れないMarkdownリンクの組み立て）, `xml-node.ts`, `fs.ts`, `logger.ts`。
    日次記事の見出しの読み取りは `src/lib/bookmarks.ts` を、表示用のタイトル整形は
    `src/lib/url.ts` を直接 import する（フィードや `/sites/` と同じ実装を使う）
  - `tests/`: vitest tests for the scripts (Gemini SDK と fetch はモックする)
- **CI/CD**: `.github/workflows/` for automated deployment and content updates, plus
  `.github/actions/` — the composite actions (`setup`, `report-failure`) the workflows share

### Key Features
- **Pagination**: 10 posts per page with Japanese navigation ("前へ"/"次へ"); page 1 is
  `/`, later pages are `/page2/`, `/page3/`, … (the Jekyll `paginate_path` is preserved)
- **Atom feed**: `src/pages/feed.xml.ts` emits `/feed.xml` in the same Atom format
  jekyll-feed produced, so existing subscribers and the publishing gate keep working.
  Each entry's `<summary>` is built by `src/lib/feed.ts` from the bookmark headings in the
  post body — a `・`-prefixed title list, nothing else. Slack's RSS integration shows only
  the head of the summary, so any preamble would push the list out of the preview; the list
  is capped by `FEED_SUMMARY_MAX_CHARS` / `FEED_SUMMARY_TITLE_MAX_CHARS` and the overflow
  collapses into `ほかN件`. Lines are separated by both `<br />` and a real newline so
  HTML readers and tag-stripping clients (Slack) both break lines. Posts without bookmark
  headings fall back to `excerpt`. Everything inside a `type="html"` element (titles and
  summaries alike) is escaped twice, so a title like `<Suspense>` is not swallowed as a tag
- **SEO**: OGP / Twitter Card meta in `BaseLayout` (with the shared `public/og.png`),
  `BlogPosting` JSON-LD on article pages, `sitemap.xml`, a `404.astro` page, and
  `noindex, follow` + `rel=prev/next` on the paginated pages (`/page2/` and later)
- **Post navigation**: article pages link to the next/previous post in the feed order
  (computed in `[...slug].astro` from the sorted list), plus the back link to the index
- **Search**: `/search/` is Pagefind. The index is built by `npm run build`'s second step
  and only covers `data-pagefind-body` (the `<article>` in `PostLayout.astro`), so
  listing pages never show up as results
- **Archive / sites**: `/archive/` lists every post grouped by year — the only way to
  reach old posts without clicking through 30+ pagination pages — and `/sites/` counts
  the bookmarked hosts from the post bodies via `src/lib/bookmarks.ts`
- **Responsive Design**: Mobile-first CSS with a breakpoint at 720px
- **Japanese Localization**: Date formatting and UI text in Japanese
- **Syntax Highlighting**: Shiki, at build time
- **Automated Content**: Daily Hatena bookmark summarization using Gemini AI, plus a
  weekly digest that reuses those summaries

### Content Management
- Blog posts use YAML front matter with `title`, `date`, `permalink`, and `excerpt`;
  `updated` is optional and only needed when an already published post is edited
  (it drives the feed's `<updated>` and the sitemap's `<lastmod>`)
- The `permalink` front matter is the article URL; it follows `/:year/:month/:day/:title/`
  and must match the date in the filename (enforced by `tests/posts-integrity.test.ts`)
- Dates are rendered in UTC so the displayed date matches the permalink date
- Posts are plain Markdown (not MDX), so `{{ }}` and `{% %}` need no escaping
- Japanese content with proper typography and line-height optimization

### Styling System
The design follows [6uclz1/minimal-blog](https://github.com/6uclz1/minimal-blog), fixed to
its dark theme. Everything lives in `src/styles/global.css` and is driven by CSS variables
on `:root` (`--bg` / `--fg` / `--muted` / `--line` / `--panel`, plus the `--content-inline`,
`--content-max`, `--copy-max` layout widths).

- **Typography**: Japanese-friendly system font stack, light weight (`--text-weight: 300`)
  with wide letter-spacing on titles
- **Color Palette**: background #09090b, foreground #f4f4f1, and translucent
  muted/line/panel tones derived from it — no accent hue
- **Texture**: a fixed, masked dot pattern (`body::before`) over a subtle radial gradient
- **Components**: no cards or shadows. The index is a date + title row list
  (`.post-index` / `.post-row`), the article page is `.post-page` / `.post-body`, and the
  header is a fixed brand at top-left with the footer at bottom-right. Archive and
  `/sites/` reuse the same row shape (`.archive-row` / `.host-row`), and the auxiliary
  links live in `.site-nav` under the list rather than in the header
- **Hover**: links share one effect — a gradient sweeping in from the left that inverts
  the text color (`--hover-shape` / `--hover-surface`); disabled under
  `prefers-reduced-motion`
- **Responsive**: single breakpoint at 720px; the post rows collapse to one column
- **Accessibility**: the palette is fixed to values that clear WCAG 2.1 AA — against
  `--bg` the contrast is fg 18.6:1 / `--muted` 11.5:1 / `--faint` 6.3:1, and `--line`
  clears the 3:1 non-text bar. Lowering any alpha means recomputing the ratio; the
  "muted" look is what made the old page hard to read. Body copy is 1rem at
  `--text-weight: 400` (light weights thin out on a dark background). `:focus-visible`
  draws one outline for the whole site — the hover sweep is a mouse affordance and no
  component may `outline: none` on top of it. Every page starts with a skip link to
  `#main-content`; post titles in the index are `<h2>` so the list is navigable by
  heading. `prefers-reduced-motion` kills every transition (the sweep runs 900ms),
  and `prefers-contrast: more` / `forced-colors` drop the dot texture.
  `/search/` labels Pagefind's input itself — the Default UI ships only a `title`

## Automation Architecture

### Content Generation Pipeline
`fetch-and-summarize.ts` is a set of small module-level functions (plus a `GeminiSummarizer`
class) wired together by `run()`, with `Bookmark` / `Digest` as the data passed between
stages. `run()` takes its collaborators through an optional `deps` object (and the fetchers
take injectable `direct` / `viaJina`) — ESM の export は差し替えられないため、テストは
モンキーパッチではなくこの注入点を使う:

1. **RSS Processing**: `fetchEntries()` + `selectBookmarks()` — the feed is fetched with a
   timeout and parsed by `scripts/lib/rss.ts` (fast-xml-parser), then every date an entry
   carries (`dc:date`, entry-id URL pattern, `pubDate`/`published`) is collected and the ones
   matching the target day are kept, de-duplicating by URL
2. **Content Extraction**: `fetchPlan(url)` decides *which* fetchers to try and in what
   order, and `fetchArticle()` runs that plan. Adding a host-specific way of fetching means
   adding an entry to `ArticleFetchers` and a line to `fetchPlan()` — nothing else changes.
   The fetchers are:
   - `fetchArticleDirect()` scrapes the HTML with cheerio using fallback selectors
     (`scripts/lib/article.ts`). `Response.text()` は常に UTF-8 として読むため、
     charset の判定は `scripts/lib/http.ts` の `decodeBody()` で行う。`isTextLike()` で
     PDF や画像は先に弾く（cheerio に渡してもゴミしか出ない）
   - `fetchArticleViaJina()` fetches `https://r.jina.ai/<url>` for rendered text
   - `fetchArticleFromTwitter()` (`scripts/lib/sources/twitter.ts`) — x.com/twitter.com は
     ログインしないと本文を返さないため、直接取得でも r.jina.ai 経由でも
     「JavaScriptを有効にしてください」しか取れない。認証不要で本文が取れる
     publish.twitter.com の oEmbed（公式）を先に、`/i/web/status/...` のように
     アカウントが分からず oEmbed が使えないときは cdn.syndication.twimg.com（埋め込み
     ウィジェットが使う非公式API）を先に試す。ポストは140字程度のこともあるので
     `MIN_ARTICLE_TEXT_CHARS` の足切りをかけない。プロフィールやトレンドのURL
     （`x.com/i/trending/...`）は要約する本文が存在しないので、取得そのものを行わない

   **取得できた「だけ」では採用しない**: ログイン誘導・JavaScript必須の案内・ボット判定・
   r.jina.ai のエラー通知はすべて 200 で返るうえ、そのまま要約すると記事と無関係な
   要約ができあがる（過去記事に実例がある）。`scripts/lib/boilerplate.ts` が本文の
   先頭だけを見てこれらを弾き、次の経路に進む。どの経路も `MIN_ARTICLE_TEXT_CHARS` に
   届かなければ、定型文ではない中でいちばん長い結果を使う。
   はてなのRSSはポストのタイトルをURLのまま返すため、取得経路がタイトルを持っていて
   はてな側のタイトルがURLのときだけ `withResolvedTitle()` が見出しを差し替える
3. **AI Summarization**: `GeminiSummarizer.summarize()` asks Gemini (via the `@google/genai`
   SDK) for JSON (`{"summary": ..., "points": [...]}`) using `responseMimeType:
   application/json`, and `parseDigest()` normalizes/truncates it — prompt wording alone
   doesn't keep the length stable. A per-article failure falls back to `SUMMARY_FALLBACK`,
   and そのブックマークは記事に載せない（「要約を生成できませんでした」だけの見出しは
   読む人にとって価値が無く、front matter は正常なので公開前ゲートでも気づけない）。
   本文が取れなかったもの・要約に失敗したものは理由付きで `SummarizeResult.skipped` に
   集まり、`run()` がログと **ジョブサマリ**（`scripts/lib/summary.ts`）の両方に出す —
   ワークフローが成功したまま記事から数件だけ消えるのがいちばん気づきにくい壊れ方なので、
   必ず表に出す。1件も残らなければ `AbortRun` を投げて記事を作らない。When the
   day's post already exists it returns early (before any API call) and says so at WARNING
4. **Markdown Generation**: `renderPost()` builds the post — one `## [title](url)` heading, a
   one-line summary, and up to 3 short bullets per bookmark — and `writePost()` saves it to
   `_posts/` (front matter always via `buildFrontMatter()` / js-yaml). `title` / `date` /
   `permalink` are all derived from the bookmark date (`postDateStamp()` pins the time to
   09:00 JST = 00:00 UTC),
   never from the run time — otherwise a manual run outside the cron window shifts the
   displayed date, which is rendered in UTC, one day away from the permalink.
   見出しのリンクは `scripts/lib/markdown.ts` の `markdownLink()` で組み立てる:
   タイトルの `[` `]` をエスケープし、閉じない括弧や空白を含むURL（例:
   `...&ct=t(EMAIL_CAMPAIGN`）は `<...>` で囲む。裸のまま書くと CommonMark が
   リンクとして読めず、記事にURLの文字列がそのまま出る。URL自体は
   パーセントエンコードし直さない（別のURLになりうるため）。
   タイトルがURLのままのブックマークは `displayTitle()` でデコードしてから見出しにする。
   `tests/posts-integrity.test.ts` が `_posts/` 全体のリンク宛先を検査して再発を止める
5. **Weekly digest**: `build-weekly-digest.ts` (run by `weekly-digest.yml` every Monday
   09:30 JST) reads the last 7 daily posts from `_posts/`, pulls the bookmark headings out
   of them — both the current `## [title](url)` form and the legacy `## 1. title` +
   `**URL:**` form that every existing post uses — and writes one look-back post. It never
   calls Gemini: the summaries already exist in the daily posts
6. **Deployment**: `update-blog.yml` commits and pushes the post, then calls `deploy.yml`
   as a reusable workflow (`workflow_call`) with the pushed commit as `ref`. `deploy.yml`
   builds with Astro, runs the publishing gate, and deploys to GitHub Pages, and it is the
   only place that deploys — deploying from two workflows races on the `github-pages`
   environment. The call is not optional: a push made with `GITHUB_TOKEN` never triggers
   another workflow (GitHub's recursion guard), so `deploy.yml`'s `push` trigger does not
   fire for automated posts and the article would sit on `main` unpublished.
   `weekly-digest.yml` does the same. A deploy that fails after the commit landed opens an
   issue from the `report-deploy-failure` job

**Post length is a product decision**: the daily digest is meant to be skimmed in the morning, so
the summary length limits live in the script (`SUMMARY_MAX_CHARS`, `POINT_MAX_CHARS`, `MAX_POINTS`)
rather than only in the prompt. Adjust those constants to change how long the posts get.

`npm run summarize -- --dry-run [--date YYYY-MM-DD]` prints the post instead of
writing it — useful for checking the output length after a prompt change.

### Docker-based Development
- **Containerized Environment**: The Astro dev server and the automation scripts run in separate containers
- **Development Workflow**: `docker compose up astro` provides a hot-reloading dev server at localhost:4000
- **CI/CD Integration**: GitHub Actions builds the site with `actions/setup-node`; the same
  Node setup runs the automation scripts, so no Python toolchain is installed in CI.
  `test.yml` runs on pull requests only — a push to `main` already gets the same build and
  publishing gate from `deploy.yml`, so keeping both would build every merge twice
- **Shared composite actions**: every workflow starts with the same checkout + Node setup and
  three of them report failures the same way, so those live in `.github/actions/setup` and
  `.github/actions/report-failure`. Bumping Node or changing how failures are reported is a
  one-file edit. `report-failure` comments on the existing open issue with the same label
  instead of opening a new one — a daily failure would otherwise pile up issues
- **Action versions**: `dependabot.yml` watches `github-actions` and `npm` weekly and groups
  the `actions/*` bumps into one PR. `test.yml` also runs **actionlint** so a broken
  workflow expression fails the PR instead of the next scheduled run
- **Workflow failure reporting**: `report-deploy-failure` gates on
  `needs.deploy.result == 'failure'`, not on a bare `failure()`. A bare `failure()` also
  fires when the *build* job failed and `deploy` was skipped, which posted an issue claiming
  the article had been committed when nothing was
- **Node version**: Node 24 (Active LTS — 22 has dropped to Maintenance). It is set in two
  places that must stay in sync: the `node-version` default in `.github/actions/setup`
  (all of CI) and `node:24-slim` in `Dockerfile` / `Dockerfile.production`
- **Node base image**: the Dockerfiles use `node:24-slim` rather than Alpine because the
  Pagefind binary that `npm ci` fetches is built against glibc
- **Testing Isolation**: Tests run in containerized environment with mocked external dependencies

### Testing Strategy
- **One test runner**: `npm test` (vitest) covers both `src/lib/*.test.ts` and `tests/*.test.ts`
  (the automation scripts). `npm run test:coverage` adds the coverage report
- **Coverage on pull requests**: `test.yml` runs `test:coverage`, turns the
  `coverage-summary.json` into Markdown with `scripts/coverage-report.ts`, and posts it as a
  single sticky comment (found by the `<!-- coverage-report -->` marker and updated in place,
  so re-pushing does not bury the PR). The same Markdown goes to the job summary, which is the
  only place a fork PR can show it — a fork's `GITHUB_TOKEN` is read-only and commenting fails.
  `MIN_LINE_COVERAGE` in `test.yml` (85%, against ~91% today) fails the PR when coverage drops;
  the comment is posted first so the number is visible either way.
  `src/lib/posts.ts` is excluded from the coverage config — it imports `astro:content` and can
  never be tested, so counting it as 0% would make the total useless as a threshold
- **Frontend Tests**: only modules that do not import `astro:content` can be tested this way,
  which is why the pure helpers live in `format.ts` / `bookmarks.ts` / `feed.ts` / `xml.ts`
  rather than in `posts.ts`
- **Dependency injection instead of monkeypatching**: ESM exports cannot be replaced at
  runtime, so anything a test needs to control is a parameter — `run({ deps })`,
  `fetchArticle(url, fetchers)`, `fetchTweet(ref, fetchers)`,
  `new GeminiSummarizer(key, { client })`.
  Network-level tests stub `fetch` with `vi.stubGlobal`
- **Gemini API Mocking**: All external API calls are mocked to avoid API key dependencies.
  `generationConfig()` returns the SDK's own `GenerateContentConfig` type, so a setting the
  installed SDK no longer accepts fails `npm run check` instead of silently turning every
  summary into the fallback string at runtime
- **Error Scenarios**: Tests cover RSS failures, content extraction errors, and API timeout scenarios
- **File Operations**: Tests verify Markdown file creation and content formatting

### Environment Variables Required
- `GEMINI_API_KEY`: Required for AI summarization in GitHub Actions (not needed for tests)
- `JINA_API_KEY`: Optional. Sent as a bearer token to r.jina.ai to relax its rate limit;
  the reader works anonymously without it

## Development Notes

- **IMPORTANT**: Any changes you make must be made through a pull request so we can review them here.
- All content and UI text is in Japanese
- Date formatting uses Japanese format (年月日)
- The site is configured for GitHub Pages deployment with base "/claude-code-blog-site"
- Use `withBase()` from `src/lib/posts.ts` for internal links so the base path is applied
- Posts should include proper excerpts for homepage display
- CSS follows BEM-like naming conventions for maintainability
