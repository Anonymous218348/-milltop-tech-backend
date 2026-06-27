const express = require('express');
const { body } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { normalizeUrl } = require('../utils/url');
const { runPageSpeed } = require('../services/pagespeed.service');
const { getApiKey } = require('../services/settings.service');

const router = express.Router();
router.use(requireAuth);

router.post('/scan',
  body('urls').custom((value, { req }) => {
    const input = value || req.body.url;
    if (Array.isArray(input)) return input.length > 0 && input.every(Boolean);
    return Boolean(input);
  }),
  validate,
  asyncHandler(async (req, res) => {
    const input = req.body.urls || req.body.url;
    const urls = (Array.isArray(input) ? input : [input]).map(normalizeUrl);
    const apiKey = await getApiKey(req.user.id, 'pagespeed_api_key', 'PAGESPEED_API_KEY');
    const results = [];

    for (const url of urls) {
      const mobile = await runPageSpeed(url, 'mobile', apiKey);
      const desktop = await runPageSpeed(url, 'desktop', apiKey);
      const { rows } = await db.query(
        `INSERT INTO stores (
          user_id, url, mobile_performance, desktop_performance, mobile_seo, desktop_seo,
          mobile_best_practices, desktop_best_practices, mobile_accessibility, desktop_accessibility
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *`,
        [
          req.user.id,
          url,
          mobile.performance,
          desktop.performance,
          mobile.seo,
          desktop.seo,
          mobile.bestPractices,
          desktop.bestPractices,
          mobile.accessibility,
          desktop.accessibility
        ]
      );
      results.push(rows[0]);
    }

    res.status(201).json({ results });
  })
);

router.get('/results', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM stores WHERE user_id = $1 ORDER BY created_at DESC', [req.user.id]);
  res.json({ stores: rows });
}));

module.exports = router;
