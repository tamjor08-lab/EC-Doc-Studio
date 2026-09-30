import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const $ = selector => document.querySelector(selector);

let pdfBytes = null;
let pdfDocument = null;
let pdfFileName = 'document.pdf';
let scale = 1;
let editableBuilt = false;


/* ---------------------------------------------------------
   STATUS
--------------------------------------------------------- */

function status(message) {
  const box = $('#pdfStatus');

  if (box) {
    box.textContent = message;
  }
}


/* ---------------------------------------------------------
   LOAD PDF
--------------------------------------------------------- */

async function loadPdf(file) {
  if (!file) return;

  try {
    status('Opening PDF…');

    pdfFileName = file.name;

    pdfBytes = new Uint8Array(
      await file.arrayBuffer()
    );

    pdfDocument =
      await pdfjsLib.getDocument({
        data: pdfBytes.slice()
      }).promise;

    scale = 1;
    editableBuilt = false;

    $('#savePdf').disabled = false;
    $('#savePdfDocx').disabled = false;
    $('#editPdfDocument').disabled = false;

    $('#pdfViewTools').hidden = false;
    $('#pdfViewerMode').hidden = false;
    $('#pdfEditorMode').hidden = true;

    $('#zoomLabel').textContent = '100%';

    status(
      `Loaded ${file.name}: ${pdfDocument.numPages} page` +
      (pdfDocument.numPages === 1 ? '.' : 's.')
    );

    await renderPdf();
  }
  catch (error) {
    console.error('PDF load error:', error);

    status(
      'Could not open that PDF: ' +
      (error.message || String(error))
    );
  }
}


/* ---------------------------------------------------------
   RENDER ORIGINAL PDF
--------------------------------------------------------- */

async function renderPdf() {
  if (!pdfDocument) return;

  const viewer = $('#pdfViewer');

  viewer.innerHTML = '';

  for (
    let pageNumber = 1;
    pageNumber <= pdfDocument.numPages;
    pageNumber++
  ) {
    const page =
      await pdfDocument.getPage(pageNumber);

    const viewport =
      page.getViewport({
        scale: scale
      });

    const wrapper =
      document.createElement('div');

    wrapper.className = 'pdf-page-wrap';
    wrapper.dataset.page = pageNumber;

    const canvas =
      document.createElement('canvas');

    const context =
      canvas.getContext('2d');

    canvas.width =
      Math.floor(viewport.width);

    canvas.height =
      Math.floor(viewport.height);

    canvas.style.width =
      `${Math.floor(viewport.width)}px`;

    canvas.style.height =
      `${Math.floor(viewport.height)}px`;

    wrapper.appendChild(canvas);

    viewer.appendChild(wrapper);

    await page.render({
      canvasContext: context,
      viewport: viewport
    }).promise;
  }

  $('#zoomLabel').textContent =
    `${Math.round(scale * 100)}%`;
}


/* ---------------------------------------------------------
   TEXT HELPERS
--------------------------------------------------------- */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function median(values) {
  if (!values.length) return 12;

  const sorted =
    [...values].sort((a, b) => a - b);

  const middle =
    Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middle];
  }

  return (
    sorted[middle - 1] +
    sorted[middle]
  ) / 2;
}


/* ---------------------------------------------------------
   EXTRACT A PAGE INTO LINES
--------------------------------------------------------- */

async function extractPageLines(pageNumber) {
  const page =
    await pdfDocument.getPage(pageNumber);

  const content =
    await page.getTextContent();

  const items =
    content.items
      .filter(item => item.str && item.str.trim())
      .map(item => {
        const transform = item.transform || [];

        return {
          text: item.str,
          x: transform[4] || 0,
          y: transform[5] || 0,

          size:
            Math.abs(transform[3]) ||
            Math.abs(transform[0]) ||
            item.height ||
            12,

          width:
            item.width || 0
        };
      });

  if (!items.length) {
    return [];
  }

  const fontSizes =
    items
      .map(item => item.size)
      .filter(size => size > 0);

  const bodySize =
    median(fontSizes);

  const lines = [];

  const tolerance =
    Math.max(2, bodySize * 0.35);

  items
    .sort((a, b) => {
      if (
        Math.abs(b.y - a.y) >
        tolerance
      ) {
        return b.y - a.y;
      }

      return a.x - b.x;
    })
    .forEach(item => {
      let line =
        lines.find(existing =>
          Math.abs(
            existing.y -
            item.y
          ) <= tolerance
        );

      if (!line) {
        line = {
          y: item.y,
          items: []
        };

        lines.push(line);
      }

      line.items.push(item);
    });

  lines.sort(
    (a, b) => b.y - a.y
  );

  return lines.map(line => {
    line.items.sort(
      (a, b) => a.x - b.x
    );

    let text = '';

    let previous = null;

    line.items.forEach(item => {
      if (!previous) {
        text = item.text;
      }
      else {
        const previousEnd =
          previous.x +
          previous.width;

        const gap =
          item.x -
          previousEnd;

        if (
          gap >
          Math.max(
            1.5,
            previous.size * 0.12
          )
        ) {
          text += ' ';
        }

        text += item.text;
      }

      previous = item;
    });

    const sizes =
      line.items.map(
        item => item.size
      );

    return {
      text:
        text
          .replace(/\s+/g, ' ')
          .trim(),

      x:
        line.items.length
          ? line.items[0].x
          : 0,

      y:
        line.y,

      size:
        median(sizes),

      bodySize:
        bodySize
    };
  });
}


