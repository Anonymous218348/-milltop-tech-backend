const nodemailer = require('nodemailer');
const db = require('../db');
const { delay } = require('../utils/delay');

const personalize = (text, data) => String(text || '')
  .replace(/\{\{\s*name\s*\}\}/gi, data.name || '')
  .replace(/\{\{\s*store_name\s*\}\}/gi, data.storeName || data.domain || '')
  .replace(/\{\{\s*domain\s*\}\}/gi, data.domain || '')
  .replace(/\{\{\s*mobile_score\s*\}\}/gi, data.mobileScore == null ? '' : String(data.mobileScore))
  .replace(/\{\{\s*pagespeed_score\s*\}\}/gi, data.mobileScore == null ? '' : String(data.mobileScore));

const createTransport = (account) => {
  if (!account || !account.user || !account.pass) {
    throw new Error('A Gmail account with user and app password is required');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: account.email,
      pass: account.pass
    }
  });
};

const logEmail = async ({ userId, storeId, contactId, campaignId, subject, body, status, sentAt }) => {
  const { rows } = await db.query(
    `INSERT INTO email_logs (user_id, store_id, contact_id, campaign_id, subject, body, status, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, storeId || null, contactId || null, campaignId || null, subject, body, status, sentAt || null]
  );
  return rows[0];
};

const sendOne = async ({ userId, account, to, subject, body, storeId, contactId, campaignId }) => {
  const transporter = createTransport(account);
  try {
    await transporter.sendMail({
      from: account.from || account.email,
      to,
      subject,
      text: body,
      html: body.replace(/\n/g, '<br>')
    });

    return logEmail({
      userId,
      storeId,
      contactId,
      campaignId,
      subject,
      body,
      status: 'sent',
      sentAt: new Date()
    });
  } catch (error) {
    await logEmail({ userId, storeId, contactId, campaignId, subject, body, status: `failed: ${error.message}` });
    throw error;
  }
};

const sendBulk = async ({ userId, accounts, contacts, subject, body, delayMs = 1000, campaignId }) => {
  if (!accounts.length) {
    throw new Error('At least one Gmail account is required');
  }

  const results = [];
  for (let index = 0; index < contacts.length; index += 1) {
    const contact = contacts[index];
    const account = accounts[index % Math.min(accounts.length, 5)];
    const data = {
      name: contact.name,
      domain: contact.domain,
      storeName: contact.store_name,
      mobileScore: contact.mobile_score
    };
    const personalizedSubject = personalize(subject, data);
    const personalizedBody = personalize(body, data);

    try {
      const log = await sendOne({
        userId,
        account,
        to: contact.email,
        subject: personalizedSubject,
        body: personalizedBody,
        storeId: contact.store_id,
        contactId: contact.id,
        campaignId
      });
      results.push({ contactId: contact.id, status: 'sent', log });
    } catch (error) {
      results.push({ contactId: contact.id, status: 'failed', message: error.message });
    }

    if (index < contacts.length - 1) {
      await delay(Number(delayMs) || 1000);
    }
  }

  return results;
};

module.exports = { personalize, sendOne, sendBulk };
