const express = require('express');
const { body } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { getSettings } = require('../services/settings.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const settings = await getSettings(req.user.id);
  res.json({
    settings: settings || {
      pagespeed_api_key: null,
      hunter_api_key: null,
      groq_api_key: null,
      gmail_accounts: []
    }
  });
}));

router.post('/',
  body('gmailAccounts').optional().isArray(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `INSERT INTO user_settings (user_id, pagespeed_api_key, hunter_api_key, groq_api_key, gmail_accounts)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id)
       DO UPDATE SET pagespeed_api_key=$2, hunter_api_key=$3, groq_api_key=$4, gmail_accounts=$5, updated_at=NOW()
       RETURNING *`,
      [
        req.user.id,
        req.body.pagespeedApiKey || null,
        req.body.hunterApiKey || null,
        req.body.groqApiKey || null,
        JSON.stringify(req.body.gmailAccounts || [])
      ]
    );
    res.json({ settings: rows[0] });
  })
);

module.exports = router;
