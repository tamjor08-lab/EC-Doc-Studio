# EC Doc Studio v3

A browser-based document workspace by Elemental Cre8tions.

## v3 changes
- Removed the separate Convert tab; export/conversion now lives inside the relevant workspace.
- EPUB: DOCX import, fixed left-side chapter navigation, chapter read/edit mode, EPUB export, EPUB reader, text size and dark reader.
- PDF: actual in-app PDF page rendering with scrolling and zoom, page rotation/deletion, click-to-place text annotations, edited PDF save, and PDF text export to DOCX.
- Print / Hardbound remains a future workspace.

## Important PDF → DOCX note
The browser export reconstructs readable text in a DOCX. PDFs store page-positioned content rather than Word-style flowing document structure, so complex layouts, fonts, columns, images, and tables may not reproduce exactly.

## Hosting
Static files work on GitHub Pages. CDN access is required for Mammoth, JSZip, PDF.js, and pdf-lib.
