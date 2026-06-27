const axios = require('axios');

const categories = ['performance', 'seo', 'best-practices', 'accessibility'];

const score = (lighthouse, category) => {
  const value = lighthouse.categories[category] && lighthouse.categories[category].score;
  return typeof value === 'number' ? Math.round(value * 100) : null;
};

const runPageSpeed = async (url, strategy, apiKey) => {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  categories.forEach((category) => params.append('category', category));
  if (apiKey) params.set('key', apiKey);

  const { data } = await axios.get(`https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`, {
    timeout: 45000
  });

  const lighthouse = data.lighthouseResult || { categories: {} };
  return {
    performance: score(lighthouse, 'performance'),
    seo: score(lighthouse, 'seo'),
    bestPractices: score(lighthouse, 'best-practices'),
    accessibility: score(lighthouse, 'accessibility')
  };
};

module.exports = { runPageSpeed };
