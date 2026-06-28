const axios = require('axios');
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const { delay } = require('../utils/delay');
const { normalizeUrl, domainFromUrl } = require('../utils/url');

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const genericPrefixes = ['noreply', 'no-reply', 'support', 'admin', 'webmaster', 'postmaster', 'mailer-daemon', 'bounce', 'donotreply', 'do-not-reply'];

const chooseBestEmail = (emails) => {
  const unique = [...new Set(emails.map(e => e.toLowerCase()))].filter(e =>
    !genericPrefixes.includes(e.split('@')[0]) &&
    !e.includes('example.com') &&
    !e.includes('sentry') &&
    !e.includes('wixpress') &&
    !e.includes('shopify') &&
    e.length < 80
  );
  const preferred = unique.find(e => {
    const local = e.split('@')[0];
    return ['hello', 'hi', 'contact', 'sales', 'team', 'founder', 'owner', 'ceo', 'marketing', 'partnerships', 'press', 'media'].includes(local);
  });
  return preferred || unique[0] || null;
};

const canFetch = async (baseUrl, pageUrl) => {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).toString();
    const { data } = await axios.get(robotsUrl, { timeout: 8000 });
    const robots = robotsParser(robotsUrl, data);
    return robots.isAllowed(pageUrl, 'MILLTOPTECHBot');
  } catch {
    return true;
  }
};

const fetchPage = async (url) => {
  try {
    const { data } = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MILLTOPTECHBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });
    return data;
  } catch {
    return null;
  }
};

const extractEmailsFromHtml = (html) => {
  if (!html) return [];
  const $ = cheerio.load(html);

  // Remove scripts and styles
  $('script, style, noscript').remove();

  const found = [];

  // mailto links
  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0].trim();
    if (email) found.push(email);
  });

  // Body text regex
  const bodyText = $('body').text();
  const textMatches = bodyText.match(emailRegex) || [];
  found.push(...textMatches);

  // HTML source regex (catches obfuscated emails in data attributes)
  const htmlMatches = html.match(emailRegex) || [];
  found.push(...htmlMatches);

  // Schema markup / JSON-LD
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const json = JSON.parse($(el).html());
      const str = JSON.stringify(json);
      const matches = str.match(emailRegex) || [];
      found.push(...matches);
    } catch {}
  });

  // Meta tags
  $('meta').each((_, el) => {
    const content = $(el).attr('content') || '';
    const matches = content.match(emailRegex) || [];
    found.push(...matches);
  });

  return found;
};

const scrapeEmails = async (input) => {
  const baseUrl = normalizeUrl(input);
  const domain = domainFromUrl(input);

  const paths = [
    '/', '/contact', '/contact-us', '/about', '/about-us',
    '/privacy-policy', '/terms', '/terms-of-service', '/faq',
    '/pages/contact', '/pages/about', '/pages/contact-us',  // Shopify
    '/info/contact', '/help/contact', '/support',
    '/company', '/team', '/our-team', '/founders',
    '/get-in-touch', '/reach-us', '/connect', '/hire-us',
    '/work-with-us', '/partnerships', '/press', '/media'
  ];

  const found = [];

  for (const path of paths) {
    const pageUrl = new URL(path, baseUrl).toString();
    const allowed = await canFetch(baseUrl, pageUrl);
    if (!allowed) continue;

    const html = await fetchPage(pageUrl);
    if (html) {
      found.push(...extractEmailsFromHtml(html));

      // Also follow contact/about links found on the page
      if (path === '/') {
        const $ = cheerio.load(html);
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const text = $(el).text().toLowerCase();
          if (
            (text.includes('contact') || text.includes('about') || text.includes('email') || text.includes('reach')) &&
            href.startsWith('/')
          ) {
            paths.push(href.split('?')[0]);
          }
        });
      }
    }

    if (found.length > 10) break; // enough emails found
    await delay(800);
  }

  // Try Whois-based email via public API
  try {
    const whoisResp = await axios.get(`https://api.whoisfreaks.com/v1.0/whois?apiKey=free&whois=live&domainName=${domain}`, { timeout: 10000 });
    const whoisStr = JSON.stringify(whoisResp.data);
    const whoisMatches = whoisStr.match(emailRegex) || [];
    found.push(...whoisMatches);
  } catch {}

  return chooseBestEmail(found);
};

const findEmailForDomain = async (input, hunterApiKey) => {
  const domain = domainFromUrl(input);

  // Try Hunter first if key available
  if (hunterApiKey) {
    try {
      const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: hunterApiKey, limit: 10 },
        timeout: 20000
      });
      const emails = ((data.data && data.data.emails) || []).map(item => item.value).filter(Boolean);
      const email = chooseBestEmail(emails);
      if (email) return { email, source: 'Hunter', status: 'Found', flagged: false };
    } catch {}
  }

  // Deep scrape
  const scrapedEmail = await scrapeEmails(input);
  if (scrapedEmail) {
    return { email: scrapedEmail, source: 'Scraped', status: 'Found', flagged: false };
  }

  return { email: null, source: 'Manual Review', status: 'Email Not Found', flagged: true };
};

module.exports = { findEmailForDomain };
