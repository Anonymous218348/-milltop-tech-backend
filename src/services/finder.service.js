const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeUrl, domainFromUrl } = require('../utils/url');

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const SKIP_DOMAINS = ['sentry.io','wixpress.com','shopify.com','example.com','githubusercontent.com','cloudflare.com','google.com','facebook.com','twitter.com','instagram.com','tiktok.com','youtube.com','amazon.com'];
const SKIP_LOCALS = ['noreply','no-reply','webmaster','postmaster','mailer-daemon','bounce','donotreply','do-not-reply','unsubscribe','abuse','spam'];

const PREFERRED_LOCALS = ['hello','hi','contact','sales','team','founder','owner','ceo','director','marketing','partnerships','press','media','info','enquiries','enquiry','orders','shop'];

const isValidEmail = (email) => {
  const [local, domain] = email.toLowerCase().split('@');
  if (!domain) return false;
  if (SKIP_DOMAINS.some(d => domain.includes(d))) return false;
  if (SKIP_LOCALS.some(s => local === s)) return false;
  if (email.length > 80) return false;
  if (local.includes('example')) return false;
  return true;
};

const chooseBestEmail = (emails) => {
  const valid = [...new Set(emails.map(e => e.toLowerCase()))].filter(isValidEmail);
  const preferred = valid.find(e => PREFERRED_LOCALS.includes(e.split('@')[0]));
  return preferred || valid[0] || null;
};

const fetchPage = async (url) => {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
      },
      maxRedirects: 5
    });
    return data;
  } catch {
    return null;
  }
};

const extractEmailsFromHtml = (html) => {
  if (!html) return [];
  const $ = cheerio.load(html);
  $('script[src], style, noscript, svg').remove();

  const found = [];

  // 1. mailto links — most reliable
  $('a[href^="mailto:"]').each((_, el) => {
    const raw = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0].trim();
    if (raw && raw.includes('@')) found.push(raw);
  });

  // 2. Visible text
  const bodyText = $('body').text();
  found.push(...(bodyText.match(emailRegex) || []));

  // 3. Full HTML source (catches obfuscated/hidden emails)
  found.push(...(html.match(emailRegex) || []));

  // 4. JSON-LD schema markup
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const str = JSON.stringify(JSON.parse($(el).html()));
      found.push(...(str.match(emailRegex) || []));
    } catch {}
  });

  // 5. Meta tags
  $('meta[content]').each((_, el) => {
    const content = $(el).attr('content') || '';
    found.push(...(content.match(emailRegex) || []));
  });

  // 6. Data attributes
  $('[data-email]').each((_, el) => {
    const email = $(el).attr('data-email');
    if (email && email.includes('@')) found.push(email);
  });

  return found;
};

const scrapeEmails = async (input) => {
  const baseUrl = normalizeUrl(input);

  // All pages fetched in parallel
  const paths = [
    '/', '/contact', '/contact-us', '/about', '/about-us',
    '/privacy-policy', '/terms', '/pages/contact', '/pages/about',
    '/info/contact', '/help', '/support', '/get-in-touch'
  ];

  const pageHtmls = await Promise.all(
    paths.map(path => {
      try {
        return fetchPage(new URL(path, baseUrl).toString());
      } catch {
        return null;
      }
    })
  );

  // Collect ALL emails from ALL pages
  const allEmails = [];
  for (const html of pageHtmls) {
    allEmails.push(...extractEmailsFromHtml(html));
  }

  // Also check homepage for hidden contact page links
  const homepageHtml = pageHtmls[0];
  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);
    const extraPaths = [];
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').split('?')[0];
      const text = $(el).text().toLowerCase();
      if (
        href.startsWith('/') &&
        !paths.includes(href) &&
        (text.includes('contact') || text.includes('about') || 
         text.includes('reach') || text.includes('email') ||
         text.includes('touch') || text.includes('connect'))
      ) {
        extraPaths.push(href);
      }
    });

    // Fetch extra contact-related pages found on homepage
    if (extraPaths.length > 0) {
      const extraHtmls = await Promise.all(
        extraPaths.slice(0, 5).map(path => {
          try {
            return fetchPage(new URL(path, baseUrl).toString());
          } catch {
            return null;
          }
        })
      );
      for (const html of extraHtmls) {
        allEmails.push(...extractEmailsFromHtml(html));
      }
    }
  }

  return chooseBestEmail(allEmails);
};

const findEmailForDomain = async (input, hunterApiKey) => {
  const domain = domainFromUrl(input);

  // Try Hunter first if key available
  if (hunterApiKey) {
    try {
      const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: hunterApiKey, limit: 10 },
        timeout: 10000
      });
      const emails = ((data.data && data.data.emails) || []).map(i => i.value).filter(Boolean);
      const email = chooseBestEmail(emails);
      if (email) return { email, source: 'Hunter', status: 'Found', flagged: false };
    } catch {}
  }

  // Deep parallel scrape
  const scrapedEmail = await scrapeEmails(input);
  if (scrapedEmail) {
    return { email: scrapedEmail, source: 'Scraped', status: 'Found', flagged: false };
  }

  return { email: null, source: 'Manual Review', status: 'Email Not Found', flagged: true };
};

module.exports = { findEmailForDomain };
