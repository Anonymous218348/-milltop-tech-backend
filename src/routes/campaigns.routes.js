const express = require('express');
const { body, param } = require('express-validator');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const { validate } = require('../utils/validation');
const { getGmailAccounts } = require('../services/settings.service');
const { sendBulk } = require('../services/email.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.*, COALESCE(json_agg(cc.contact_id) FILTER (WHERE cc.contact_id IS NOT NULL), '[]') AS contact_ids
     FROM campaigns c
     LEFT JOIN campaign_contacts cc ON cc.campaign_id = c.id
     WHERE c.user_id = $1
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json({ campaigns: rows });
}));

router.post('/',
  body('name').notEmpty(),
  body('templateId').optional({ nullable: true }).isUUID(),
  body('contactIds').optional().isArray(),
  validate,
  asyncHandler(async (req, res) => {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      const campaignResult = await client.query(
        `INSERT INTO campaigns (user_id, name, template_id, status, scheduled_at)
         VALUES ($1,$2,$3,COALESCE($4,'draft'),$5) RETURNING *`,
        [req.user.id, req.body.name, req.body.templateId || null, req.body.status || null, req.body.scheduledAt || null]
      );
      for (const contactId of req.body.contactIds || []) {
        await client.query(
          `INSERT INTO campaign_contacts (campaign_id, contact_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [campaignResult.rows[0].id, contactId]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ campaign: campaignResult.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  })
);

router.put('/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    const current = await db.query('SELECT * FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    const campaign = { ...current.rows[0], ...req.body };
    const { rows } = await db.query(
      `UPDATE campaigns SET name=$1, template_id=$2, status=$3, scheduled_at=$4
       WHERE id=$5 AND user_id=$6 RETURNING *`,
      [
        campaign.name,
        campaign.templateId || campaign.template_id || null,
        campaign.status || 'draft',
        campaign.scheduledAt || campaign.scheduled_at || null,
        req.params.id,
        req.user.id
      ]
    );
    res.json({ campaign: rows[0] || null });
  })
);

router.delete('/:id',
  param('id').isUUID(),
  validate,
  asyncHandler(async (req, res) => {
    await db.query('DELETE FROM campaigns WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.status(204).send();
  })
);

router.post('/:id/send',
  param('id').isUUID(),
  body('delayMs').optional().isInt({ min: 0 }),
  validate,
  asyncHandler(async (req, res) => {
    const campaignResult = await db.query(
      `SELECT c.*, t.subject, t.body
       FROM campaigns c
       JOIN templates t ON t.id = c.template_id
       WHERE c.id=$1 AND c.user_id=$2`,
      [req.params.id, req.user.id]
    );
    const campaign = campaignResult.rows[0];
    const contactsResult = await db.query(
      `SELECT contacts.*, stores.url AS store_name, stores.mobile_performance AS mobile_score
       FROM campaign_contacts
       JOIN contacts ON contacts.id = campaign_contacts.contact_id
       LEFT JOIN stores ON stores.id = contacts.store_id
       WHERE campaign_contacts.campaign_id=$1 AND contacts.user_id=$2`,
      [req.params.id, req.user.id]
    );
    const accounts = await getGmailAccounts(req.user.id);
    const results = await sendBulk({
      userId: req.user.id,
      accounts,
      contacts: contactsResult.rows,
      subject: campaign.subject,
      body: campaign.body,
      delayMs: req.body.delayMs || 1000,
      campaignId: campaign.id
    });
    await db.query('UPDATE campaigns SET status=$1 WHERE id=$2 AND user_id=$3', ['sent', campaign.id, req.user.id]);
    res.json({ results });
  })
);

module.exports = router;
