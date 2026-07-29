const sgMail = require('@sendgrid/mail');
const db = require('../db');
const { delay } = require('../utils/delay');
const { getSettings } = require('./settings.service');

const personalize = (text, data = {}) => String(text || '')
  .replace(/\{\{\s*name\s*\}\}/gi, data.name || '')
  .replace(/\{\{\s*first_name\s*\}\}/gi, data.name ? data.name.split(' ')[0] : '')
  .replace(/\{\{\s*store_name\s*\}\}/gi, data.storeName || data.domain || '')
  .replace(/\{\{\s*domain\s*\}\}/gi, data.domain || '')
  .replace(/\{\{\s*email\s*\}\}/gi, data.email || '')
  .replace(/\{\{\s*website\s*\}\}/gi, data.website || '')
  .replace(/\{\{\s*phone\s*\}\}/gi, data.phone || '')
  .replace(/\{\{\s*mobile_score\s*\}\}/gi, data.mobileScore == null ? '' : String(data.mobileScore))
  .replace(/\{\{\s*pagespeed_score\s*\}\}/gi, data.mobileScore == null ? '' : String(data.mobileScore));


const getSendgridConfig = async (userId) => {
  const settings = await getSettings(userId);

  if (!settings || !settings.sendgrid_api_key) {
    throw new Error('SendGrid API key is required in Settings');
  }

  if (!settings.sendgrid_from) {
    throw new Error('A verified sender email (sendgrid_from) is required in Settings');
  }

  sgMail.setApiKey(settings.sendgrid_api_key);

  return {
    from: settings.sendgrid_from,
    fromName: settings.sendgrid_name || 'Milltop Tech',
    templateId: settings.sendgrid_template_id || null
  };
};


const logEmail = async ({ userId, storeId, contactId, campaignId, subject, body, status, sentAt, storeName, toEmail }) => {
  const { rows } = await db.query(
    `INSERT INTO email_logs 
    (user_id, store_id, contact_id, campaign_id, subject, body, status, sent_at, store_name, to_email)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *`,
    [
      userId,
      storeId || null,
      contactId || null,
      campaignId || null,
      subject,
      body,
      status,
      sentAt || null,
      storeName || null,
      toEmail || null
    ]
  );

  return rows[0];
};


const sendOne = async ({ userId, to, subject, body, storeId, contactId, campaignId, storeName }) => {
  const { from, fromName, templateId } = await getSendgridConfig(userId);

  // Build the message — use SendGrid template if a template ID is saved
  // in settings, otherwise fall back to raw HTML (existing behaviour).
  let message;

  if (templateId) {
    message = {
      to,
      from: { email: from, name: fromName },
      templateId,
      dynamicTemplateData: {
        subject,
        message: body // maps to {{message}} in your SendGrid template
      }
    };
  } else {
    message = {
      to,
      from: { email: from, name: fromName },
      subject,
      text: body.replace(/<[^>]*>/g, ''),
      html: body
    };
  }

  try {
    await sgMail.send(message);

    return logEmail({
      userId,
      storeId,
      contactId,
      campaignId,
      subject,
      body,
      status: 'sent',
      sentAt: new Date(),
      storeName,
      toEmail: to
    });

  } catch (error) {
    const message = error?.response?.body?.errors?.[0]?.message || error.message;

    try {
      await logEmail({
        userId,
        storeId,
        contactId,
        campaignId,
        subject,
        body,
        status: `failed: ${message}`,
        storeName,
        toEmail: to
      });
    } catch (logError) {
      console.error('Failed to log email failure:', logError);
    }

    throw new Error(message);
  }
};


const sendBulk = async ({ userId, contacts, subject, body, delayMs = 500, campaignId }) => {
  const results = [];

  for (let index = 0; index < contacts.length; index += 1) {

    const contact = contacts[index];

    const data = {
      name: contact.name,
      email: contact.email,
      website: contact.website,
      phone: contact.phone,
      domain: contact.domain,
      storeName: contact.store_name,
      mobileScore: contact.mobile_score
    };

    const personalizedSubject = personalize(subject, data);
    const personalizedBody = personalize(body, data);

    try {
      const log = await sendOne({
        userId,
        to: contact.email,
        subject: personalizedSubject,
        body: personalizedBody,
        storeId: contact.store_id,
        contactId: contact.id,
        campaignId,
        storeName: contact.store_name
      });

      results.push({
        contactId: contact.id,
        status: 'sent',
        log
      });

    } catch (error) {
      results.push({
        contactId: contact.id,
        status: 'failed',
        message: error.message
      });
    }

    if (index < contacts.length - 1) {
      await delay(Number(delayMs) || 500);
    }
  }

  return results;
};


module.exports = {
  personalize,
  sendOne,
  sendBulk
};
