// js/pdf-import.js
// Extract plain text from an uploaded PDF using pdf.js loaded from CDN.
//
// We don't vendor pdf.js (would add ~1MB to the static bundle); jsDelivr's
// ESM build works in modern browsers and the cache lives in the user's
// browser after the first hit. The worker URL has to be set explicitly
// after the module loads.

const PDFJS_VERSION = "4.7.76";
const PDFJS_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.min.mjs`;
const PDFJS_WORKER_URL = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

let pdfjsPromise = null;

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    });
  }
  return pdfjsPromise;
}

// Extract text from each page and return as one string, with page breaks
// preserved as double newlines so downstream extraction can use position
// hints (table-of-contents style cues, page-anchored layer indexes, etc.).
export async function extractPdfText(file) {
  const pdfjs = await loadPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((it) => ("str" in it ? it.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    pages.push(text);
  }
  return {
    pageCount: pdf.numPages,
    text: pages.join("\n\n"),
  };
}
