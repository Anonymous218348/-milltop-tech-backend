const axios = require('axios');

const categories = ['performance', 'seo', 'best-practices', 'accessibility'];

const score = (lighthouse, category) => {
  const value = lighthouse.categories[category] && lighthouse.categories[category].score;
  return typeof value === 'number' ? Math.round(value * 100) : null;
};

const callPageSpeed = async (url, strategy, apiKey, timeout) => {
  const params = new URLSearchParams();
  params.set('url', url);
  params.set('strategy', strategy);
  categories.forEach((category) => params.append('category', category));
  if (apiKey) params.set('key', apiKey);

  const { data } = await axios.get(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params.toString()}`,
    { timeout }
  );
  return data;
};

const runPageSpeed = async (url, strategy, apiKey) => {
  let data;
  try {
    // First attempt — generous timeout since real-world sites can be slow
    data = await callPageSpeed(url, strategy, apiKey, 90000);
  } catch (err) {
    console.error(`PageSpeed first attempt failed for ${url} (${strategy}): ${err.message}`);
    try {
      // Retry once with an even longer timeout before giving up
      data = await callPageSpeed(url, strategy, apiKey, 120000);
    } catch (err2) {
      console.error(`PageSpeed retry failed for ${url} (${strategy}): ${err2.message}`);
      // Return nulls instead of throwing, so one slow/failed strategy
      // doesn't kill the whole scan (mobile + desktop run in parallel)
      return {
        performance: null,
        seo: null,
        bestPractices: null,
        accessibility: null
      };
    }
  }

  const lighthouse = data.lighthouseResult || { categories: {} };
  return {
    performance: score(lighthouse, 'performance'),
    seo: score(lighthouse, 'seo'),
    bestPractices: score(lighthouse, 'best-practices'),
    accessibility: score(lighthouse, 'accessibility')
  };
};

module.exports = { runPageSpeed };
