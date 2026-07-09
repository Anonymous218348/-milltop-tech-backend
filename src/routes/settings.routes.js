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
      sendgrid_api_key: null,
      mailgun_api_key: null,
      mailgun_domain: null,
      mailgun_from: null,
      gmail_accounts: []
    }
  });
}));

router.post('/',
  body('gmailAccounts').optional().isArray(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `INSERT INTO user_settings (
        user_id, pagespeed_api_key, hunter_api_key, groq_api_key,
        sendgrid_api_key, sendgrid_from, sendgrid_name,
        mailgun_api_key, mailgun_domain, mailgun_from, gmail_accounts
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (user_id)
      DO UPDATE SET
        pagespeed_api_key=$2, hunter_api_key=$3, groq_api_key=$4,
        sendgrid_api_key=$5, sendgrid_from=$6, sendgrid_name=$7,
        mailgun_api_key=$8, mailgun_domain=$9, mailgun_from=$10,
        gmail_accounts=$11, updated_at=NOW()
      RETURNING *`,
      [
        req.user.id,
        req.body.pagespeedApiKey || null,
        req.body.hunterApiKey || null,
        req.body.groqApiKey || null,
        req.body.sendgridApiKey || null,
        req.body.sendgridFrom || null,
        req.body.sendgridName || null,
        req.body.mailgunApiKey || null,
        req.body.mailgunDomain || null,
        req.body.mailgunFrom || null,
        JSON.stringify(req.body.gmailAccounts || [])
      ]
    );
    res.json({ settings: rows[0] });
  })
);
