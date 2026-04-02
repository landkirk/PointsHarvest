#!/usr/bin/env node
// @ts-check
'use strict';

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const POSTS_DIR = path.join(__dirname, '..', 'blog-posts');
const OUT_DIR = path.join(__dirname, '..', 'docs', 'blog');
const SITEMAP_PATH = path.join(__dirname, '..', 'docs', 'sitemap.xml');
const BASE_URL = 'https://pointsharvest.com';

// ── Shared HTML shells ───────────────────────────────────────────────────────

const SHARED_STYLES = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --border: #2a2d3a;
      --accent: #f59e0b;
      --accent-dim: #b45309;
      --text: #e2e8f0;
      --muted: #94a3b8;
      --radius: 10px;
    }

    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.6;
    }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 2rem;
      border-bottom: 1px solid var(--border);
    }
    .nav-logo {
      font-weight: 700;
      font-size: 1.1rem;
      color: var(--text);
      text-decoration: none;
    }
    .nav-logo:hover { text-decoration: none; }
    .nav-logo span { color: var(--accent); }
    .nav-links { display: flex; align-items: center; gap: 1.5rem; font-size: 0.9rem; color: var(--muted); }
    .nav-links a { color: var(--muted); }
    .nav-links a:hover { color: var(--text); text-decoration: none; }
    .nav-links a.active { color: var(--text); }

    footer {
      border-top: 1px solid var(--border);
      text-align: center;
      padding: 2rem;
      font-size: 0.85rem;
      color: var(--muted);
    }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }

    .section-divider {
      border: none;
      border-top: 1px solid var(--border);
      max-width: 1100px;
      margin: 0 auto;
    }

    code {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 0.1rem 0.4rem;
      font-size: 0.85em;
      font-family: "SF Mono", "Fira Code", monospace;
    }
`;

// root is the relative path from the page back to docs/ (e.g. '../' or '../../')
/** @param {string} root */
function makeNav(root) {
  return `
  <nav>
    <a class="nav-logo" href="${root}index.html">Points<span>Harvest</span></a>
    <div class="nav-links">
      <a href="${root}index.html#features">Features</a>
      <a href="${root}index.html#install">Install</a>
      <a href="${root}index.html#faq">FAQ</a>
      <a href="${root}blog/index.html" class="active">Blog</a>
    </div>
  </nav>
`;
}

const FOOTER_HTML = `
  <footer>
    <p>Points Harvest is an independent tool with no affiliation with Microsoft, Bing, or the Rewards program. It is not endorsed, authorized, or supported by Microsoft in any way.</p>
    <p>Microsoft, Bing, and Bing Rewards are trademarks of Microsoft Corporation.</p>
  </footer>
`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function readPosts() {
  if (!fs.existsSync(POSTS_DIR)) return [];

  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf8');
      const { data, content } = matter(raw);

      if (!data.title || !data.date || !data.summary || !data.slug) {
        throw new Error(`Post "${f}" is missing required frontmatter (title, date, summary, slug)`);
      }

      // gray-matter parses YAML dates as JS Date objects; normalise to YYYY-MM-DD
      const rawDate = data.date instanceof Date
        ? data.date.toISOString().slice(0, 10)
        : String(data.date).slice(0, 10);

      return {
        title: String(data.title),
        date: rawDate,
        summary: String(data.summary),
        slug: String(data.slug),
        content,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date)); // newest first
}

// ── Blog listing page ────────────────────────────────────────────────────────

function buildListingPage(posts) {
  const cards = posts
    .map(
      (p) => `
      <article class="post-card">
        <div class="post-meta">${formatDate(p.date)}</div>
        <h2><a href="${p.slug}/index.html">${escapeHtml(p.title)}</a></h2>
        <p class="post-summary">${escapeHtml(p.summary)}</p>
        <a class="read-more" href="${p.slug}/index.html">Read more &rarr;</a>
      </article>
    `,
    )
    .join('\n');

  const empty = `<p class="no-posts">No posts yet — check back soon.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Blog — Points Harvest</title>
  <meta name="description" content="Tips, updates, and guides from the Points Harvest team." />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${BASE_URL}/blog/" />
  <meta property="og:title" content="Blog — Points Harvest" />
  <meta property="og:description" content="Tips, updates, and guides from the Points Harvest team." />
  <meta property="og:image" content="${BASE_URL}/icon1024.png" />

  <link rel="icon" type="image/png" href="../icon1024.png" />
  <style>
    ${SHARED_STYLES}

    .blog-header {
      max-width: 1100px;
      margin: 3rem auto 2rem;
      padding: 0 2rem;
    }
    .blog-header .section-label {
      font-size: 0.78rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--accent);
      font-weight: 600;
      margin-bottom: 0.5rem;
    }
    .blog-header h1 {
      font-size: clamp(1.8rem, 4vw, 2.5rem);
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 0.5rem;
    }
    .blog-header p {
      color: var(--muted);
      font-size: 1rem;
    }

    .post-list {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 2rem 4rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .post-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.75rem;
      transition: border-color 0.2s;
    }
    .post-card:hover { border-color: var(--accent); }

    .post-meta {
      font-size: 0.78rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }

    .post-card h2 {
      font-size: 1.2rem;
      font-weight: 700;
      margin-bottom: 0.6rem;
      line-height: 1.3;
    }
    .post-card h2 a { color: var(--text); }
    .post-card h2 a:hover { color: var(--accent); text-decoration: none; }

    .post-summary {
      font-size: 0.9rem;
      color: var(--muted);
      margin-bottom: 1rem;
      line-height: 1.6;
    }

    .read-more {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--accent);
    }

    .no-posts {
      color: var(--muted);
      font-size: 0.95rem;
      padding: 2rem 0;
    }
  </style>
