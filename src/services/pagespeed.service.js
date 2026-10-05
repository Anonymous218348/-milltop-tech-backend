const axios = require('axios');

const categories = ['performance', 'seo', 'best-practices', 'accessibility'];

const score = (lighthouse, category) => {
  const value = lighthouse.categories[category] && lighthouse.categories[category].score;
  return typeof value === 'number' ? Math.round(value * 100) : null;
};

const extractFindings = (lighthouse) => {
  const audits = lighthouse.audits || {};
  return Object.values(audits)
    .filter(a => a && a.scoreDisplayMode !== 'notApplicable' && a.scoreDisplayMode !== 'manual' &&
      typeof a.score === 'number' && a.score < 0.9)
    .map(a => ({
      id: a.id,
      title: a.title || a.id,
      score: a.score,
      displayValue: a.displayValue || null,
      evidence: String(a.displayValue || a.explanation || '').slice(0, 500)
    }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 20);
};

const callPageSpeed = async (url, strategy, apiKey, timeout) => {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  categories.forEach(category => params.append('category', category));
  if (apiKey) params.set('key', apiKey);
  const { data } = await axios.get(
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?' + params.toString(),
    { timeout }
  );
  return data;
};

const runPageSpeed = async (url, strategy, apiKey) => {
  let data;
  try {
    data = await callPageSpeed(url, strategy, apiKey, 90000);
  } catch (err) {
    console.error('PageSpeed first attempt failed for ' + url + ' (' + strategy + '): ' + err.message);
    try {
      data = await callPageSpeed(url, strategy, apiKey, 120000);
    } catch (err2) {
      console.error('PageSpeed retry failed for ' + url + ' (' + strategy + '): ' + err2.message);
      return { performance: null, seo: null, bestPractices: null, accessibility: null, findings: [] };
    }
  }

  const lighthouse = data.lighthouseResult || { categories: {}, audits: {} };
  return {
    performance: score(lighthouse, 'performance'),
    seo: score(lighthouse, 'seo'),
    bestPractices: score(lighthouse, 'best-practices'),
    accessibility: score(lighthouse, 'accessibility'),
    findings: extractFindings(lighthouse)
  };
};

module.exports = { runPageSpeed };
