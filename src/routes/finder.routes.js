const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { findEmailForDomain } = require('../services/finder.service');
const { getApiKey } = require('../services/settings.service');
const { normalizeUrl } = require('../utils/url');

const router = express.Router();
router.use(requireAuth);

const updateOrCreateStore = async (userId, domain, result) => {
  const url = normalizeUrl(domain);
  const existing = await db.query(
    'SELECT * FROM stores WHERE user_id = $1 AND url = $2 ORDER BY created_at DESC LIMIT 1',
    [userId, url]
  );

  if (existing.rows[0]) {
    const { rows } = await db.query(
      `UPDATE stores SET contact_email = $1, email_source = $2, email_status = $3, flagged = $4
       WHERE id = $5 AND user_id = $6
       RETURNING *`,
      [result.email, result.source, result.status, result.flagged, existing.rows[0].id, userId]
    );
    return rows[0];
  }

  const { rows } = await db.query(
    `INSERT INTO stores (user_id, url, contact_email, email_source, email_status, flagged)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, url, result.email, result.source, result.status, result.flagged]
  );
  return rows[0];
};

router.post('/find',
  body('domain').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const hunterApiKey = await getApiKey(req.user.id, 'hunter_api_key', 'HUNTER_API_KEY');
    const result = await findEmailForDomain(req.body.domain, hunterApiKey);
    const store = await updateOrCreateStore(req.user.id, req.body.domain, result);
    res.json({ store });
  })
);

router.post('/bulk',
  body('domains').isArray({ min: 1 }),
  body('domains.*').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const hunterApiKey = await getApiKey(req.user.id, 'hunter_api_key', 'HUNTER_API_KEY');
    const results = [];
    for (const domain of req.body.domains) {
      const result = await findEmailForDomain(domain, hunterApiKey);
      const store = await updateOrCreateStore(req.user.id, domain, result);
      results.push(store);
    }
    res.json({ stores: results });
  })
);

router.put('/:id/manual',
  param('id').isUUID(),
  body('email').isEmail().normalizeEmail(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE stores SET contact_email = $1, email_source = 'Manual', email_status = 'Found', flagged = false
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [req.body.email, req.params.id, req.user.id]
    );
    res.json({ store: rows[0] || null });
  })
);

module.exports = router;
