const sgMail = require('@sendgrid/mail');
const db = require('../db');
const { delay } = require('../utils/delay');
const { getSettings } = require('./settings.service');

// Replaces all known placeholder formats with actual values
const personalize = (text, data = {}) => {
  let out = String(text || '');
  const sn = data.storeName || data.store_name || data.domain || data.name || '';
  const score = data.mobileScore == null ? '' : String(data.mobileScore);

  // {{variable}} and {variable} formats
  out = out.replace(/\{\{?\s*name\s*\}?\}/gi, data.name || sn);
  out = out.replace(/\{\{?\s*first_name\s*\}?\}/gi, (data.name || sn).split(' ')[0]);
  out = out.replace(/\{\{?\s*store[_\s]?name\s*\}?\}/gi, sn);
  out = out.replace(/\{\{?\s*domain\s*\}?\}/gi, data.domain || sn);
  out = out.replace(/\{\{?\s*email\s*\}?\}/gi, data.email || '');
  out = out.replace(/\{\{?\s*website\s*\}?\}/gi, data.website || '');
  out = out.replace(/\{\{?\s*phone\s*\}?\}/gi, data.phone || '');
  out = out.replace(/\{\{?\s*mobile[_\s]?score\s*\}?\}/gi, score);
  out = out.replace(/\{\{?\s*pagespeed[_\s]?score\s*\}?\}/gi, score);

  // [store name], [storeName] formats (AI-generated templates)
  out = out.replace(/\[store\s*name\]/gi, sn);
  out = out.replace(/\[storeName\]/gi, sn);
  out = out.replace(/\[mobile\s*score\]/gi, score);
  out = out.replace(/\[mobileScore\]/gi, score);

  return out;
};

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

const sendOne = async ({ userId, to, subject, body, storeId, contactId, campaignId, storeName, data = {} }) => {
  const { from, fromName, templateId } = await getSendgridConfig(userId);

  // Merge storeName into data so personalize() works for all formats
  const mergedData = {
    storeName,
    name: storeName,
    domain: storeName,
    ...data
  };

  // Personalize subject and body regardless of sending mode
  const personalizedSubject = personalize(subject, mergedData);
  const personalizedBody = personalize(body, mergedData);

  let message;

  if (templateId) {
    // SendGrid dynamic template — pass personalized content as template variables.
    // subject must also be set at top level for deliverability even when template
    // has its own subject field, because some ESPs require it.
    message = {
      to,
      from: { email: from, name: fromName },
      subject: personalizedSubject, // top-level subject (required by some clients)
      templateId,
      dynamicTemplateData: {
        subject: personalizedSubject, // maps to {{subject}} in your template
        message: personalizedBody     // maps to {{message}} in your template
      }
    };
  } else {
    message = {
      to,
      from: { email: from, name: fromName },
      subject: personalizedSubject,
      text: personalizedBody.replace(/<[^>]*>/g, ''),
      html: personalizedBody
    };
  }

  try {
    await sgMail.send(message);

    return logEmail({
      userId,
      storeId,
      contactId,
      campaignId,
      subject: personalizedSubject,
      body: personalizedBody,
      status: 'sent',
      sentAt: new Date(),
      storeName,
      toEmail: to
    });

  } catch (error) {
    const errMsg = error?.response?.body?.errors?.[0]?.message || error.message;

    try {
      await logEmail({
        userId,
        storeId,
        contactId,
        campaignId,
        subject: personalizedSubject,
        body: personalizedBody,
        status: `failed: ${errMsg}`,
        storeName,
        toEmail: to
      });
    } catch (logError) {
      console.error('Failed to log email failure:', logError);
    }

    throw new Error(errMsg);
  }
};

const sendBulk = async ({ userId, contacts, subject, body, delayMs = 500, campaignId }) => {
  const results = [];

  for (let index = 0; index < contacts.length; index += 1) {
    const contact = contacts[index];

    const data = {
      name: contact.name || contact.store_name,
      storeName: contact.store_name,
      email: contact.email,
      website: contact.website,
      phone: contact.phone,
      domain: contact.domain,
      mobileScore: contact.mobile_score
    };

    try {
      const log = await sendOne({
        userId,
        to: contact.email,
        subject,
        body,
        storeId: contact.store_id,
        contactId: contact.id,
        campaignId,
        storeName: contact.store_name,
        data
      });

      results.push({ contactId: contact.id, status: 'sent', log });

    } catch (error) {
      results.push({ contactId: contact.id, status: 'failed', message: error.message });
    }

    if (index < contacts.length - 1) {
      await delay(Number(delayMs) || 500);
    }
  }

  return results;
};

module.exports = { personalize, sendOne, sendBulk };
