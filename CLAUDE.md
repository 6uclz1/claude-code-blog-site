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

# Build and validate before publishing (公開前ゲートと同じ検証)
npm run build 2>&1 | tee build.log
python scripts/validate_build.py --log build.log --feed dist/feed.xml
```

**Publishing gate**: broken front matter fails the build via the content collection
schema in `src/content.config.ts`, and duplicate permalinks throw explicitly in
`src/pages/[...slug].astro`. On top of that, `scripts/validate_build.py` scans the
build log and the generated `feed.xml` (empty titles, duplicate URLs, build-time
timestamps) and blocks the deploy. The daily automation runs this gate *before*
committing — nothing that fails validation is committed or published, and a failure
opens an issue automatically.

### Docker Development (Recommended)
```bash
# Start the Astro dev server with Docker
docker compose up astro

# Run in background
docker compose up -d astro

# Stop services
docker compose down

# Run Python scripts with Docker
docker compose run --rm python-scripts sh -c "
  pip install -r requirements.txt &&
  python scripts/fetch_and_summarize.py
"
```

### Direct Development (Alternative)
```bash
# Install Node dependencies
npm ci

# Start the dev server
npm run dev

# Install Python dependencies for automation scripts
pip install -r requirements.txt

# Run Hatena bookmark summarization script manually
python scripts/fetch_and_summarize.py
```

### Testing
```bash
# Run all tests with coverage (Docker)
docker compose run --rm python-scripts sh -c "
  pip install -r requirements.txt &&
  python test_runner.py --coverage
"

# Run tests directly
python test_runner.py
python test_runner.py --coverage
python test_runner.py --unittest

# Run specific test
python -m pytest tests/test_fetch_and_summarize.py::TestClass::test_method -v
```

## Site Architecture

### Core Structure
- **astro.config.mjs**: `site` + `base` (GitHub Pages baseurl `/claude-code-blog-site`),
  `trailingSlash: 'always'`, Shiki syntax highlighting
- **package.json**: Node dependencies (astro, marked)
- **Docker Environment**:
  - `Dockerfile`: Astro development environment
  - `Dockerfile.production`: Multi-stage build (Astro build → nginx)
  - `docker-compose.yml`: Development services (astro + python-scripts)
- **Astro sources**:
  - `src/content.config.ts`: content collection reading `_posts/**/*.md`
  - `src/site.ts`: site title / description / author / feed limit
  - `src/lib/posts.ts`: sorting, permalink→URL, date formatting, excerpt rendering
  - `src/layouts/`: `BaseLayout.astro`, `PostLayout.astro`
  - `src/components/`: `Header`, `Footer`, `PostList`, `Pagination`
  - `src/pages/`: `index.astro`, `page[num].astro`, `[...slug].astro`, `feed.xml.ts`
  - `src/styles/global.css`: custom CSS (imported by `BaseLayout`)
  - `_posts/`: blog posts in Markdown with YAML front matter
- **Automation Pipeline**:
  - `scripts/fetch_and_summarize.py`: Hatena bookmark summarization with Gemini AI
  - `scripts/validate_build.py`: pre-publish gate over the build log and feed.xml
  - `tests/`: Unit tests with pytest and mocking for Gemini API
  - `test_runner.py`: Test execution script with coverage support
  - `requirements.txt`: Python dependencies (production + testing)
- **CI/CD**: `.github/workflows/` for automated deployment and content updates

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
  headings fall back to `excerpt`
- **Responsive Design**: Mobile-first CSS with a breakpoint at 720px
- **Japanese Localization**: Date formatting and UI text in Japanese
- **Syntax Highlighting**: Shiki, at build time
- **Automated Content**: Daily Hatena bookmark summarization using Gemini AI

### Content Management
- Blog posts use YAML front matter with `title`, `date`, `permalink`, and `excerpt`
- The `permalink` front matter is the article URL; it follows `/:year/:month/:day/:title/`
  and must match the date in the filename (enforced by `tests/test_posts_integrity.py`)
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
  header is a fixed brand at top-left with the footer at bottom-right
- **Hover**: links share one effect — a gradient sweeping in from the left that inverts
  the text color (`--hover-shape` / `--hover-surface`); disabled under
  `prefers-reduced-motion`
- **Responsive**: single breakpoint at 720px; the post rows collapse to one column

## Automation Architecture

### Content Generation Pipeline
`fetch_and_summarize.py` is a set of small module-level functions (plus a `GeminiSummarizer`
class) wired together by `run()`, with `Bookmark` / `Digest` dataclasses as the data passed
between stages:

1. **RSS Processing**: `fetch_entries()` + `select_bookmarks()` — collects every date an entry
   carries (dc_date, entry-id URL pattern, published_parsed) and keeps the ones matching the
   target day, de-duplicating by URL
2. **Content Extraction**: `fetch_article_text()` picks between two fetchers and returns `None`
   when neither yields text (the entry is then skipped):
   - `fetch_article_text_direct()` scrapes the HTML with BeautifulSoup using fallback selectors
   - `fetch_article_text_via_jina()` fetches `https://r.jina.ai/<url>` for rendered text

   Twitter/X (`JINA_FIRST_HOSTS`) is JavaScript-rendered and shows a login wall, so direct
   scraping returns nothing usable — those hosts go through r.jina.ai first and fall back to
   direct. Every other host is scraped directly first and falls back to r.jina.ai when the
   result is missing or shorter than `MIN_ARTICLE_TEXT_CHARS` (cookie banners, login prompts).
3. **AI Summarization**: `GeminiSummarizer.summarize()` asks Gemini for JSON
   (`{"summary": ..., "points": [...]}`) via `response_mime_type: application/json`, and
   `parse_digest()` normalizes/truncates it — prompt wording alone doesn't keep the length stable
4. **Markdown Generation**: `render_post()` builds the post — one `## [title](url)` heading, a
   one-line summary, and up to 3 short bullets per bookmark — and `write_post()` saves it to
   `_posts/` (front matter always via `yaml.dump`)
5. **Deployment**: GitHub Actions builds with Astro, runs the publishing gate, then deploys to GitHub Pages

**Post length is a product decision**: the daily digest is meant to be skimmed in the morning, so
the summary length limits live in the script (`SUMMARY_MAX_CHARS`, `POINT_MAX_CHARS`, `MAX_POINTS`)
rather than only in the prompt. Adjust those constants to change how long the posts get.

`python scripts/fetch_and_summarize.py --dry-run [--date YYYY-MM-DD]` prints the post instead of
writing it — useful for checking the output length after a prompt change.

### Docker-based Development
- **Containerized Environment**: The Astro dev server and the Python scripts run in separate containers
- **Development Workflow**: `docker compose up astro` provides a hot-reloading dev server at localhost:4000
- **CI/CD Integration**: GitHub Actions builds the site with `actions/setup-node`; Docker is used for the Python scripts
- **Testing Isolation**: Tests run in containerized environment with mocked external dependencies

### Testing Strategy
- **Unit Tests**: Comprehensive pytest suite with 85% code coverage
- **Gemini API Mocking**: All external API calls are mocked to avoid API key dependencies
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
