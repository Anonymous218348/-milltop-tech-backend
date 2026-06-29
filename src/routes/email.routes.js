const express = require('express');
const { body } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { getGmailAccounts } = require('../services/settings.service');
const { personalize, sendOne, sendBulk } = require('../services/email.service');
const { HttpError } = require('../utils/httpError');

const router = express.Router();
router.use(requireAuth);

router.post('/send',
  body('to').isEmail().normalizeEmail(),
  body('subject').notEmpty(),
  body('body').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const accounts = await getGmailAccounts(req.user.id);
    if (!accounts.length) throw new HttpError(400, 'Add a Gmail account in settings first');
    const data = req.body.data || {};
    const log = await sendOne({
      userId: req.user.id,
      account: accounts[0],
      to: req.body.to,
      subject: personalize(req.body.subject, data),
      body: personalize(req.body.body, data),
      storeId: req.body.storeId,
      contactId: req.body.contactId,
      campaignId: req.body.campaignId
    });
    res.json({ log });
  })
);

router.post('/bulk',
  body('contacts').isArray({ min: 1 }),
  body('subject').notEmpty(),
  body('body').notEmpty(),
  body('delayMs').optional().isInt({ min: 0 }),
  validate,
  asyncHandler(async (req, res) => {
    const accounts = await getGmailAccounts(req.user.id);
    const results = await sendBulk({
      userId: req.user.id,
      accounts,
      contacts: req.body.contacts,
      subject: req.body.subject,
      body: req.body.body,
      delayMs: req.body.delayMs || 1000,
      campaignId: req.body.campaignId
    });
    res.json({ results });
  })
);

router.get('/logs', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM email_logs WHERE user_id=$1 ORDER BY COALESCE(sent_at, NOW()) DESC', [req.user.id]);
  res.json({ logs: rows });
}));
router.post('/log',
  body('toEmail').isEmail().normalizeEmail(),
  body('subject').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `INSERT INTO email_logs (user_id, subject, status, store_name, provider, sent_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [
        req.user.id,
        req.body.subject,
        req.body.status || 'Sent',
        req.body.storeName || null,
        req.body.provider || null
      ]
    );
    res.status(201).json({ log: rows[0] });
  })
);

module.exports = router;
