const normalizeUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
};

const domainFromUrl = (value) => {
  const parsed = new URL(normalizeUrl(value));
  return parsed.hostname.replace(/^www\./i, '');
};

module.exports = { normalizeUrl, domainFromUrl };
