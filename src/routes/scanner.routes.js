const express = require('express');
const { body } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { normalizeUrl } = require('../utils/url');
const { runPageSpeed } = require('../services/pagespeed.service');
const { getApiKey } = require('../services/settings.service');
const axios = require('axios');
const router = express.Router();
router.use(requireAuth);

// Quick check — skips dead/unreachable sites before wasting PageSpeed quota
const isSiteAlive = async (url) => {
  try {
    const res = await axios.head(url, {
      timeout: 5000,
      maxRedirects: 3,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MILLTOPTECHBot/1.0)' }
    });
    return res.status < 500;
  } catch {
    // Try GET if HEAD fails (some servers block HEAD)
    try {
      const res = await axios.get(url, {
        timeout: 5000,
        maxRedirects: 3,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MILLTOPTECHBot/1.0)' }
      });
      res.data.destroy();
      return res.status < 500;
    } catch {
      return false;
    }
  }
};

const scanSingleUrl = async (url, apiKey, userId) => {
  try {
    // Skip dead sites
    const alive = await isSiteAlive(url);
    if (!alive) {
      return { success: false, url, error: 'Site unreachable — skipped' };
    }
    // Run mobile and desktop in parallel
    const [mobile, desktop] = await Promise.all([
      runPageSpeed(url, 'mobile', apiKey),
      runPageSpeed(url, 'desktop', apiKey)
    ]);
    const { rows } = await db.query(
      `INSERT INTO stores (
        user_id, url, mobile_performance, desktop_performance, mobile_seo, desktop_seo,
        mobile_best_practices, desktop_best_practices, mobile_accessibility, desktop_accessibility
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING
      RETURNING *`,
      [
        userId, url,
        mobile.performance, desktop.performance,
        mobile.seo, desktop.seo,
        mobile.bestPractices, desktop.bestPractices,
        mobile.accessibility, desktop.accessibility
      ]
    );
    return { success: true, data: rows[0] };
  } catch (err) {
    return { success: false, url, error: err.message };
  }
};

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
    const BATCH_SIZE = 5; // 5 sites at a time
    const results = [];
    const skipped = [];
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
      const batch = urls.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(url => scanSingleUrl(url, apiKey, req.user.id))
      );
      for (const r of batchResults) {
        if (r.success && r.data) results.push(r.data);
        else skipped.push({ url: r.url, reason: r.error });
      }
    }
    res.status(201).json({ results, skipped });
  })
);

// Returns scanned stores, excluding any that already have a successfully
// sent email logged — so the Email Sender / Email Finder lists don't keep
// showing stores you've already emailed.
// Returns scanned stores
router.get('/results', async (req, res) => {
  try {
    const { rows } = await db.query(
      `
      SELECT s.*
      FROM stores s
      WHERE s.user_id = $1
      AND NOT EXISTS (
        SELECT 1
        FROM email_logs el
        WHERE el.user_id = s.user_id
          AND el.store_id = s.id
          AND el.status = 'sent'
      )
      ORDER BY s.created_at DESC
      `,
      [req.user.id]
    );

    res.json({ stores: rows });

  } catch (err) {
    console.error('===== SCANNER RESULTS ERROR =====');
    console.error(err);
    console.error('=================================');

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Permanently remove a scanned store (used by the delete button in
// Email Finder / Scanner tables).
router.delete('/:id', asyncHandler(async (req, res) => {
  await db.query('DELETE FROM stores WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.sendStatus(204);
}));

module.exports = router;
