const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeUrl, domainFromUrl } = require('../utils/url');

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const SKIP_EMAILS = ['noreply','no-reply','support','admin','webmaster','postmaster',
  'mailer-daemon','bounce','donotreply','do-not-reply','example','sentry','wixpress','shopify'];

const chooseBestEmail = (emails) => {
  const unique = [...new Set(emails.map(e => e.toLowerCase()))].filter(e => {
    const local = e.split('@')[0];
    return !SKIP_EMAILS.some(s => local.includes(s)) &&
           !e.includes('example.com') && e.length < 80;
  });
  const preferred = unique.find(e => {
    const local = e.split('@')[0];
    return ['hello','hi','contact','sales','team','founder','owner','ceo',
            'marketing','partnerships','press','media','info'].includes(local);
  });
  return preferred || unique[0] || null;
};

const fetchPage = async (url) => {
  try {
    const { data } = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MILLTOPTECHBot/1.0)',
        'Accept': 'text/html'
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
  $('script, style, noscript').remove();
  const found = [];

  // mailto links (most reliable)
  $('a[href^="mailto:"]').each((_, el) => {
    const email = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0].trim();
    if (email) found.push(email);
  });

  // body text
  found.push(...($('body').text().match(emailRegex) || []));

  // JSON-LD schema
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      found.push(...(JSON.stringify(JSON.parse($(el).html())).match(emailRegex) || []));
    } catch {}
  });

  return found;
};

const scrapeEmails = async (input) => {
  const baseUrl = normalizeUrl(input);

  // Top 5 most likely pages — fetched ALL AT ONCE in parallel
  const paths = ['/', '/contact', '/about', '/pages/contact', '/privacy-policy'];

  const pages = await Promise.all(
    paths.map(path => {
      try {
        return fetchPage(new URL(path, baseUrl).toString());
      } catch {
        return null;
      }
    })
  );

  const found = [];
  for (const html of pages) {
    found.push(...extractEmailsFromHtml(html));
    const email = chooseBestEmail(found);
    if (email) return email; // stop as soon as we find one
  }

  return chooseBestEmail(found);
};

const findEmailForDomain = async (input, hunterApiKey) => {
  const domain = domainFromUrl(input);

  // Try Hunter first if key available
  if (hunterApiKey) {
    try {
      const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: hunterApiKey, limit: 5 },
        timeout: 10000
      });
      const emails = ((data.data && data.data.emails) || []).map(i => i.value).filter(Boolean);
      const email = chooseBestEmail(emails);
      if (email) return { email, source: 'Hunter', status: 'Found', flagged: false };
    } catch {}
  }

  // Parallel scrape (fast)
  const scrapedEmail = await scrapeEmails(input);
  if (scrapedEmail) {
    return { email: scrapedEmail, source: 'Scraped', status: 'Found', flagged: false };
  }

  return { email: null, source: 'Manual Review', status: 'Email Not Found', flagged: true };
};

module.exports = { findEmailForDomain };
