const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT contacts.*,
      COALESCE(json_agg(email_logs ORDER BY email_logs.sent_at DESC) FILTER (WHERE email_logs.id IS NOT NULL), '[]') AS email_history
     FROM contacts
     LEFT JOIN email_logs ON email_logs.contact_id = contacts.id
     WHERE contacts.user_id=$1
     GROUP BY contacts.id
     ORDER BY contacts.created_at DESC`,
    [req.user.id]
  );
  res.json({ contacts: rows });
}));

router.put('/:id/stage',
  param('id').isUUID(),
  body('stage').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      'UPDATE contacts SET outreach_stage=$1 WHERE id=$2 AND user_id=$3 RETURNING *',
      [req.body.stage, req.params.id, req.user.id]
    );
    res.json({ contact: rows[0] || null });
  })
);

router.post('/:id/notes',
  param('id').isUUID(),
  body('note').notEmpty(),
  validate,
  asyncHandler(async (req, res) => {
    const { rows } = await db.query(
      `UPDATE contacts
       SET notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE E'\n' END, $1)
       WHERE id=$2 AND user_id=$3 RETURNING *`,
      [req.body.note, req.params.id, req.user.id]
    );
    res.json({ contact: rows[0] || null });
  })
);

module.exports = router;
