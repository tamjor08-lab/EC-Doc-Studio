import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

const $ = selector => document.querySelector(selector);

let bytes = null;
let pdf = null;
let scale = 1;
let rotation = {};
let deleted = new Set();
let annotations = [];
let placing = false;

let sourceFileName = 'document.pdf';
let documentPages = [];

/* =========================================================
   GENERAL HELPERS
   ========================================================= */

function status(message) {
  const element = $('#pdfStatus');

  if (element) {
    element.textContent = message;
  }
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function safeFileName(name) {
  return String(name || 'converted-from-pdf')
    .replace(/\.pdf$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .trim() || 'converted-from-pdf';
}

function median(values) {
  if (!values.length) {
    return 12;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2) {
    return sorted[middle];
  }

  return (sorted[middle - 1] + sorted[middle]) / 2;
}

/* =========================================================
   LOAD PDF
   ========================================================= */

async function load(file) {
  if (!file) {
    return;
  }

  try {
    status('Opening PDF…');

    sourceFileName = file.name || 'document.pdf';

    bytes = new Uint8Array(
      await file.arrayBuffer()
    );

    pdf = await pdfjsLib
      .getDocument({
        data: bytes.slice()
      })
      .promise;

    deleted.clear();
    rotation = {};
    annotations = [];
    documentPages = [];
    placing = false;

    if ($('#pdfTools')) {
      $('#pdfTools').hidden = false;
    }

    if ($('#savePdf')) {
      $('#savePdf').disabled = false;
    }

    if ($('#exportDocx')) {
      $('#exportDocx').disabled = false;
      $('#exportDocx').textContent = 'Edit as Document';
    }

    if ($('#pdfPage')) {
      $('#pdfPage').min = 1;
      $('#pdfPage').max = pdf.numPages;
      $('#pdfPage').value = 1;
    }

    status(
      `Loaded ${sourceFileName}: ${pdf.numPages} ` +
      `page${pdf.numPages === 1 ? '' : 's'}.`
    );

    await render();
  } catch (error) {
    console.error('PDF load error:', error);
    status(
      'Could not open that PDF: ' +
      (error.message || String(error))
    );
  }
}

/* =========================================================
   PDF VIEWER
   ========================================================= */

async function render() {
  if (!pdf) {
    return;
  }

  const box = $('#pdfViewer');

  if (!box) {
    return;
  }

  box.innerHTML = '';

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    if (deleted.has(pageNumber)) {
      continue;
    }

    const page = await pdf.getPage(pageNumber);

    const viewport = page.getViewport({
      scale,
      rotation: rotation[pageNumber] || 0
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page-wrap';
    wrapper.dataset.page = pageNumber;

    const canvas = document.createElement('canvas');

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    canvas.style.width =
      Math.ceil(viewport.width) + 'px';

    canvas.style.height =
      Math.ceil(viewport.height) + 'px';

    wrapper.appendChild(canvas);
    box.appendChild(wrapper);

    await page
      .render({
        canvasContext: canvas.getContext('2d'),
        viewport
      })
      .promise;

    wrapper.addEventListener(
      'click',
      event =>
        place(
          event,
          wrapper,
          pageNumber
        )
    );

    annotations
      .filter(
        annotation =>
          annotation.page === pageNumber
      )
      .forEach(
        annotation =>
          overlay(
            wrapper,
            annotation
          )
      );
  }

  if ($('#zoomLabel')) {
    $('#zoomLabel').textContent =
      Math.round(scale * 100) + '%';
  }
}

/* =========================================================
   PDF ANNOTATIONS
   ========================================================= */

function overlay(wrapper, annotation) {
  const span = document.createElement('span');

  span.textContent = annotation.text;

  span.style.position = 'absolute';
  span.style.left = annotation.x + 'px';
  span.style.top = annotation.y + 'px';
  span.style.fontFamily =
    'Arial, Helvetica, sans-serif';
  span.style.fontSize =
    annotation.size * scale + 'px';
  span.style.background =
    'rgba(255,255,255,.75)';
  span.style.padding = '1px 2px';
  span.style.pointerEvents = 'none';

  wrapper.appendChild(span);
}

function place(event, wrapper, pageNumber) {
  if (!placing) {
    return;
  }

  const textField = $('#pdfText');

  if (!textField) {
    return;
  }

  const text = textField.value.trim();

  if (!text) {
    status(
      'Type the text first, then click on the PDF page.'
    );
    return;
  }

  const rect =
    wrapper.getBoundingClientRect();

  annotations.push({
    page: pageNumber,
    text,
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    size: 12
  });

  placing = false;

  if ($('#textMode')) {
    $('#textMode').textContent =
      'Place text';
  }

  render();

  status(
    `Text added to page ${pageNumber}.`
  );
}

/* =========================================================
   SAVE EDITED PDF
   ========================================================= */

async function buildPdf() {
  if (!bytes) {
    throw new Error('No PDF is loaded.');
  }

  const {
    PDFDocument,
    StandardFonts,
    rgb,
    degrees
  } = PDFLib;

  const output =
    await PDFDocument.load(bytes);

  const font =
    await output.embedFont(
      StandardFonts.Helvetica
    );

  for (
    let pageNumber = pdf.numPages;
    pageNumber >= 1;
    pageNumber--
  ) {
    if (deleted.has(pageNumber)) {
      output.removePage(
        pageNumber - 1
      );
    }
  }

  const keptPages = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    if (!deleted.has(pageNumber)) {
      keptPages.push(pageNumber);
    }
  }

  keptPages.forEach(
    (originalPageNumber, outputIndex) => {
      const page =
        output.getPage(outputIndex);

      const extraRotation =
        rotation[originalPageNumber] || 0;

      if (extraRotation) {
        const current =
          page.getRotation().angle || 0;

        page.setRotation(
          degrees(
            (
              current +
              extraRotation
            ) % 360
          )
        );
      }

      annotations
        .filter(
          annotation =>
            annotation.page ===
            originalPageNumber
        )
        .forEach(annotation => {
          const wrapper =
            document.querySelector(
              `.pdf-page-wrap[data-page="${originalPageNumber}"]`
            );

          const displayedWidth =
            wrapper?.clientWidth ||
            page.getWidth();

          const ratio =
            page.getWidth() /
            displayedWidth;

          const x =
            annotation.x * ratio;

          const y =
            page.getHeight() -
            annotation.y * ratio -
            annotation.size;

          page.drawText(
            annotation.text,
            {
              x,
              y,
              size:
                annotation.size,
              font,
              color: rgb(0, 0, 0)
            }
          );
        });
    }
  );

  return output.save();
}

/* =========================================================
   PDF TEXT ANALYSIS
   ========================================================= */

/*
   PDF text is positioned rather than stored as Word
   paragraphs. This section reconstructs lines and paragraphs
   from the text coordinates supplied by PDF.js.
*/

function getItemInfo(item) {
  const transform =
    item.transform || [];

  const x =
    Number(transform[4]) || 0;

  const y =
    Number(transform[5]) || 0;

  let fontSize =
    Math.abs(
      Number(transform[3]) || 0
    );

  if (!fontSize) {
    fontSize =
      Math.abs(
        Number(transform[0]) || 0
      );
  }

  if (!fontSize) {
    fontSize = 12;
  }

  return {
    text: String(item.str || ''),
    x,
    y,
    width:
      Number(item.width) || 0,
    height:
      Number(item.height) ||
      fontSize,
    fontSize,
    fontName:
      String(
        item.fontName || ''
      )
  };
}

function groupIntoLines(items) {
  const usable = items
    .map(getItemInfo)
    .filter(
      item =>
        item.text.trim() !== ''
    );

  usable.sort((a, b) => {
    const yDifference =
      b.y - a.y;

    if (
      Math.abs(yDifference) >
      2
    ) {
      return yDifference;
    }

    return a.x - b.x;
  });

  const lines = [];

  usable.forEach(item => {
    const tolerance =
      Math.max(
        2,
        item.fontSize * 0.35
      );

    let line =
      lines.find(
        candidate =>
          Math.abs(
            candidate.y -
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

    const fontSizes =
      line.items.map(
        item => item.fontSize
      );

    const lineFontSize =
      median(fontSizes);

    let text = '';
    let previous = null;

    line.items.forEach(item => {
      if (previous) {
        const previousRight =
          previous.x +
          previous.width;

        const gap =
          item.x -
          previousRight;

        const likelyNeedsSpace =
          gap >
          Math.max(
            1.5,
            lineFontSize * 0.12
          );

        const previousText =
          previous.text || '';

        const currentText =
          item.text || '';

        const punctuationStarts =
          /^[,.;:!?)}\]]/.test(
            currentText
          );

        const punctuationEnds =
          /[(\[{]$/.test(
            previousText
          );

        if (
          likelyNeedsSpace &&
          !punctuationStarts &&
          !punctuationEnds &&
          !text.endsWith(' ')
        ) {
          text += ' ';
        }
      }

      text += item.text;

      previous = item;
    });

    text = text
      .replace(/[ \t]+/g, ' ')
      .trim();

    return {
      text,
      y: line.y,
      x:
        line.items[0]?.x || 0,
      fontSize: lineFontSize,
      maxFontSize:
        Math.max(...fontSizes),
      minFontSize:
        Math.min(...fontSizes)
    };
  });
}

function classifyLines(lines) {
  if (!lines.length) {
    return [];
  }

  const bodySize =
    median(
      lines
        .filter(
          line =>
            line.text.length > 20
        )
        .map(
          line =>
            line.fontSize
        )
    );

  const result = [];

  for (
    let index = 0;
    index < lines.length;
    index++
  ) {
    const line = lines[index];

    const previous =
      index > 0
        ? lines[index - 1]
        : null;

    const next =
      index <
      lines.length - 1
        ? lines[index + 1]
        : null;

    const gapBefore =
      previous
        ? previous.y - line.y
        : 0;

    const gapAfter =
      next
        ? line.y - next.y
        : 0;

    let type = 'body';

    if (
      line.fontSize >=
        bodySize * 1.55 &&
      line.text.length < 120
    ) {
      type = 'heading1';
    } else if (
      line.fontSize >=
        bodySize * 1.25 &&
      line.text.length < 140
    ) {
      type = 'heading2';
    }

    result.push({
      ...line,
      type,
      gapBefore,
      gapAfter,
      bodySize
    });
  }

  return result;
}

function linesToBlocks(lines) {
  const classified =
    classifyLines(lines);

  if (!classified.length) {
    return [];
  }

  const bodySize =
    classified[0].bodySize ||
    12;

  const normalLineGap =
    bodySize * 1.35;

  const blocks = [];
  let paragraph = null;

  function finishParagraph() {
    if (
      paragraph &&
      paragraph.text.trim()
    ) {
      blocks.push(
        paragraph
      );
    }

    paragraph = null;
  }

  classified.forEach(
    (line, index) => {
      if (
        line.type ===
          'heading1' ||
        line.type ===
          'heading2'
      ) {
        finishParagraph();

        blocks.push({
          type: line.type,
          text: line.text,
          fontSize:
            line.fontSize
        });

        return;
      }

      const previous =
        index > 0
          ? classified[index - 1]
          : null;

      const largeVerticalGap =
        previous &&
        previous.y - line.y >
          normalLineGap * 1.35;

      const indentationChange =
        paragraph &&
        Math.abs(
          line.x -
          paragraph.startX
        ) >
          bodySize * 1.5;

      const previousEndsSentence =
        paragraph &&
        /[.!?]["'’”)]?$/.test(
          paragraph.text.trim()
        );

      const likelyNewParagraph =
        largeVerticalGap ||
        (
          indentationChange &&
          previousEndsSentence
        );

      if (
        !paragraph ||
        likelyNewParagraph
      ) {
        finishParagraph();

        paragraph = {
          type: 'paragraph',
          text: line.text,
          fontSize:
            line.fontSize,
          startX: line.x
        };

        return;
      }

      const current =
        paragraph.text;

      const nextText =
        line.text;

      /*
         Rejoin words split by a PDF line break:
         "navi-" + "gation" becomes "navigation".
      */
      if (
        /[A-Za-z]-$/.test(
          current
        ) &&
        /^[a-z]/.test(
          nextText
        )
      ) {
        paragraph.text =
          current.slice(0, -1) +
          nextText;
      } else {
        paragraph.text +=
          ' ' + nextText;
      }
    }
  );

  finishParagraph();

  return blocks;
}

async function extractDocument() {
  if (!pdf) {
    throw new Error(
      'No PDF is loaded.'
    );
  }

  const pages = [];

  for (
    let pageNumber = 1;
    pageNumber <= pdf.numPages;
    pageNumber++
  ) {
    if (
      deleted.has(pageNumber)
    ) {
      continue;
    }

    status(
      `Preparing editable document: page ${pageNumber} of ${pdf.numPages}…`
    );

    const page =
      await pdf.getPage(
        pageNumber
      );

    const textContent =
      await page.getTextContent();

    const lines =
      groupIntoLines(
        textContent.items
      );

    const blocks =
      linesToBlocks(lines);

    pages.push({
      originalPage:
        pageNumber,
      blocks
    });
  }

  return pages;
}

/* =========================================================
   EDITABLE DOCUMENT WORKSPACE
   ========================================================= */

function ensureDocumentWorkspace() {
  let workspace =
    document.getElementById(
      'pdfDocumentEditor'
    );

  if (workspace) {
    return workspace;
  }

  workspace =
    document.createElement('section');

  workspace.id =
    'pdfDocumentEditor';

  workspace.style.display =
    'none';

  workspace.style.marginTop =
    '1rem';

  workspace.innerHTML = `
    <div
      class="pdf-document-toolbar"
      style="
        display:flex;
        gap:.6rem;
        flex-wrap:wrap;
        align-items:center;
        margin-bottom:1rem;
        position:sticky;
        top:0;
        z-index:5;
        background:var(--paper,#fbfaf6);
        padding:.75rem 0;
      "
    >
      <button
        id="pdfBackToViewer"
        class="btn secondary"
        type="button"
      >
        Back to PDF
      </button>

      <button
        id="pdfSaveDocx"
        class="btn"
        type="button"
      >
        Save DOCX
      </button>

      <span class="muted">
        Edit the converted document below.
      </span>
    </div>

    <div
      id="pdfEditableDocument"
      style="
        background:#fff;
        color:#111;
        max-width:850px;
        margin:0 auto;
        padding:3rem;
        min-height:700px;
        box-shadow:0 3px 18px rgba(0,0,0,.12);
        line-height:1.55;
      "
    ></div>
  `;

  const viewer =
    $('#pdfViewer');

  if (viewer) {
    viewer.insertAdjacentElement(
      'afterend',
      workspace
    );
  } else {
    $('#pdf')?.appendChild(
      workspace
    );
  }

  $('#pdfBackToViewer')
    .addEventListener(
      'click',
      showPdfViewer
    );

  $('#pdfSaveDocx')
    .addEventListener(
      'click',
      saveEditableDocx
    );

  return workspace;
}

function renderEditableDocument() {
  const editor =
    $('#pdfEditableDocument');

  if (!editor) {
    return;
  }

  editor.innerHTML = '';

  documentPages.forEach(
    (page, pageIndex) => {
      const pageSection =
        document.createElement(
          'section'
        );

      pageSection.className =
        'converted-page';

      pageSection.dataset.page =
        page.originalPage;

      if (pageIndex > 0) {
        pageSection.style.borderTop =
          '1px dashed #bbb';

        pageSection.style.marginTop =
          '2.5rem';

        pageSection.style.paddingTop =
          '2.5rem';
      }

      page.blocks.forEach(
        block => {
          let element;

          if (
            block.type ===
            'heading1'
          ) {
            element =
              document.createElement(
                'h1'
              );
          } else if (
            block.type ===
            'heading2'
          ) {
            element =
              document.createElement(
                'h2'
              );
          } else {
            element =
              document.createElement(
                'p'
              );
          }

          element.textContent =
            block.text;

          pageSection.appendChild(
            element
          );
        }
      );

      editor.appendChild(
        pageSection
      );
    }
  );

  editor.contentEditable =
    'true';

  editor.spellcheck = true;
}

async function openDocumentEditor() {
  if (!pdf) {
    status(
      'Open a PDF first.'
    );
    return;
  }

  try {
    const workspace =
      ensureDocumentWorkspace();

    documentPages =
      await extractDocument();

    renderEditableDocument();

    if ($('#pdfViewer')) {
      $('#pdfViewer').style.display =
        'none';
    }

    if ($('#pdfTools')) {
      $('#pdfTools').style.display =
        'none';
    }

    workspace.style.display =
      'block';

    status(
      'Editable document ready. Review the formatting, make changes, then Save DOCX.'
    );
  } catch (error) {
    console.error(
      'Document conversion error:',
      error
    );

    status(
      'Could not prepare the editable document: ' +
      (
        error.message ||
        String(error)
      )
    );
  }
}

function showPdfViewer() {
  const workspace =
    $('#pdfDocumentEditor');

  if (workspace) {
    workspace.style.display =
      'none';
  }

  if ($('#pdfViewer')) {
    $('#pdfViewer').style.display =
      '';
  }

  if ($('#pdfTools')) {
    $('#pdfTools').style.display =
      '';
  }

  status(
    `Viewing ${sourceFileName}.`
  );
}

/* =========================================================
   DOCX GENERATION
   ========================================================= */

function paragraphXml(
  text,
  options = {}
) {
  const {
    heading = null,
    pageBreakBefore = false
  } = options;

  let properties = '';

  if (heading === 1) {
    properties +=
      '<w:pStyle w:val="Heading1"/>';
  }

  if (heading === 2) {
    properties +=
      '<w:pStyle w:val="Heading2"/>';
  }

  if (pageBreakBefore) {
    properties +=
      '<w:pageBreakBefore/>';
  }

  const paragraphProperties =
    properties
      ? `<w:pPr>${properties}</w:pPr>`
      : '';

  return (
    '<w:p>' +
    paragraphProperties +
    '<w:r>' +
    '<w:t xml:space="preserve">' +
    escapeXml(text) +
    '</w:t>' +
    '</w:r>' +
    '</w:p>'
  );
}

function editorToWordXml() {
  const editor =
    $('#pdfEditableDocument');

  if (!editor) {
    return '';
  }

  const pages = [
    ...editor.querySelectorAll(
      '.converted-page'
    )
  ];

  const output = [];

  pages.forEach(
    (page, pageIndex) => {
      const elements = [
        ...page.children
      ];

      let firstElement = true;

      elements.forEach(element => {
        const tag =
          element.tagName.toLowerCase();

        const text =
          element.innerText
            .replace(/\u00a0/g, ' ')
            .trim();

        if (!text) {
          return;
        }

        const pageBreakBefore =
          pageIndex > 0 &&
          firstElement;

        if (tag === 'h1') {
          output.push(
            paragraphXml(
              text,
              {
                heading: 1,
                pageBreakBefore
              }
            )
          );
        } else if (
          tag === 'h2'
        ) {
          output.push(
            paragraphXml(
              text,
              {
                heading: 2,
                pageBreakBefore
              }
            )
          );
        } else {
          output.push(
            paragraphXml(
              text,
              {
                pageBreakBefore
              }
            )
          );
        }

        firstElement = false;
      });
    }
  );

  return output.join('');
}

function stylesXml() {
  return `
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
>
  <w:style
    w:type="paragraph"
    w:default="1"
    w:styleId="Normal"
  >
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>
      <w:sz w:val="24"/>
      <w:szCs w:val="24"/>
    </w:rPr>
  </w:style>

  <w:style
    w:type="paragraph"
    w:styleId="Heading1"
  >
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing
        w:before="240"
        w:after="120"
      />
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="32"/>
      <w:szCs w:val="32"/>
    </w:rPr>
  </w:style>

  <w:style
    w:type="paragraph"
    w:styleId="Heading2"
  >
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing
        w:before="180"
        w:after="100"
      />
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="28"/>
      <w:szCs w:val="28"/>
    </w:rPr>
  </w:style>
</w:styles>
`.trim();
}

async function saveEditableDocx() {
  const editor =
    $('#pdfEditableDocument');

  if (!editor) {
    status(
      'No editable document is open.'
    );
    return;
  }

  try {
    status(
      'Building DOCX…'
    );

    const zip =
      new JSZip();

    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default
    Extension="rels"
    ContentType="application/vnd.openxmlformats-package.relationships+xml"
  />
  <Default
    Extension="xml"
    ContentType="application/xml"
  />
  <Override
    PartName="/word/document.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
  />
  <Override
    PartName="/word/styles.xml"
    ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
  />
</Types>`
    );

    zip.folder('_rels').file(
      '.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rId1"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
    Target="word/document.xml"
  />
</Relationships>`
    );

    const word =
      zip.folder('word');

    word.file(
      'document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
>
  <w:body>
    ${editorToWordXml()}
    <w:sectPr>
      <w:pgSz
        w:w="12240"
        w:h="15840"
      />
      <w:pgMar
        w:top="1440"
        w:right="1440"
        w:bottom="1440"
        w:left="1440"
        w:header="720"
        w:footer="720"
        w:gutter="0"
      />
    </w:sectPr>
  </w:body>
</w:document>`
    );

    word.file(
      'styles.xml',
      stylesXml()
    );

    word
      .folder('_rels')
      .file(
        'document.xml.rels',
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship
    Id="rIdStyles"
    Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
    Target="styles.xml"
  />
</Relationships>`
      );

    const blob =
      await zip.generateAsync({
        type: 'blob',
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });

    window.saveBlob(
      blob,
      safeFileName(
        sourceFileName
      ) + '.docx'
    );

    status(
      'DOCX saved.'
    );
  } catch (error) {
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

/* =========================================================
   CONTROLS
   ========================================================= */

$('#pdfFile').onchange =
  event =>
    load(
      event.target.files[0]
    );

$('#zoomIn').onclick = () => {
  if (!pdf) {
    return;
  }

  scale =
    Math.min(
      2.5,
      scale + 0.15
    );

  render();
};

$('#zoomOut').onclick = () => {
  if (!pdf) {
    return;
  }

  scale =
    Math.max(
      0.5,
      scale - 0.15
    );

  render();
};

$('#rotatePage').onclick = () => {
  if (!pdf) {
    return;
  }

  const pageNumber =
    Number(
      $('#pdfPage').value
    );

  if (
    pageNumber >= 1 &&
    pageNumber <= pdf.numPages
  ) {
    rotation[pageNumber] =
      (
        (
          rotation[pageNumber] ||
          0
        ) +
        90
      ) % 360;

    render();

    status(
      `Page ${pageNumber} rotated.`
    );
  }
};

$('#deletePage').onclick = () => {
  if (!pdf) {
    return;
  }

  const pageNumber =
    Number(
      $('#pdfPage').value
    );

  if (
    pageNumber >= 1 &&
    pageNumber <= pdf.numPages
  ) {
    deleted.add(
      pageNumber
    );

    render();

    status(
      `Page ${pageNumber} marked for deletion.`
    );
  }
};

$('#textMode').onclick = () => {
  if (!pdf) {
    return;
  }

  placing = !placing;

  $('#textMode').textContent =
    placing
      ? 'Click page…'
      : 'Place text';

  if (placing) {
    status(
      'Click the PDF where you want to place the text.'
    );
  }
};

$('#savePdf').onclick =
  async () => {
    if (!pdf) {
      return;
    }

    try {
      status(
        'Saving PDF…'
      );

      const output =
        await buildPdf();

      window.saveBlob(
        new Blob(
          [output],
          {
            type:
              'application/pdf'
          }
        ),
        'edited.pdf'
      );

      status(
        'PDF saved.'
      );
    } catch (error) {
      console.error(
        'PDF save error:',
        error
      );

      status(
        'Could not save PDF: ' +
        (
          error.message ||
          String(error)
        )
      );
    }
  };

/*
   The existing Export DOCX button now opens the
   editable document workspace first.
*/
$('#exportDocx').onclick =
  openDocumentEditor;
