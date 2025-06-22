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

### Automated Content Generation
```bash
# Install Python dependencies for automation scripts
pip install -r requirements.txt

# Run Hatena bookmark summarization script manually
python scripts/fetch_and_summarize.py
```

## Site Architecture

### Core Structure
- **_config.yml**: Jekyll configuration with Japanese locale settings, pagination (5 posts per page), and Rouge syntax highlighting
- **Gemfile**: Ruby dependencies including jekyll-paginate plugin
- **_layouts/**: Template files for page structure
  - `default.html`: Base layout with Japanese meta tags and responsive design
  - `post.html`: Individual blog post layout with Japanese date formatting
- **_includes/**: Reusable template components
  - `header.html`: Site navigation with title
  - `footer.html`: Site footer
- **_posts/**: Blog posts in Markdown format with YAML front matter
- **assets/css/**: Custom CSS styling
- **index.html**: Homepage with paginated post listing
- **scripts/**: Python automation scripts
  - `fetch_and_summarize.py`: Automated Hatena bookmark summarization
- **requirements.txt**: Python dependencies for automation
- **.github/workflows/**: GitHub Actions for automated deployment and content updates

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
- **Daily Automation**: GitHub Actions workflow runs at 8:00 JST (23:00 UTC) to fetch Hatena bookmarks
- **Content Processing**: Python script extracts article content and generates AI summaries using Gemini API
- **Auto-Deployment**: New posts trigger Jekyll rebuild and GitHub Pages deployment

### Dependencies
- **Ruby Environment**: Jekyll 4.3.0 with pagination and feed plugins
- **Python Environment**: 3.11+ with web scraping and AI libraries (BeautifulSoup, Gemini API)
- **GitHub Actions**: Automated workflows for content updates and site deployment

### Environment Variables Required
- `GEMINI_API_KEY`: Required for AI summarization in GitHub Actions

## Development Notes

- **IMPORTANT**: Any changes you make must be made through a pull request so we can review them here.
- All content and UI text is in Japanese
- Date formatting uses Japanese format (年月日)
- The site is configured for GitHub Pages deployment with baseurl "/claude-code-blog-site"
- Posts should include proper excerpts for homepage display
- CSS follows BEM-like naming conventions for maintainability