/* ---------------------------------------------------------
   CONVERT PDF LINES INTO EDITABLE DOCUMENT
--------------------------------------------------------- */

function linesToEditableHtml(
  lines,
  pageNumber
) {
  if (!lines.length) {
    return `
      <section class="editable-pdf-page">
        <div class="editable-page-number">
          Page ${pageNumber}
        </div>

        <p></p>
      </section>
    `;
  }

  const bodySize =
    median(
      lines.map(line => line.size)
    );

  const xs =
    lines
      .map(line => line.x)
      .filter(x => Number.isFinite(x));

  const leftEdge =
    xs.length
      ? Math.min(...xs)
      : 0;

  let html = '';

  let paragraph = [];

  let previousLine = null;


  function flushParagraph() {
    if (!paragraph.length) return;

    let text =
      paragraph
        .join(' ')
        .replace(
          /-\s+([a-z])/g,
          '$1'
        )
        .replace(
          /\s+/g,
          ' '
        )
        .trim();

    if (text) {
      html +=
        `<p>${escapeHtml(text)}</p>`;
    }

    paragraph = [];
  }


  lines.forEach((line, index) => {
    const text =
      line.text.trim();

    if (!text) {
      flushParagraph();
      previousLine = line;
      return;
    }

    const isLargeHeading =
      line.size >=
      bodySize * 1.45;

    const isMediumHeading =
      line.size >=
      bodySize * 1.18;

    const isShort =
      text.length < 100;

    const headingLike =
      isShort &&
      (
        isLargeHeading ||
        isMediumHeading
      );

    if (headingLike) {
      flushParagraph();

      if (isLargeHeading) {
        html +=
          `<h2>${escapeHtml(text)}</h2>`;
      }
      else {
        html +=
          `<h3>${escapeHtml(text)}</h3>`;
      }

      previousLine = line;
      return;
    }


    let newParagraph = false;

    if (previousLine) {
      const verticalGap =
        previousLine.y -
        line.y;

      const normalGap =
        Math.max(
          bodySize * 1.1,
          previousLine.size * 1.1
        );

      const indentation =
        line.x -
        leftEdge;

      if (
        verticalGap >
        normalGap * 1.55
      ) {
        newParagraph = true;
      }

      if (
        indentation >
        bodySize * 1.25 &&
        paragraph.length
      ) {
        newParagraph = true;
      }

      if (
        paragraph.length &&
        /[.!?:"”']$/.test(
          paragraph[
            paragraph.length - 1
          ]
        ) &&
        verticalGap >
        normalGap * 1.25
      ) {
        newParagraph = true;
      }
    }


    if (newParagraph) {
      flushParagraph();
    }


    if (
      paragraph.length &&
      paragraph[
        paragraph.length - 1
      ].endsWith('-')
    ) {
      const previous =
        paragraph.pop();

      paragraph.push(
        previous.slice(0, -1) +
        text
      );
    }
    else {
      paragraph.push(text);
    }

    previousLine = line;


    if (
      index ===
      lines.length - 1
    ) {
      flushParagraph();
    }
  });


  flushParagraph();


  return `
    <section
      class="editable-pdf-page"
      data-page="${pageNumber}"
    >
      <div
        class="editable-page-number"
        contenteditable="false"
      >
        Page ${pageNumber}
      </div>

      ${html}
    </section>
  `;
}


/* ---------------------------------------------------------
   BUILD EDITABLE DOCUMENT
--------------------------------------------------------- */

async function buildEditableDocument() {
  if (!pdfDocument) return;

  const editor =
    $('#pdfEditableDocument');

  editor.innerHTML =
    '<p class="muted">Preparing editable document…</p>';

  let documentHtml = '';

  for (
    let pageNumber = 1;
    pageNumber <= pdfDocument.numPages;
    pageNumber++
  ) {
    status(
      `Preparing editable document: page ${pageNumber} of ${pdfDocument.numPages}…`
    );

    const lines =
      await extractPageLines(
        pageNumber
      );

    documentHtml +=
      linesToEditableHtml(
        lines,
        pageNumber
      );
  }

  editor.innerHTML =
    documentHtml;

  editableBuilt = true;

  status(
    'Editing mode. Click directly in the document to type, select, Backspace or Delete.'
  );
}


/* ---------------------------------------------------------
   ENTER EDIT MODE
--------------------------------------------------------- */

