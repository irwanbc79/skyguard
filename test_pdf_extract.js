const fs = require("fs");
const path = require("path");

const MANIFEST_DIR = path.join(__dirname, "uploads/manifests");

async function main() {
  // Try to load pdf-parse
  let pdfParse;
  try {
    const mod = require("pdf-parse");
    pdfParse = typeof mod === "function" ? mod : mod.default || null;
    if (!pdfParse) {
      console.log(
        "pdf-parse loaded but not a function. Keys:",
        Object.keys(mod),
      );
      return;
    }
  } catch (e) {
    console.log("pdf-parse not available:", e.message);
    return;
  }

  // Find SQ/MH manifest PDFs
  const allFiles = fs.readdirSync(MANIFEST_DIR);
  const manifestPdfs = allFiles.filter((f) =>
    /MANIFEST.*(SQ|MH).*\.pdf$/i.test(f),
  );
  console.log("Found manifest PDFs:", manifestPdfs.length);
  manifestPdfs.forEach((f) => console.log(" -", f));

  // Also check needs-review type files
  const wniFiles = allFiles.filter((f) => /WNI.*\.pdf$/i.test(f));
  console.log("\nWNI PDFs:", wniFiles.length);
  wniFiles.forEach((f) => console.log(" -", f));

  // Extract text from first SQ manifest
  for (const group of [manifestPdfs, wniFiles]) {
    if (group.length === 0) continue;
    const fp = path.join(MANIFEST_DIR, group[0]);
    console.log("\n=== EXTRACTING:", group[0], "===");
    try {
      const buf = fs.readFileSync(fp);
      const data = await pdfParse(buf);
      console.log("TEXT LENGTH:", data.text.length);
      console.log("--- CONTENT (first 3000 chars) ---");
      console.log(data.text.substring(0, 3000));
      console.log("--- END ---");
    } catch (e) {
      console.log("PARSE ERROR:", e.message);
    }
  }
}

main().catch((e) => console.error(e));
