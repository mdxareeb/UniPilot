/** Sanitized copy shared by the mobile File Tools routes. */
export const MOBILE_TOOL_COPY = {
  GENERIC: "Something went wrong. Please try again.",
  INVALID_DOCUMENT: "That document is not available.",
  INVALID_RESERVE:
    "Choose a PDF, DOCX, PNG or JPEG with a valid name and size.",
  TOO_LARGE: "That file is larger than the 25 MB upload limit.",
  QUOTA: "You've reached the document limit for this account. Remove a file and try again.",
  SUBJECT_NOT_FOUND: "That course no longer exists.",
  INVALID_FINALIZE: "That upload couldn't be verified. Try again.",
  INVALID_MODE: "Choose a valid processing mode.",
  INVALID_PAGES: "Add at least one page image or a PDF to read.",
  OCR_TOO_MANY_PAGES: "OCR accepts up to 20 pages at a time.",
  OCR_TOO_LARGE: "Those page images are too large. Try a smaller set.",
  OCR_INVALID_TYPE: "OCR accepts JPEG/PNG page images or a PDF.",
  OCR_FAILED: "We couldn't make this PDF searchable. Try again.",
  CONVERT_UNSUPPORTED:
    "Choose a PDF, DOCX, PPTX, TXT, MD, CSV or JSON file.",
  CONVERT_TOO_LARGE: "That file is larger than the 10 MB conversion limit.",
  CONVERT_FAILED: "We couldn't convert that file. Try again.",
  CONVERT_EMPTY: "That file has no readable text to convert.",
  PDF_BINARY_FAILED: "The PDF couldn't be generated. Try again.",
} as const;

export const RESERVE_STATUS = {
  UPLOADED: "uploaded",
} as const;
