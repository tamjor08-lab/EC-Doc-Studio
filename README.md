# EC Doc Studio

**Convert • Edit • Read • Prepare**

EC Doc Studio is a document-production workspace by **Elemental Cre8tions**.

## What works in this build

- Designed multi-workspace interface
- HTML/TXT import
- Drag-and-drop HTML/TXT loading
- Content editing
- Reader preview
- Persistent side table of contents generated from H1/H2/H3 headings
- Save edited HTML
- HTML-to-TXT export

## Development modules included

The project is already separated into modules for EPUB, PDF and conversion work. The PDF/DOCX/true-EPUB functions are intentionally not presented as completed features.

Planned:
- DOCX → EPUB
- PDF → DOCX
- DOCX → PDF
- EPUB → PDF
- PDF merge/split/reorder/rotate/delete/annotation
- Print and hardbound preparation

Reliable office-document conversion will require appropriate processing libraries and/or backend services when the application is deployed.

## Project structure

```text
EC_Doc_Studio/
├── index.html
├── README.md
├── .gitignore
├── css/
│   └── styles.css
├── js/
│   ├── app.js
│   ├── epub.js
│   ├── pdf.js
│   └── converter.js
└── assets/
    └── images/
```

## Run locally

Open `index.html` in a modern browser.

## Deployment direction

Local development → GitHub → Azure → Elemental Cre8tions website integration.

## Status

Early prototype / active development.
