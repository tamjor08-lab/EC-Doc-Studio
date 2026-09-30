# EC Doc Studio

**Convert • Edit • Read • Prepare**

EC Doc Studio is a browser-based document workspace by **Elemental Cre8tions**.

## Working in this build

### EPUB Converter & Reader
- Import `.docx` files
- Convert Word content to HTML with heading recognition
- Split chapters at Heading 1 or Heading 1 + Heading 2
- Preserve supported embedded images
- Optional PNG/JPEG cover
- Typography and paragraph controls
- EPUB 3 output with navigation plus legacy NCX navigation
- Open existing EPUB files in the reader
- Persistent side contents panel
- Previous/next chapter navigation
- Reader text-size and light/dark controls

### PDF Workshop
- Open a PDF
- Merge multiple PDFs
- Extract selected pages
- Rotate selected pages
- Delete selected pages
- Reorder pages
- Add simple text annotations by page/X/Y position
- Download the edited PDF

### Lightweight converter
- HTML/text to TXT
- Text/HTML to a downloadable HTML document

## Not yet implemented

Reliable layout-preserving PDF → DOCX and DOCX → PDF conversion are not presented as working features in this browser build. Print/hardbound preparation is reserved for later development.

## Project structure

```text
EC_Doc_Studio/
├── index.html
├── README.md
├── .gitignore
├── css/
│   └── styles.css
└── js/
    ├── app.js
    ├── epub.js
    ├── pdf.js
    └── converter.js
```

## External browser libraries

The app loads Mammoth.js, JSZip, and pdf-lib from jsDelivr. The browser therefore needs internet access when the app first loads these libraries.

## Deployment

The project is static-site compatible and can be hosted on GitHub Pages or Azure Static Web Apps. Files being edited are processed in the browser by the working tools in this build.
