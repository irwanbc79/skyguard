const path = require('path');
const fs = require('fs');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const cron = require('node-cron');
const { ingestManifest } = require('./manifestIngestService');

function getInboxConfig() {
  return {
    enabled: process.env.MANIFEST_IMAP_ENABLED === 'true',
    host: process.env.MANIFEST_IMAP_HOST,
    port: Number(process.env.MANIFEST_IMAP_PORT || 993),
    user: process.env.MANIFEST_IMAP_USER,
    pass: process.env.MANIFEST_IMAP_PASS,
    tls: process.env.MANIFEST_IMAP_TLS !== 'false',
    mailbox: process.env.MANIFEST_IMAP_MAILBOX || 'INBOX',
    subjectFilter: process.env.MANIFEST_IMAP_SUBJECT,
    fromFilter: process.env.MANIFEST_IMAP_FROM,
    cron: process.env.MANIFEST_IMAP_CRON || '*/5 * * * *'
  };
}

function attachmentAllowed(filename) {
  return /\.(txt|csv|xls|xlsx|doc|docx|pdf)$/i.test(filename || '');
}

async function processMessage(client, message) {
  const parsed = await simpleParser(message.source);
  const from = parsed.from?.text || '';
  const subject = parsed.subject || '';
  const attachments = parsed.attachments || [];
  if (attachments.length === 0) return;
  if (parsed.subject && process.env.MANIFEST_IMAP_SUBJECT) {
    const subjectFilter = process.env.MANIFEST_IMAP_SUBJECT.toLowerCase();
    if (!parsed.subject.toLowerCase().includes(subjectFilter)) return;
  }
  if (parsed.from && process.env.MANIFEST_IMAP_FROM) {
    const fromFilter = process.env.MANIFEST_IMAP_FROM.toLowerCase();
    if (!parsed.from.text.toLowerCase().includes(fromFilter)) return;
  }

  for (const attachment of attachments) {
    if (!attachmentAllowed(attachment.filename)) continue;
    const buffer = attachment.content;
    await ingestManifest({
      buffer,
      filename: attachment.filename || `manifest_${Date.now()}.txt`,
      source: 'email',
      uploadedBy: 'email',
      sender: from,
      emailSubject: subject
    });
  }
}

async function pollInbox() {
  const config = getInboxConfig();
  if (!config.enabled) return;
  if (!config.host || !config.user || !config.pass) {
    console.warn('[Manifest Inbox] Missing IMAP credentials.');
    return;
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: {
      user: config.user,
      pass: config.pass
    }
  });

  try {
    await client.connect();
    await client.mailboxOpen(config.mailbox);
    const unseen = await client.search({ seen: false });
    if (!unseen.length) return;

    for await (const message of client.fetch(unseen, { source: true })) {
      await processMessage(client, message);
      await client.messageFlagsAdd(message.seq, ['\\Seen']);
    }
  } catch (error) {
    console.error('[Manifest Inbox] Error:', error.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

function initManifestInbox() {
  const config = getInboxConfig();
  if (!config.enabled) {
    return;
  }
  cron.schedule(config.cron, () => {
    pollInbox();
  });
  pollInbox();
  const storageDir = path.join(__dirname, '../../uploads/manifests');
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  console.log('[Manifest Inbox] Scheduler initialized.');
}

module.exports = {
  initManifestInbox
};
