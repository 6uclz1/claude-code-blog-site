# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Jekyll-based Japanese blog site built with Ruby and Jekyll 4.3.0. The site uses a simple, modern design with pagination support and syntax highlighting.

## Development Commands

### Local Development
```bash
# Install Ruby dependencies
bundle install

# Start Jekyll development server with live reload
bundle exec jekyll serve

# Build the site for production
bundle exec jekyll build

# Build and watch for changes (development)
bundle exec jekyll build --watch
```

### Testing and Validation
```bash
# Check Jekyll configuration
bundle exec jekyll doctor

# Validate HTML output (if htmlproofer is added)
bundle exec htmlproofer ./_site
```

### Docker Development (Recommended)
```bash
# Start Jekyll development server with Docker
docker-compose up jekyll

# Run Jekyll in background
docker-compose up -d jekyll

# Stop services
docker-compose down

# Run Python scripts with Docker
docker-compose run --rm python-scripts sh -c "
  pip install -r requirements.txt &&
  python scripts/fetch_and_summarize.py
"
```

### Direct Development (Alternative)
```bash
# Install Ruby dependencies
bundle install

# Start Jekyll development server
bundle exec jekyll serve

# Install Python dependencies for automation scripts
pip install -r requirements.txt

# Run Hatena bookmark summarization script manually
python scripts/fetch_and_summarize.py
```

### Testing
```bash
# Run all tests with coverage (Docker)
docker-compose run --rm python-scripts sh -c "
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
- **_config.yml**: Jekyll configuration with Japanese locale settings, pagination (5 posts per page), and Rouge syntax highlighting
- **Gemfile**: Ruby dependencies including jekyll-paginate plugin
- **Docker Environment**:
  - `Dockerfile`: Jekyll development environment with live reload
  - `Dockerfile.production`: Multi-stage build for production deployment
  - `docker-compose.yml`: Development services (Jekyll + Python scripts)
- **Jekyll Templates**:
  - `_layouts/`: Template files (`default.html`, `post.html`)
  - `_includes/`: Reusable components (`header.html`, `footer.html`)
  - `_posts/`: Blog posts in Markdown with YAML front matter
  - `assets/css/`: Custom CSS styling
- **Automation Pipeline**:
  - `scripts/fetch_and_summarize.py`: Hatena bookmark summarization with Gemini AI
  - `tests/`: Unit tests with pytest and mocking for Gemini API
  - `test_runner.py`: Test execution script with coverage support
  - `requirements.txt`: Python dependencies (production + testing)
- **CI/CD**: `.github/workflows/` for automated deployment and content updates

### Key Features
- **Pagination**: Configured for 5 posts per page with Japanese navigation ("前へ"/"次へ")
- **Responsive Design**: Mobile-first CSS with breakpoints at 768px
- **Japanese Localization**: Date formatting and UI text in Japanese
- **Syntax Highlighting**: Rouge highlighter for code blocks
- **Modern CSS**: Uses Flexbox, CSS Grid patterns, and smooth transitions
- **Automated Content**: Daily Hatena bookmark summarization using Gemini AI

### Content Management
- Blog posts use YAML front matter with `layout: post`, `title`, `date`, and `excerpt` fields
- Permalinks follow the pattern: `/:year/:month/:day/:title/`
- Japanese content with proper typography and line-height optimization
- Code examples include CSS, JavaScript, and HTML snippets

### Styling System
- **Typography**: Uses Japanese-friendly font stack with Helvetica Neue and Hiragino Sans
- **Color Palette**: 
  - Primary: #2c3e50 (dark blue-gray)
  - Accent: #3498db (blue)
  - Background: #fafafa (light gray)
- **Components**: Card-based post layout with hover effects and shadows
- **Responsive**: Mobile-optimized with adjusted padding and font sizes

## Automation Architecture

### Content Generation Pipeline
The `fetch_and_summarize.py` script implements a comprehensive automated content generation system:

1. **RSS Processing**: Fetches Hatena bookmark RSS feed and filters entries from yesterday using multiple date detection methods (dc_date, URL patterns, published_parsed)
2. **Content Extraction**: Scrapes full article content using BeautifulSoup with fallback selectors for different site structures
3. **AI Summarization**: Uses Gemini API to generate 3-5 sentence summaries with error handling and fallback messages
4. **Markdown Generation**: Creates Jekyll-compatible posts with YAML front matter, excerpts, and proper Japanese formatting
5. **Deployment**: GitHub Actions triggers Jekyll rebuild and GitHub Pages deployment

### Docker-based Development
- **Containerized Environment**: Both Jekyll and Python environments run in separate Docker containers
- **Development Workflow**: `docker-compose up jekyll` provides live-reload development server at localhost:4000
- **CI/CD Integration**: GitHub Actions uses Docker builds for consistent environments
- **Testing Isolation**: Tests run in containerized environment with mocked external dependencies

### Testing Strategy
- **Unit Tests**: Comprehensive pytest suite with 85% code coverage
- **Gemini API Mocking**: All external API calls are mocked to avoid API key dependencies
- **Error Scenarios**: Tests cover RSS failures, content extraction errors, and API timeout scenarios
- **File Operations**: Tests verify Markdown file creation and content formatting

### Environment Variables Required
- `GEMINI_API_KEY`: Required for AI summarization in GitHub Actions (not needed for tests)

## Development Notes

- **IMPORTANT**: Any changes you make must be made through a pull request so we can review them here.
- All content and UI text is in Japanese
- Date formatting uses Japanese format (年月日)
- The site is configured for GitHub Pages deployment with baseurl "/claude-code-blog-site"
- Posts should include proper excerpts for homepage display
- CSS follows BEM-like naming conventions for maintainability
