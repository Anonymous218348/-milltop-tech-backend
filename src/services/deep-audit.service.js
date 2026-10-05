const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeUrl } = require('../utils/url');

const runDeepAudit = async (inputUrl) => {
  const url = normalizeUrl(inputUrl).replace(/\/$/, '');
  const findings = [];
  const pages = [];
  const seen = new Set();
  const queue = [url];

  const add = (severity, type, title, evidence, pageUrl) =>
    findings.push({ severity, type, title, evidence, url: pageUrl });

  while (queue.length && pages.length < 8) {
    const pageUrl = queue.shift();
    if (seen.has(pageUrl)) continue;
    seen.add(pageUrl);

    try {
      const response = await axios.get(pageUrl, {
        timeout: 8000,
        maxRedirects: 4,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MILLTOPTECH-Audit/1.0)' },
        validateStatus: status => status < 500
      });

      pages.push({ url: pageUrl, status: response.status });

      if (response.status >= 400) {
        add(
          response.status >= 500 ? 'high' : 'medium',
          'broken',
          'Page returns HTTP ' + response.status,
          'The page returned HTTP ' + response.status + '.',
          pageUrl
        );
        continue;
      }

      if (typeof response.data !== 'string') continue;

      const $ = cheerio.load(response.data);
      const text = $('body').text().replace(/\s+/g, ' ').trim().toLowerCase();

      if (!$('title').length || !$('title').text().trim()) {
        add('medium', 'seo', 'Missing page title', 'No title element was found.', pageUrl);
      }
      if (!$('meta[name="description"]').attr('content')) {
        add('medium', 'seo', 'Missing meta description', 'No meta description was found.', pageUrl);
      }
      if (!$('meta[name="viewport"]').attr('content')) {
        add('medium', 'ux', 'Missing mobile viewport', 'No viewport meta tag was found.', pageUrl);
      }
      if (!$('html').attr('lang')) {
        add('low', 'accessibility', 'Missing document language', 'The html element has no lang attribute.', pageUrl);
      }
      if (!$('link[rel="canonical"]').attr('href')) {
        add('low', 'seo', 'Missing canonical URL', 'No canonical link was found.', pageUrl);
      }
      if ($('img').filter((_, el) => !$(el).attr('alt')).length) {
        add('medium', 'accessibility', 'Images missing alt text', 'At least one image has no alt attribute.', pageUrl);
      }

      if (
        /shop|collection|category|products/.test(pageUrl + ' ' + text) &&
        /no products found|no products|nothing found|0 products/.test(text) &&
        !/add to cart|add to bag|buy now/.test(text)
      ) {
        add(
          'high',
          'commerce',
          'Catalog page returns no products',
          'The page contains a no-products message while appearing to be a catalog or collection page.',
          pageUrl
        );
      }

      $('a[href]').each((_, el) => {
        try {
          const next = new URL($(el).attr('href'), pageUrl);
          next.hash = '';
          if (
            next.origin === new URL(url).origin &&
            /\/(collections?|products?|shop|category|pages)\//i.test(next.pathname) &&
            !seen.has(next.href)
          ) {
            queue.push(next.href);
          }
        } catch {}
      });
    } catch (err) {
      pages.push({ url: pageUrl, status: 0 });
      add('medium', 'broken', 'Page failed to load', err.message, pageUrl);
    }
  }

  const unique = [];
  const keys = new Set();

  for (const finding of findings) {
    const key = finding.type + '|' + finding.title + '|' + finding.url;
    if (!keys.has(key)) {
      keys.add(key);
      unique.push(finding);
    }
  }

  const priority = unique.some(f => f.severity === 'high')
    ? 'HIGH'
    : unique.some(f => f.severity === 'medium')
      ? 'MEDIUM'
      : unique.length
        ? 'LOW'
        : 'NONE';

  return {
    priority,
    findings: unique.slice(0, 30),
    pages: pages.length
  };
};

module.exports = { runDeepAudit };
