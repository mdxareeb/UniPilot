import { PDFDocument } from "pdf-lib";

import { bytesToBase64 } from "./fileBytes";

export type BuiltPdf = {
  bytes: Uint8Array;
  base64: string;
  pageCount: number;
};

const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];
const MARGIN = 24;

export type ImagePdfInput = {
  base64: string;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
};

/**
 * Assemble normalized images into one PDF. Each image gets an A4 page in its
 * natural orientation, fitted with a small margin and centred. The bytes are
 * kept twice: `bytes` uploads through Storage, `base64` writes the local file.
 */
export async function buildImagePdf(
  images: readonly ImagePdfInput[],
  title: string,
): Promise<BuiltPdf> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setProducer("UniPilot");
  pdf.setCreator("UniPilot Image to PDF");

  for (const image of images) {
    const embedded =
      image.mimeType === "image/png"
        ? await pdf.embedPng(image.base64)
        : await pdf.embedJpg(image.base64);
    const landscape = image.width > image.height;
    const [pageWidth, pageHeight] = landscape ? A4_LANDSCAPE : A4_PORTRAIT;
    const page = pdf.addPage([pageWidth, pageHeight]);
    const maxWidth = pageWidth - MARGIN * 2;
    const maxHeight = pageHeight - MARGIN * 2;
    const scale = Math.min(
      maxWidth / image.width,
      maxHeight / image.height,
      1,
    );
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(embedded, {
      x: (pageWidth - width) / 2,
      y: (pageHeight - height) / 2,
      width,
      height,
    });
  }

  const bytes = await pdf.save();
  return {
    bytes,
    base64: bytesToBase64(bytes),
    pageCount: pdf.getPageCount(),
  };
}

/** Merge existing PDFs in the order supplied. */
export async function mergePdfs(
  sources: readonly string[],
  title: string,
): Promise<BuiltPdf> {
  const output = await PDFDocument.create();
  output.setTitle(title);
  output.setProducer("UniPilot");
  output.setCreator("UniPilot PDF Utilities");

  for (const base64 of sources) {
    const source = await PDFDocument.load(base64, { updateMetadata: false });
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) output.addPage(page);
  }

  const bytes = await output.save();
  return {
    bytes,
    base64: bytesToBase64(bytes),
    pageCount: output.getPageCount(),
  };
}

/** Copy the selected 1-based pages, preserving the order typed. */
export async function extractPdfPages(
  base64: string,
  pages: readonly number[],
  title: string,
): Promise<BuiltPdf> {
  const source = await PDFDocument.load(base64, { updateMetadata: false });
  const count = source.getPageCount();
  if (
    pages.length === 0 ||
    pages.some((page) => !Number.isInteger(page) || page < 1 || page > count)
  ) {
    throw new Error("Choose pages within this PDF.");
  }

  const output = await PDFDocument.create();
  output.setTitle(title);
  output.setProducer("UniPilot");
  output.setCreator("UniPilot PDF Utilities");
  const copied = await output.copyPages(
    source,
    pages.map((page) => page - 1),
  );
  for (const page of copied) output.addPage(page);

  const bytes = await output.save();
  return {
    bytes,
    base64: bytesToBase64(bytes),
    pageCount: output.getPageCount(),
  };
}

export async function pdfPageCount(base64: string): Promise<number> {
  const pdf = await PDFDocument.load(base64, { updateMetadata: false });
  return pdf.getPageCount();
}
