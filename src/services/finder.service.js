const axios = require('axios');
const cheerio = require('cheerio');
const { normalizeUrl, domainFromUrl } = require('../utils/url');

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const SKIP_DOMAINS = ['sentry.io','wixpress.com','shopify.com','shopifycdn.com','shopifyemails.com',
  'example.com','githubusercontent.com','cloudflare.com','google.com','facebook.com',
  'twitter.com','instagram.com','tiktok.com','youtube.com','amazon.com','klaviyo.com',
  'mailchimp.com','gorgias.com','zendesk.com','intercom.io','freshdesk.com'];

const SKIP_LOCALS = ['noreply','no-reply','webmaster','postmaster','mailer-daemon','bounce',
  'donotreply','do-not-reply','unsubscribe','abuse','spam','privacy','legal','dmca',
  'billing','invoice','orders','notifications','alerts','newsletter'];

const PREFERRED_LOCALS = ['hello','hi','contact','sales','team','founder','owner','ceo',
  'director','marketing','partnerships','press','media','info','enquiries','enquiry',
  'shop','store','support','help','service','customer'];

const isImageFile = (email) => {
  const lower = email.toLowerCase();
  return /\.(png|jpg|jpeg|gif|webp|svg|ico|bmp|tiff|avif)/.test(lower) ||
         /@[0-9]+x\./.test(lower) ||
         /[0-9]+x@/.test(lower) ||
         /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}/.test(lower);
};

const isValidEmail = (email) => {
  const [local, domain] = email.toLowerCase().split('@');
  if (!domain) return false;
  if (isImageFile(email)) return false;
  if (!/^[a-zA-Z0-9._%+-]+$/.test(local)) return false;
  if (local.length > 50) return false;
  if (!/\.[a-zA-Z]{2,}$/.test(domain)) return false;
  if (SKIP_DOMAINS.some(d => domain.includes(d))) return false;
  if (SKIP_LOCALS.includes(local)) return false;
  if (email.length > 80) return false;
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

  // 1. mailto links
  $('a[href^="mailto:"]').each((_, el) => {
    const raw = $(el).attr('href').replace(/^mailto:/i, '').split('?')[0].trim();
    if (raw && raw.includes('@')) found.push(raw);
  });

  // 2. Body text
  found.push(...($('body').text().match(emailRegex) || []));

  // 3. Full HTML source
  found.push(...(html.match(emailRegex) || []));

  // 4. JSON-LD schema
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      found.push(...(JSON.stringify(JSON.parse($(el).html())).match(emailRegex) || []));
    } catch {}
  });

  // 5. Meta tags
  $('meta[content]').each((_, el) => {
    const content = $(el).attr('content') || '';
    found.push(...(content.match(emailRegex) || []));
  });

  // 6. Data attributes
  $('[data-email],[data-contact],[data-owner]').each((_, el) => {
    ['data-email','data-contact','data-owner'].forEach(attr => {
      const val = $(el).attr(attr);
      if (val && val.includes('@')) found.push(val);
    });
  });

  return found;
};

// Extract emails from Shopify sitemap to find hidden pages
const getSitemapPages = async (baseUrl) => {
  try {
    const { data } = await axios.get(baseUrl + '/sitemap.xml', { timeout: 8000 });
    const matches = data.match(/<loc>(.*?)<\/loc>/g) || [];
    return matches
      .map(m => m.replace(/<\/?loc>/g, '').trim())
      .filter(url => 
        url.includes('/pages/') || 
        url.includes('/contact') || 
        url.includes('/about')
      )
      .slice(0, 10);
  } catch {
    return [];
  }
};

// Check security.txt
const getSecurityTxt = async (baseUrl) => {
  const urls = [
    baseUrl + '/.well-known/security.txt',
    baseUrl + '/security.txt'
  ];
  for (const url of urls) {
    try {
      const { data } = await axios.get(url, { timeout: 5000 });
      const emails = data.match(emailRegex) || [];
      if (emails.length > 0) return emails;
    } catch {}
  }
  return [];
};