async function enterEditMode() {
  if (!pdfDocument) return;

  $('#pdfViewerMode').hidden = true;
  $('#pdfEditorMode').hidden = false;

  if (!editableBuilt) {
    await buildEditableDocument();
  }

  $('#pdfEditableDocument').focus();
}


/* ---------------------------------------------------------
   RETURN TO ORIGINAL PDF
--------------------------------------------------------- */

function viewOriginal() {
  if (!pdfDocument) return;

  $('#pdfEditorMode').hidden = true;
  $('#pdfViewerMode').hidden = false;

  status(
    'Viewing original PDF. Your editable version is still preserved.'
  );
}


/* ---------------------------------------------------------
   SAVE ORIGINAL PDF
--------------------------------------------------------- */

function saveOriginalPdf() {
  if (!pdfBytes) return;

  const blob =
    new Blob(
      [pdfBytes],
      {
        type: 'application/pdf'
      }
    );

  window.saveBlob(
    blob,
    pdfFileName
  );

  status('PDF saved.');
}


/* ---------------------------------------------------------
   WORD XML HELPERS
--------------------------------------------------------- */

function wordEscape(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


function editableDocumentToWordXml() {
  const editor =
    $('#pdfEditableDocument');

  const blocks =
    editor.querySelectorAll(
      'h1,h2,h3,h4,p,li'
    );

  let xml = '';

  blocks.forEach(block => {
    if (
      block.classList.contains(
        'editable-page-number'
      )
    ) {
      return;
    }

    const text =
      block.innerText
        .replace(/\s+/g, ' ')
        .trim();

    if (!text) {
      xml += '<w:p/>';
      return;
    }

    let paragraphStyle = '';

    if (block.tagName === 'H1') {
      paragraphStyle =
        '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>';
    }

    if (block.tagName === 'H2') {
      paragraphStyle =
        '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>';
    }

    if (block.tagName === 'H3') {
      paragraphStyle =
        '<w:pPr><w:pStyle w:val="Heading3"/></w:pPr>';
    }

    xml +=
      '<w:p>' +
      paragraphStyle +
      '<w:r>' +
      '<w:t xml:space="preserve">' +
      wordEscape(text) +
      '</w:t>' +
      '</w:r>' +
      '</w:p>';
  });

  return xml;
}


/* ---------------------------------------------------------
   CREATE DOCX
--------------------------------------------------------- */

async function saveDocx() {
  if (!pdfDocument) return;

  try {
    if (!editableBuilt) {
      await buildEditableDocument();
    }

    status('Building DOCX…');

    const zip =
      new JSZip();

    const documentXml =
      editableDocumentToWordXml();


    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`
    );


    zip.file(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"
  />
</Relationships>`
    );


    zip.file(
      'word/_rels/document.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"
  />
</Relationships>`
    );


    zip.file(
      'word/styles.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">

  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="36"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
    </w:rPr>
  </w:style>

  <w:style w:type="paragraph" w:styleId="Heading3">
    <w:name w:val="heading 3"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
    </w:rPr>
  </w:style>

</w:styles>`
    );


    zip.file(
      'word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
>
  <w:body>

    ${documentXml}

    <w:sectPr>
      <w:pgSz
        w:w="12240"
        w:h="15840"
      />
      <w:pgMar
        w:top="1080"
        w:right="1080"
        w:bottom="1080"
        w:left="1080"
      />
    </w:sectPr>

  </w:body>
</w:document>`
    );


    const blob =
      await zip.generateAsync({
        type: 'blob',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });


    const baseName =
      pdfFileName
        .replace(/\.pdf$/i, '')
        .replace(
          /[<>:"/\\|?*]+/g,
          '-'
        );


    window.saveBlob(
      blob,
      `${baseName}-editable.docx`
    );

    status('Editable DOCX saved.');
  }
  catch (error) {
    console.error(
      'DOCX save error:',
      error
    );

    status(
      'Could not save DOCX: ' +
      (
        error.message ||
        String(error)
      )
    );
  }
}


/* ---------------------------------------------------------
   EVENTS
--------------------------------------------------------- */

// Connect a function only when that button exists in the current interface.
function connect(id, eventName, handler) {
  const element = document.getElementById(id);
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

// Open PDF
connect("pdfFile", "change", event => {
  loadPdf(event.target.files[0]);
});

// Zoom controls
connect("zoomIn", "click", async () => {
  if (!pdfDocument) return;
  scale = Math.min(2.5, scale + 0.15);
  await renderPdf();
});

connect("zoomOut", "click", async () => {
  if (!pdfDocument) return;
  scale = Math.max(0.5, scale - 0.15);
  await renderPdf();
});

// Switch between the original PDF and editable document
connect("editPdfDocument", "click", enterEditMode);
connect("goToPdfEditor", "click", enterEditMode);
connect("viewOriginalPdf", "click", viewOriginal);

// Save the original PDF
connect("savePdf", "click", saveOriginalPdf);

// Save editable document as DOCX
connect("savePdfDocx", "click", saveDocx);
connect("saveEditorDocx", "click", saveDocx);
