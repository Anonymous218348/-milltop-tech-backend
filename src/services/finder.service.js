const axios = require('axios');
const cheerio = require('cheerio');
const robotsParser = require('robots-parser');
const { delay } = require('../utils/delay');
const { normalizeUrl, domainFromUrl } = require('../utils/url');

const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const genericPrefixes = ['noreply', 'no-reply', 'support', 'admin', 'info'];

const chooseBestEmail = (emails) => {
  const unique = [...new Set(emails.map((email) => email.toLowerCase()))];
  const preferred = unique.find((email) => !genericPrefixes.includes(email.split('@')[0]));
  return preferred || unique[0] || null;
};

const hunterFind = async (domain, apiKey) => {
  if (!apiKey) return null;
  const { data } = await axios.get('https://api.hunter.io/v2/domain-search', {
    params: { domain, api_key: apiKey, limit: 10 },
    timeout: 20000
  });
  const emails = ((data.data && data.data.emails) || []).map((item) => item.value).filter(Boolean);
  return chooseBestEmail(emails);
};

const canFetch = async (baseUrl, pageUrl) => {
  try {
    const robotsUrl = new URL('/robots.txt', baseUrl).toString();
    const { data } = await axios.get(robotsUrl, { timeout: 8000 });
    const robots = robotsParser(robotsUrl, data);
    return robots.isAllowed(pageUrl, 'MILLTOPTECHBot');
  } catch (_error) {
    return true;
  }
};

const scrapeEmails = async (input) => {
  const baseUrl = normalizeUrl(input);
  const paths = ['/', '/contact', '/contact-us', '/about', '/about-us', '/privacy-policy', '/terms', '/terms-of-service', '/faq'];
  const found = [];

  for (const path of paths) {
    const pageUrl = new URL(path, baseUrl).toString();
    const allowed = await canFetch(baseUrl, pageUrl);
    if (!allowed) continue;

    try {
      const { data } = await axios.get(pageUrl, {
        timeout: 15000,
        headers: { 'User-Agent': 'MILLTOPTECHBot/1.0 (+https://milltop.tech)' }
      });
      const $ = cheerio.load(data);
      const bodyText = $('body').text();
      const mailtoEmails = $('a[href^="mailto:"]').map((_, el) => $(el).attr('href').replace(/^mailto:/i, '').split('?')[0]).get();
      found.push(...(bodyText.match(emailRegex) || []), ...mailtoEmails);
    } catch (_error) {
      // Keep moving if one page fails.
    }

    await delay(1000);
  }

  return chooseBestEmail(found);
};

const findEmailForDomain = async (input, hunterApiKey) => {
  const domain = domainFromUrl(input);
  const hunterEmail = await hunterFind(domain, hunterApiKey);
  if (hunterEmail) {
    return { email: hunterEmail, source: 'Hunter', status: 'Found', flagged: false };
  }

  const scrapedEmail = await scrapeEmails(input);
  if (scrapedEmail) {
    return { email: scrapedEmail, source: 'Scraped', status: 'Found', flagged: false };
  }

  return { email: null, source: 'Manual Review', status: 'Email Not Found', flagged: true };
};

module.exports = { findEmailForDomain };