// Shopify-specific: get store email from contact form page source
const getShopifyContactEmail = async (baseUrl) => {
  try {
    const html = await fetchPage(baseUrl + '/pages/contact');
    if (!html) return [];
    const $ = cheerio.load(html);
    const found = [];
    
    // Check form action
    $('form').each((_, el) => {
      const action = $(el).attr('action') || '';
      const matches = action.match(emailRegex) || [];
      found.push(...matches);
    });

    // Check for email in Shopify theme settings embedded in page
    const themeMatch = html.match(/"email"\s*:\s*"([^"]+@[^"]+)"/);
    if (themeMatch) found.push(themeMatch[1]);

    // Check contact_email in page source
    const contactMatch = html.match(/contact_email['":\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (contactMatch) found.push(contactMatch[1]);

    return found;
  } catch {
    return [];
  }
};

// Check robots.txt for sitemap and useful paths
const getRobotsPaths = async (baseUrl) => {
  try {
    const { data } = await axios.get(baseUrl + '/robots.txt', { timeout: 5000 });
    const sitemaps = data.match(/Sitemap:\s*(.+)/gi) || [];
    return sitemaps.map(s => s.replace(/Sitemap:\s*/i, '').trim());
  } catch {
    return [];
  }
};

const scrapeEmails = async (input) => {
  const baseUrl = normalizeUrl(input);
  const isShopify = input.includes('myshopify.com') || input.includes('shopify');

  // Core pages - fetched in parallel
  const corePaths = [
    '/', '/contact', '/contact-us', '/about', '/about-us',
    '/privacy-policy', '/pages/contact', '/pages/about',
    '/pages/contact-us', '/pages/about-us',
    '/info/contact', '/help', '/support'
  ];

  // Add Shopify-specific paths
  if (isShopify) {
    corePaths.push(
      '/pages/faq', '/pages/shipping', '/pages/returns',
      '/pages/wholesale', '/pages/stockists', '/pages/press'
    );
  }

  const allEmails = [];

  // 1. Fetch all core pages in parallel
  const pageHtmls = await Promise.all(
    corePaths.map(path => {
      try { return fetchPage(new URL(path, baseUrl).toString()); } 
      catch { return null; }
    })
  );
  for (const html of pageHtmls) {
    allEmails.push(...extractEmailsFromHtml(html));
  }

  // 2. Check security.txt in parallel
  const [securityEmails, shopifyEmails] = await Promise.all([
    getSecurityTxt(baseUrl),
    isShopify ? getShopifyContactEmail(baseUrl) : Promise.resolve([])
  ]);
  allEmails.push(...securityEmails, ...shopifyEmails);

  // 3. Check sitemap for hidden pages
  const sitemapPages = await getSitemapPages(baseUrl);
  if (sitemapPages.length > 0) {
    const sitemapHtmls = await Promise.all(
      sitemapPages.slice(0, 8).map(url => fetchPage(url))
    );
    for (const html of sitemapHtmls) {
      allEmails.push(...extractEmailsFromHtml(html));
    }
  }

  // 4. Follow extra contact links from homepage
  const homepageHtml = pageHtmls[0];
  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);
    const extraPaths = [];
    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').split('?')[0];
      const text = $(el).text().toLowerCase();
      if (
        href.startsWith('/') &&
        !corePaths.includes(href) &&
        href.length < 60 &&
        (text.includes('contact') || text.includes('about') ||
         text.includes('reach') || text.includes('email') ||
         text.includes('touch') || text.includes('connect') ||
         text.includes('wholesale') || text.includes('press') ||
         text.includes('stockist'))
      ) {
        extraPaths.push(href);
      }
    });

    if (extraPaths.length > 0) {
      const extraHtmls = await Promise.all(
        [...new Set(extraPaths)].slice(0, 6).map(path => {
          try { return fetchPage(new URL(path, baseUrl).toString()); }
          catch { return null; }
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

  // Deep Shopify-aware scrape
  const scrapedEmail = await scrapeEmails(input);
  if (scrapedEmail) {
    return { email: scrapedEmail, source: 'Scraped', status: 'Found', flagged: false };
  }

  return { email: null, source: 'Manual Review', status: 'Email Not Found', flagged: true };
};

module.exports = { findEmailForDomain };