</head>
<body>
${makeNav('../')}

  <div class="blog-header">
    <div class="section-label">Blog</div>
    <h1>Tips &amp; Updates</h1>
    <p>Guides, release notes, and Bing Rewards tips from the Points Harvest team.</p>
  </div>

  <hr class="section-divider" />

  <div class="post-list">
    ${posts.length > 0 ? cards : empty}
  </div>

${FOOTER_HTML}
</body>
</html>`;
}

// ── Individual post page ─────────────────────────────────────────────────────

function buildPostPage(post) {
  const htmlContent = marked(post.content);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(post.title)} — Points Harvest</title>
  <meta name="description" content="${escapeHtml(post.summary)}" />

  <!-- Open Graph -->
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${BASE_URL}/blog/${post.slug}/" />
  <meta property="og:title" content="${escapeHtml(post.title)} — Points Harvest" />
  <meta property="og:description" content="${escapeHtml(post.summary)}" />
  <meta property="og:image" content="${BASE_URL}/icon1024.png" />

  <link rel="icon" type="image/png" href="../../icon1024.png" />
  <style>
    ${SHARED_STYLES}

    .post-wrapper {
      max-width: 1100px;
      margin: 3rem auto 4rem;
      padding: 0 2rem;
    }

    .back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      color: var(--muted);
      margin-bottom: 2rem;
    }
    .back-link:hover { color: var(--text); text-decoration: none; }

    .post-header { margin-bottom: 2.5rem; }
    .post-date {
      font-size: 0.78rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.6rem;
    }
    .post-title {
      font-size: clamp(1.8rem, 4vw, 2.6rem);
      font-weight: 800;
      line-height: 1.2;
      margin-bottom: 0.75rem;
    }
    .post-summary-text {
      font-size: 1.05rem;
      color: var(--muted);
      line-height: 1.65;
    }

    /* Prose styles for rendered markdown */
    .prose { line-height: 1.75; }
    .prose h2 {
      font-size: 1.4rem;
      font-weight: 700;
      margin: 2.25rem 0 0.75rem;
      padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border);
    }
    .prose h3 {
      font-size: 1.15rem;
      font-weight: 600;
      margin: 1.75rem 0 0.5rem;
    }
    .prose h4 {
      font-size: 1rem;
      font-weight: 600;
      margin: 1.25rem 0 0.4rem;
      color: var(--muted);
    }
    .prose p { margin-bottom: 1.1rem; }
    .prose ul, .prose ol {
      margin: 0 0 1.1rem 1.5rem;
    }
    .prose li { margin-bottom: 0.35rem; }
    .prose blockquote {
      border-left: 3px solid var(--accent);
      margin: 1.5rem 0;
      padding: 0.75rem 1.25rem;
      background: var(--surface);
      border-radius: 0 var(--radius) var(--radius) 0;
      color: var(--muted);
      font-style: italic;
    }
    .prose pre {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.1rem 1.25rem;
      overflow-x: auto;
      margin-bottom: 1.1rem;
    }
    .prose pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.88rem;
    }
    .prose strong { color: var(--text); font-weight: 600; }
    .prose em { color: var(--muted); }
    .prose hr {
      border: none;
      border-top: 1px solid var(--border);
      margin: 2rem 0;
    }
    .prose img {
      max-width: 100%;
      border-radius: var(--radius);
      border: 1px solid var(--border);
      margin: 1rem 0;
    }
    .prose table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 1.1rem;
      font-size: 0.9rem;
    }
    .prose th, .prose td {
      border: 1px solid var(--border);
      padding: 0.5rem 0.75rem;
      text-align: left;
    }
    .prose th {
      background: var(--surface);
      font-weight: 600;
    }
  </style>
</head>
<body>
${makeNav('../../')}

  <div class="post-wrapper">
    <a class="back-link" href="../index.html">&larr; Back to Blog</a>

    <header class="post-header">
      <div class="post-date">${formatDate(post.date)}</div>
      <h1 class="post-title">${escapeHtml(post.title)}</h1>
      <p class="post-summary-text">${escapeHtml(post.summary)}</p>
    </header>

    <hr class="section-divider" style="margin: 0 0 2rem;" />

    <div class="prose">
      ${htmlContent}
    </div>
  </div>

${FOOTER_HTML}
</body>
</html>`;
}

// ── Sitemap update ───────────────────────────────────────────────────────────

function updateSitemap(posts) {
  // Use the most recent post date so the sitemap only changes when content changes
  const latestDate = posts.length > 0 ? posts[0].date : '2026-04-02';

  const staticUrls = `  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${latestDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${BASE_URL}/blog/</loc>
    <lastmod>${latestDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;

  const postUrls = posts
    .map(
      (p) => `  <url>
    <loc>${BASE_URL}/blog/${p.slug}/</loc>
    <lastmod>${p.date}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.7</priority>
  </url>`,
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${staticUrls}
${postUrls}
</urlset>
`;
  fs.writeFileSync(SITEMAP_PATH, xml);
}

// ── Main ─────────────────────────────────────────────────────────────────────

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const posts = readPosts();

  // Write listing page
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), buildListingPage(posts));
  console.log('  [blog] wrote docs/blog/index.html');

  // Write individual post pages
  for (const post of posts) {
    const postDir = path.join(OUT_DIR, post.slug);
    fs.mkdirSync(postDir, { recursive: true });
    fs.writeFileSync(path.join(postDir, 'index.html'), buildPostPage(post));
    console.log(`  [blog] wrote docs/blog/${post.slug}/index.html`);
  }

  // Update sitemap
  updateSitemap(posts);
  console.log('  [blog] updated docs/sitemap.xml');

  console.log(`  [blog] done — ${posts.length} post(s) generated`);
}

main();
