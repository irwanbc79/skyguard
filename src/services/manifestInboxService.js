const path = require("path");
const fs = require("fs");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const cron = require("node-cron");
const { ingestManifest } = require("./manifestIngestService");

function getInboxConfig() {
  return {
    enabled: process.env.MANIFEST_IMAP_ENABLED === "true",
    host: process.env.MANIFEST_IMAP_HOST,
    port: Number(process.env.MANIFEST_IMAP_PORT || 993),
    user: process.env.MANIFEST_IMAP_USER,
    pass: process.env.MANIFEST_IMAP_PASS,
    tls: process.env.MANIFEST_IMAP_TLS !== "false",
    mailbox: process.env.MANIFEST_IMAP_MAILBOX || "INBOX",
    subjectFilter: process.env.MANIFEST_IMAP_SUBJECT,
    fromFilter: process.env.MANIFEST_IMAP_FROM,
    cron: process.env.MANIFEST_IMAP_CRON || "*/5 * * * *",
  };
}

function attachmentAllowed(filename) {
  return /\.(txt|csv|xls|xlsx|doc|docx|pdf)$/i.test(filename || "");
}

async function processMessage(client, message) {
  const parsed = await simpleParser(message.source);
  const from = parsed.from?.text || "";
  const subject = parsed.subject || "";
  const attachments = parsed.attachments || [];
  if (attachments.length === 0) return;
  if (parsed.subject && process.env.MANIFEST_IMAP_SUBJECT) {
    const keywords = process.env.MANIFEST_IMAP_SUBJECT.toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const subj = parsed.subject.toLowerCase();
    if (keywords.length > 0 && !keywords.some((kw) => subj.includes(kw)))
      return;
  }
  if (parsed.from && process.env.MANIFEST_IMAP_FROM) {
    const domains = process.env.MANIFEST_IMAP_FROM.toLowerCase()
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const sender = parsed.from.text.toLowerCase();
    if (domains.length > 0 && !domains.some((d) => sender.includes(d))) return;
  }

  for (const attachment of attachments) {
    if (!attachmentAllowed(attachment.filename)) continue;
    const buffer = attachment.content;
    console.log(
      `[Manifest Inbox] Ingesting: ${attachment.filename} from "${from}" subj: "${subject}"`,
    );
    await ingestManifest({
      buffer,
      filename: attachment.filename || `manifest_${Date.now()}.txt`,
      source: "email",
      uploadedBy: "email",
      sender: from,
      emailSubject: subject,
    });
  }
}

const MAX_BATCH = Number(process.env.MANIFEST_IMAP_BATCH || 30);
const LOOKBACK_DAYS = Number(process.env.MANIFEST_IMAP_DAYS || 7);

async function pollInbox() {
  const config = getInboxConfig();
  if (!config.enabled) return;
  if (!config.host || !config.user || !config.pass) {
    console.warn("[Manifest Inbox] Missing IMAP credentials.");
    return;
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen(config.mailbox);

    // Only search unseen emails from last N days
    const since = new Date();
    since.setDate(since.getDate() - LOOKBACK_DAYS);
    const unseen = await client.search({ seen: false, since });
    if (!unseen.length) {
      console.log("[Manifest Inbox] No new emails.");
      return;
    }
    // Limit batch size to avoid memory/timeout issues
    const batch = unseen.slice(-MAX_BATCH);
    console.log(
      `[Manifest Inbox] Found ${unseen.length} unseen (last ${LOOKBACK_DAYS}d), processing ${batch.length}.`,
    );

    let processed = 0;
    let ingested = 0;
    const processedUids = [];
    for await (const message of client.fetch(batch, {
      source: true,
      uid: true,
    })) {
      try {
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.text || "";
        const subject = parsed.subject || "";
        const attachments = parsed.attachments || [];

        if (attachments.length > 0) {
          let matchSubject = true;
          let matchFrom = true;

          if (parsed.subject && process.env.MANIFEST_IMAP_SUBJECT) {
            const keywords = process.env.MANIFEST_IMAP_SUBJECT.toLowerCase()
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const subj = parsed.subject.toLowerCase();
            matchSubject =
              keywords.length === 0 || keywords.some((kw) => subj.includes(kw));
          }
          if (parsed.from && process.env.MANIFEST_IMAP_FROM) {
            const domains = process.env.MANIFEST_IMAP_FROM.toLowerCase()
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            const sender = parsed.from.text.toLowerCase();
            matchFrom =
              domains.length === 0 || domains.some((d) => sender.includes(d));
          }

          if (matchSubject && matchFrom) {
            for (const attachment of attachments) {
              if (!attachmentAllowed(attachment.filename)) continue;
              console.log(
                `[Manifest Inbox] Ingesting: ${attachment.filename} from "${from}" subj: "${subject}"`,
              );
              await ingestManifest({
                buffer: attachment.content,
                filename: attachment.filename || `manifest_${Date.now()}.txt`,
                source: "email",
                uploadedBy: "email",
                sender: from,
                emailSubject: subject,
              });
              ingested++;
            }
          }
        }
        // Collect UID for marking as seen after fetch loop
        processedUids.push(message.uid);
        processed++;
      } catch (msgErr) {
        console.error(
          `[Manifest Inbox] Error processing message:`,
          msgErr.message,
        );
      }
    }

    // Mark all processed messages as \Seen after fetch loop completes
    if (processedUids.length > 0) {
      try {
        await client.messageFlagsAdd(processedUids, ["\\Seen"], { uid: true });
        console.log(
          `[Manifest Inbox] Marked ${processedUids.length} messages as Seen.`,
        );
      } catch (flagErr) {
        console.error(
          `[Manifest Inbox] Failed to mark as Seen:`,
          flagErr.message,
        );
      }
    }

    console.log(
      `[Manifest Inbox] Done: ${processed} processed, ${ingested} attachments ingested.`,
    );
  } catch (error) {
    console.error("[Manifest Inbox] Error:", error.message);
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
  const storageDir = path.join(__dirname, "../../uploads/manifests");
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }
  console.log(`[Manifest Inbox] Scheduler initialized (${config.cron}).`);
  console.log(`[Manifest Inbox] User: ${config.user}`);
  console.log(
    `[Manifest Inbox] Subject keywords: ${config.subjectFilter || "ALL"}`,
  );
  console.log(`[Manifest Inbox] From filter: ${config.fromFilter || "ALL"}`);
}

module.exports = {
  initManifestInbox,
};
