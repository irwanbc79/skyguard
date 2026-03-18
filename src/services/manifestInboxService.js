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

let pollingLock = false;

async function pollInbox({ force = false, daysBack, subjectKeyword } = {}) {
  if (pollingLock) {
    console.log("[Manifest Inbox] Skipping poll – previous run still in progress.");
    return { processed: 0, ingested: 0, skipped: 0, message: "Poll already in progress" };
  }
  const config = getInboxConfig();
  if (!force && !config.enabled) return { processed: 0, ingested: 0, skipped: 0, message: "IMAP disabled" };
  if (!config.host || !config.user || !config.pass) {
    console.warn("[Manifest Inbox] Missing IMAP credentials.");
    return { processed: 0, ingested: 0, skipped: 0, message: "Missing IMAP credentials" };
  }

  pollingLock = true;
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

    const lookback = daysBack || LOOKBACK_DAYS;
    const since = new Date();
    since.setDate(since.getDate() - lookback);

    let searchCriteria;
    if (force) {
      searchCriteria = { since };
    } else {
      searchCriteria = { seen: false, since };
    }

    const results = await client.search(searchCriteria);
    if (!results.length) {
      console.log("[Manifest Inbox] No emails found.");
      return { processed: 0, ingested: 0, skipped: 0, message: "No emails found" };
    }

    const batch = results.slice(-MAX_BATCH);
    console.log(
      `[Manifest Inbox] Found ${results.length} emails (last ${lookback}d, force=${force}), processing ${batch.length}.`,
    );

    let processed = 0;
    let ingested = 0;
    let skipped = 0;
    const processedUids = [];
    const details = [];

    for await (const message of client.fetch(batch, {
      source: true,
      uid: true,
    })) {
      try {
        const parsed = await simpleParser(message.source);
        const from = parsed.from?.text || "";
        const subject = parsed.subject || "";
        const attachments = parsed.attachments || [];

        if (attachments.length === 0) {
          skipped++;
          continue;
        }

        let matchSubject = true;
        let matchFrom = true;

        if (!force) {
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
        }

        if (subjectKeyword) {
          const kw = subjectKeyword.toLowerCase();
          matchSubject = (parsed.subject || "").toLowerCase().includes(kw);
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
          details.push({ subject, from, attachments: attachments.length, status: "ingested" });
        } else {
          skipped++;
          details.push({ subject, from, attachments: attachments.length, status: "filtered_out" });
        }

        processedUids.push(message.uid);
        processed++;
      } catch (msgErr) {
        console.error(
          `[Manifest Inbox] Error processing message:`,
          msgErr.message,
        );
        details.push({ error: msgErr.message, status: "error" });
      }
    }

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
      `[Manifest Inbox] Done: ${processed} processed, ${ingested} ingested, ${skipped} skipped.`,
    );
    return { processed, ingested, skipped, details };
  } catch (error) {
    console.error("[Manifest Inbox] Error:", error.message);
    return { processed: 0, ingested: 0, skipped: 0, error: error.message };
  } finally {
    pollingLock = false;
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

async function peekInbox({ limit = 20, daysBack = 14 } = {}) {
  const config = getInboxConfig();
  if (!config.host || !config.user || !config.pass) {
    return { error: "IMAP credentials not configured" };
  }

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen(config.mailbox);

    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    const all = await client.search({ since });
    const batch = all.slice(-limit);

    const messages = [];
    for await (const msg of client.fetch(batch, { source: true, uid: true, flags: true })) {
      const parsed = await simpleParser(msg.source);
      const attachments = (parsed.attachments || []).map((a) => ({
        filename: a.filename,
        size: a.size,
        contentType: a.contentType,
      }));
      messages.push({
        uid: msg.uid,
        flags: msg.flags ? [...msg.flags] : [],
        from: parsed.from?.text || "",
        subject: parsed.subject || "",
        date: parsed.date || null,
        attachments,
        hasManifest: attachments.some((a) => attachmentAllowed(a.filename)),
      });
    }

    messages.sort((a, b) => (b.date || 0) - (a.date || 0));

    return {
      account: config.user,
      mailbox: config.mailbox,
      subjectFilter: config.subjectFilter || "ALL",
      fromFilter: config.fromFilter || "ALL",
      total: all.length,
      scanned: messages.length,
      messages,
    };
  } catch (error) {
    return { error: error.message };
  } finally {
    await client.logout().catch(() => {});
  }
}

module.exports = {
  initManifestInbox,
  pollInbox,
  peekInbox,
  getInboxConfig,
};
