(() => {
  'use strict';

  const $ = s => document.querySelector(s);

  const EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/svg+xml': 'svg',
    'image/webp': 'webp'
  };

  let st = {
    html: '',
    doc: null,
    chapters: [],
    current: 0,
    images: new Map(),
    notes: [],
    cover: null,
    external: false,
    archive: null,
    packagePath: null,
    resources: new Map()
  };

  const esc = s => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  function status(message) {
    const el = $('#epubStatus');
    if (el) el.textContent = message;
  }

  function sanitize(doc) {
    doc.querySelectorAll(
      'script,style,iframe,object,embed,link,meta,form'
    ).forEach(el => el.remove());

    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
    });
  }

function split(doc, mode) {
  const chapters = [];

  // Make PDF page headings visible to the chapter splitter.
  doc.querySelectorAll('section.pdf-import-page').forEach(page => {
    const marker = doc.createElement('span');
    marker.dataset.pdfPage = page.dataset.pdfPage;
    page.replaceWith(marker, ...page.childNodes);
  });

  /*
   * Mammoth puts DOCX footnotes into one ordered list at
   * the end of the converted document. Save those notes
   * before dividing the manuscript into chapters.
   */
  const footnotes = new Map();

  doc.querySelectorAll('[id^="footnote-"]').forEach(note => {
    if (note.dataset.pdfNote) return;
    /*
     * Do not mistake Mammoth's footnote reference anchors
     * (footnote-ref-N) for actual footnotes.
     */
    if (/^footnote-\d+(?:-pdf-\d+)?$/.test(note.id)) {
      footnotes.set(note.id, note.cloneNode(true));
      note.remove();
    }
  });

  /*
   * Remove an ordered list if it became empty after its
   * footnotes were removed.
   */
  doc.querySelectorAll('ol').forEach(list => {
    if (!list.textContent.trim() && !list.querySelector('img')) {
      list.remove();
    }
  });

  let current = {
    title: doc.querySelector('[data-pdf-page]') ? 'Front matter' : null,
    nodes: []
  };

  const isBreak = el => {
    if (mode === 'h1') {
      return el.tagName === 'H1';
    }

    if (mode === 'h12') {
      return ['H1', 'H2'].includes(el.tagName);
    }

    return false;
  };

  const hasContent = chapter =>
    chapter.nodes.some(node =>
      node.textContent?.trim() ||
      node.matches?.('img,svg') ||
      node.querySelector?.('img,svg')
    );

  [...doc.body.childNodes].forEach(node => {
    if (
      node.nodeType === 1 &&
      isBreak(node)
    ) {
      if (hasContent(current)) {
        chapters.push(current);
      }

      current = {
        title:
          node.textContent.trim() ||
          'Untitled',
        nodes: [node]
      };
    } else {
      current.nodes.push(node);
    }
  });

  if (hasContent(current)) {
    chapters.push(current);
  }

  /*
   * Find every footnote referenced by each chapter and
   * append only those notes to that chapter.
   */
  chapters.forEach(chapter => {
    const pdfNotes = chapter.nodes.filter(node => node.matches?.('ol') && node.querySelector('[data-pdf-note]'));
    if (pdfNotes.length) {
      chapter.nodes = chapter.nodes.filter(node => !pdfNotes.includes(node));
      const section = doc.createElement('section'); section.className = 'ec-chapter-footnotes';
      const heading = doc.createElement('h2'); heading.textContent = 'Notes'; section.appendChild(heading);
      pdfNotes.forEach(list => section.appendChild(list)); chapter.nodes.push(section);
    }
    const pdfIds = new Set(pdfNotes.flatMap(list => [...list.querySelectorAll('[id]')].map(note => note.id)));
    for (const node of chapter.nodes) for (const link of node.querySelectorAll?.('[data-pdf-reference]') || []) {
      if (!pdfIds.has(link.getAttribute('href')?.slice(1))) link.replaceWith(doc.createTextNode(link.textContent));
    }
    const pdfReferences = chapter.nodes.flatMap(node => [...(node.querySelectorAll?.('[data-pdf-reference]') || [])]);
    for (const list of pdfNotes) for (const note of list.querySelectorAll('[data-pdf-note]')) {
      note.querySelectorAll('[data-pdf-backlink]').forEach(link => link.remove());
      const references = pdfReferences.filter(link => link.getAttribute('href') === '#'+note.id);
      references.forEach((reference,index) => {
        const back = doc.createElement('a'); back.href = '#'+reference.id;
        back.dataset.pdfBacklink = 'true';
        back.textContent = references.length === 1 ? ' ↑ Back to reading' : ' ↑'+(index+1);
        back.setAttribute('aria-label','Back to reading'+(references.length > 1 ? ', reference '+(index+1) : ''));
        note.appendChild(back);
      });
    }
    const noteIds = new Set();

    chapter.nodes.forEach(node => {
      if (node.nodeType !== 1) return;

      const links = [];

      if (
        node.matches?.('a[href^="#footnote-"]')
      ) {
        links.push(node);
      }

      node
        .querySelectorAll?.('a[href^="#footnote-"]')
        .forEach(link => links.push(link));

      links.forEach(link => {
        const href =
          link.getAttribute('href');

        const id =
          href?.slice(1);

        if (
          id &&
          footnotes.has(id)
        ) {
          noteIds.add(id);
        }
      });
    });

    if (!noteIds.size) return;

    const section =
      doc.createElement('section');

    section.className =
      'ec-chapter-footnotes';

    const list =
      doc.createElement('ol');

    noteIds.forEach(id => {
      const note =
        footnotes.get(id);

      if (note) {
        // Keep Mammoth's document-wide numbers when a chapter's list
        // begins with a later footnote instead of restarting at one.
        const number = Number(id.match(/^footnote-(\d+)$/)?.[1]);
        const chapterNote = note.cloneNode(true);
        if (number > 0) chapterNote.value = number;
        list.appendChild(
          chapterNote
        );
      }
    });

    section.appendChild(list);
    chapter.nodes.push(section);
  });

  return chapters;
}

  function chapterTitle(chapter, index) {
    return (
      chapter.title ||
      $('#bookTitle')?.value ||
      `Chapter ${index + 1}`
    );
  }

  function refresh() {
    if (!st.external) {
      const doc =
        new DOMParser().parseFromString(
          '<!doctype html><html><body>' +
          st.html +
          '</body></html>',
          'text/html'
        );

      sanitize(doc);

      st.doc = doc;

      const mode =
        $('#chapterSplit')?.value ||
        'h1';

      st.chapters = split(doc, mode);
    }

    st.current = Math.min(
      st.current,
      Math.max(
        0,
        st.chapters.length - 1
      )
    );

    render();
  }

  function showChapter(index) {
    if (index < 0 || index >= st.chapters.length) return;
    endEdit();
    st.current = index;
    // A note's URL fragment belongs to the old chapter.
    if (location.hash) history.replaceState(null, '', location.pathname+location.search);
    render();
    const page = $('#bookPage');
    if (page) {
      page.scrollTop = 0;
      // The reader grows with its content, so the browser window (or an
      // outer scrolling container) must also return to the chapter start.
      page.scrollIntoView({block:'start', behavior:'instant'});
    }
  }

  function render() {
    const toc = $('#bookToc');
    const page = $('#bookPage');

    if (!toc || !page) return;

    toc.innerHTML = '';

    st.chapters.forEach(
      (chapter, index) => {
        const button =
          document.createElement('button');

        button.type = 'button';

        button.textContent =
          chapterTitle(
            chapter,
            index
          );

        button.className =
          index === st.current
            ? 'active'
            : '';

        button.onclick = () => {
          showChapter(index);
        };

        toc.appendChild(button);
      }
    );

    if ($('#prevChapter')) {
      $('#prevChapter').disabled =
        st.current <= 0;
    }

    if ($('#nextChapter')) {
      $('#nextChapter').disabled =
        st.current >=
        st.chapters.length - 1;
    }

    if ($('#editChapter')) {
      $('#editChapter').disabled =
        !st.chapters.length;
    }

    if ($('#buildEpub')) {
      $('#buildEpub').disabled =
        !st.chapters.length;
    }

    page.innerHTML = '';

    if (!st.chapters.length) {
      page.innerHTML =
        '<p class="muted">' +
        'Open a DOCX or EPUB to begin.' +
        '</p>';

      return;
    }

    st.chapters[
      st.current
    ].nodes.forEach(node => {
      const clone =
        node.cloneNode(true);

      if (clone.nodeType === 1 && !st.external) {
        const images =
          clone.tagName === 'IMG'
            ? [clone]
            : [
                ...clone.querySelectorAll(
                  'img'
                )
              ];

        images.forEach(img => {
          const image =
            st.images.get(
              img.getAttribute('src')
            );

          if (image) {
            img.src = image.url;
          }
        });
      }

      if (st.external && clone.nodeType === 1) previewImagePaths(clone, st.chapters[st.current]);
      page.appendChild(clone);
    });
  }

  function showNotes() {
    const box =
      $('#conversionNotes');

    const list =
      $('#conversionList');

    const summary =
      $('#conversionSummary');

    if (!box || !list) return;

    list.innerHTML = '';

    if (!st.notes.length) {
      box.hidden = true;
      return;
    }

    st.notes.forEach(note => {
      const li =
        document.createElement('li');

      li.textContent = note;

      list.appendChild(li);
    });

    if (summary) {
      summary.textContent =
        `${st.notes.length} ` +
        `conversion note` +
        `${st.notes.length === 1
          ? ''
          : 's'}`;
    }

    box.hidden = false;
  }

   function normalizeFigures(html) {
  const doc =
    new DOMParser().parseFromString(
      '<!doctype html><html><body>' +
      html +
      '</body></html>',
      'text/html'
    );

  const hasImage = element =>
    element &&
    (
      element.matches?.('img') ||
      Boolean(element.querySelector?.('img'))
    );

  const captionText = element =>
    (element?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();

  const looksLikeCaption = element => {
    if (!element) return false;

    if (!['P', 'DIV'].includes(element.tagName)) {
      return false;
    }

    if (hasImage(element)) {
      return false;
    }

    const text =
      captionText(element);

    if (!text || text.length > 500) {
      return false;
    }

    /*
     * Word captions mapped by Mammoth.
     */
    if (
      element.classList.contains(
        'ec-word-caption'
      )
    ) {
      return true;
    }

    /*
     * Fallback for captions that were not given
     * Word's Caption paragraph style.
     */
    if (
      /^(?:figure|fig\.?|photo(?:graph)?|image|illustration|plate)\s*(?:[:.#-]?\s*)?\d+/i
        .test(text)
    ) {
      return true;
    }

    const className =
      element.getAttribute('class') || '';

    return /\bcaption\b/i.test(className);
  };

  /*
   * A Word document may contain:
   *
   *   image
   *   image
   *   caption
   *
   * as well as the simpler:
   *
   *   image
   *   caption
   *
   * Work from the caption backward so every
   * consecutive image belonging to that caption
   * becomes one figure group.
   */
  const captions =
    [...doc.body.children]
      .filter(looksLikeCaption);

  captions.forEach(caption => {
    if (!caption.isConnected) return;
    if (caption.closest('figure')) return;

    const imageBlocks = [];

    let previous =
      caption.previousElementSibling;

    /*
     * Allow empty paragraphs between an image
     * and its caption.
     */
    while (
      previous &&
      !captionText(previous) &&
      !hasImage(previous)
    ) {
      const empty =
        previous;

      previous =
        previous.previousElementSibling;

      empty.remove();
    }

    /*
     * Collect every consecutive image block
     * immediately before this caption.
     */
    while (
      previous &&
      hasImage(previous) &&
      !previous.closest('figure')
    ) {
      imageBlocks.unshift(previous);

      previous =
        previous.previousElementSibling;

      /*
       * Skip harmless empty paragraphs between
       * consecutive images.
       */
      while (
        previous &&
        !captionText(previous) &&
        !hasImage(previous)
      ) {
        const empty =
          previous;

        previous =
          previous.previousElementSibling;

        empty.remove();
      }
    }

    if (!imageBlocks.length) {
      return;
    }

    const figure =
      doc.createElement('figure');

    figure.className =
      'ec-figure';

    imageBlocks[0].parentNode.insertBefore(
      figure,
      imageBlocks[0]
    );

    imageBlocks.forEach(block => {
      figure.appendChild(block);
    });

    const figcaption =
      doc.createElement('figcaption');

    figcaption.innerHTML =
      caption.innerHTML;

    figure.appendChild(figcaption);

    caption.remove();
  });

  return doc.body.innerHTML;
}
  
  async function pdfPictures(page, pageNumber) {
    const ops = await page.getOperatorList();
    const names = pdfjsLib.OPS;
    let matrix = [1, 0, 0, 1, 0, 0];
    const stack = [], boxes = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], args = ops.argsArray[i];
      if (fn === names.save) stack.push([...matrix]);
      else if (fn === names.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (fn === names.transform) matrix = pdfjsLib.Util.transform(matrix, args);
      else if (fn === names.paintFormXObjectBegin) {
        stack.push([...matrix]);
        if (args[0]) matrix = pdfjsLib.Util.transform(matrix, args[0]);
      } else if (fn === names.paintFormXObjectEnd) matrix = stack.pop() || matrix;
      else if ([names.paintImageXObject, names.paintInlineImageXObject, names.paintImageMaskXObject].includes(fn)) {
        const points = [[0,0],[1,0],[0,1],[1,1]].map(p => pdfjsLib.Util.applyTransform(p, matrix));
        const x = Math.min(...points.map(p => p[0])), y = Math.min(...points.map(p => p[1]));
        const right = Math.max(...points.map(p => p[0])), top = Math.max(...points.map(p => p[1]));
        if (right-x > 8 && top-y > 8) boxes.push({x, y, right, top});
      }
    }
    if (!boxes.length) return [];
    const viewport = page.getViewport({scale: 1.5});
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
    const pictures = [];
    for (const box of boxes) {
      const rect = viewport.convertToViewportRectangle([box.x, box.y, box.right, box.top]);
      const left = Math.max(0, Math.floor(Math.min(rect[0], rect[2])));
      const top = Math.max(0, Math.floor(Math.min(rect[1], rect[3])));
      const width = Math.min(canvas.width-left, Math.ceil(Math.abs(rect[2]-rect[0])));
      const height = Math.min(canvas.height-top, Math.ceil(Math.abs(rect[3]-rect[1])));
      if (width <= 0 || height <= 0) continue;
      const crop = document.createElement('canvas'); crop.width = width; crop.height = height;
      crop.getContext('2d').drawImage(canvas, left, top, width, height, 0, 0, width, height);
      const blob = await new Promise(resolve => crop.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not preserve a PDF picture on page '+pageNumber);
      const path = `images/pdf-${pageNumber}-${pictures.length+1}.png`;
      st.images.set(path, {buf: await blob.arrayBuffer(), mime: 'image/png', url: URL.createObjectURL(blob)});
      const figure = document.createElement('figure'); figure.className = 'ec-figure';
      const image = document.createElement('img'); image.src = st.images.get(path).url; image.alt = 'Picture from PDF page '+pageNumber;
      figure.appendChild(image); pictures.push({figure, y:box.top, x:box.x, right:box.right, bottom:box.y});
    }
    canvas.width = canvas.height = 0;
    return pictures;
  }

  async function openPdf(file) {
    if (!file) return;

    releaseResources();
    st.archive = null;
    st.packagePath = null;
    endEdit();

    status('Reading PDF…');

    st.external = false;

    st.images.forEach(image => {
      if (image.url) {
        URL.revokeObjectURL(image.url);
      }
    });

    st.images = new Map();
    st.notes = [];
    st.html = '';
    st.chapters = [];
    st.current = 0;

    try {
      if (typeof pdfjsLib === 'undefined') {
        throw new Error(
          'The PDF reader library did not load. Refresh the page and try again.'
        );
      }

      const arrayBuffer = await file.arrayBuffer();

      const pdf = await pdfjsLib
        .getDocument({ data: arrayBuffer })
        .promise;

      const pages = [];
      let expectedChapter = 1;
      let importedFootnotes = 0;
      let referenceSerial = 0;

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        status(
          `Reading PDF page ${pageNumber} of ${pdf.numPages}…`
        );

        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const viewport = page.getViewport({scale:1});
        const pictures = await pdfPictures(page, pageNumber);

        const items = textContent.items
          .filter(item => item.str && item.str.trim())
          .map(item => ({
            text: item.str.trim(),
            x: item.transform[4],
            y: item.transform[5],
            width: item.width || 0,
            height:
              Math.abs(item.height) ||
              Math.abs(item.transform[3]) ||
              12
          }));

        /*
         * PDF files store text by position rather than as ordinary
         * paragraphs. Group pieces that sit on approximately the
         * same horizontal line.
         */
        items.sort((a, b) => {
          const yDifference = b.y - a.y;

          if (Math.abs(yDifference) > 3) {
            return yDifference;
          }

          return a.x - b.x;
        });

        const lines = [];

        items.forEach(item => {
          let line = lines.find(
            existing =>
              Math.abs(existing.y - item.y) <=
              Math.max(3, item.height * 0.6)
          );

          if (!line) {
            line = {
              y: item.y,
              height: item.height,
              items: []
            };

            lines.push(line);
          }

          line.items.push(item);
          line.height = Math.max(
            line.height,
            item.height
          );
        });

        lines.sort((a, b) => b.y - a.y);
        // Weight type size by text length: a caption or URL may be split
        // into many tiny items and should not outweigh the page's prose.
        const heightWeights = new Map();
        for (const item of items) {
          const height = Math.round(item.height*10)/10;
          heightWeights.set(height, (heightWeights.get(height)||0)+item.text.length);
        }
        const bodyHeight = [...heightWeights].sort((a,b)=>b[1]-a[1])[0]?.[0] || 12;
        const textOf = line => line.items.slice().sort((a,b)=>a.x-b.x).map(item=>item.text).join(' ').replace(/\s+/g,' ').trim();
        const textHeight = line => line.items.reduce((total,item)=>total+item.height*item.text.length,0) /
          Math.max(1,line.items.reduce((total,item)=>total+item.text.length,0));
        // A centered, isolated number in the footer is pagination, not a reference.
        const contentLines = lines.filter(line => !(
          /^\d+$/.test(textOf(line)) && line.y < viewport.height*0.08 &&
          Math.abs(line.items[0].x-viewport.width/2) < viewport.width*0.12
        ));
        const noteStart = contentLines.findIndex(line =>
          line.y < viewport.height*0.2 && textHeight(line) < bodyHeight*0.98 &&
          line.items[0].x < viewport.width*0.15 &&
          line.items[0].height < bodyHeight*0.8 &&
          /^\d+\s+\S/.test(textOf(line))
        );
        const noteLines = noteStart < 0 ? [] : contentLines.splice(noteStart);
        let note = null;
        const pageNotes = [];
        for (const line of noteLines) {
          const text = textOf(line), match = text.match(/^(\d+)\s+(.+)/);
          if (match && line.items[0].x < viewport.width*0.15 && line.items[0].height < bodyHeight*0.8) {
            note = document.createElement('li'); note.id = 'footnote-'+match[1]+'-pdf-'+pageNumber;
            note.value = Number(match[1]);
            note.dataset.pdfNote = 'true'; note.textContent = match[2]; pageNotes.push(note);
            importedFootnotes++;
          } else if (note) note.textContent += ' '+text;
        }

        const pageElement =
          document.createElement('section');

        pageElement.className = 'pdf-import-page';
        pageElement.dataset.pdfPage = pageNumber;

        let previousLine = null;
        let paragraph = null;

        contentLines.forEach((line, lineIndex) => {
          line.items.sort((a, b) => a.x - b.x);
          const joined = [];
          for (const item of line.items) {
            const previous = joined[joined.length-1];
            if (previous && previous.text === 'F' && /^igure\b/.test(item.text) &&
              Math.abs(previous.y-item.y) < 1 && Math.abs(previous.height-item.height) < 0.5 &&
              item.x-(previous.x+previous.width) >= -0.5 && item.x-(previous.x+previous.width) < 0.7) {
              previous.text += item.text;
              previous.width = item.x+item.width-previous.x;
            } else joined.push({...item});
          }
          line.items = joined;

          // Captions beside wrapping prose must be separated by position,
          // otherwise a figure number can look like a raised footnote.
          let captionIndex = line.items.findIndex(item => /^(?:Figure|Fig\.)\s*(?:\d+\b.*)?$/i.test(item.text));
          while (captionIndex >= 0) {
            const first = line.items[captionIndex];
            const picture = pictures.filter(p => !p.figure.querySelector('figcaption') && first.x >= p.x-100 && first.x <= p.right+40 &&
              p.bottom-line.y >= -40 && p.bottom-line.y <= 80)
              .sort((a,b)=>(Math.abs(a.bottom-line.y)+Math.max(0,a.x-first.x))-
                (Math.abs(b.bottom-line.y)+Math.max(0,b.x-first.x)))[0];
            if (picture) {
              const nextCaption = line.items.findIndex((item,index)=>index > captionIndex && /^(?:Figure|Fig\.)\s*(?:\d+\b.*)?$/i.test(item.text));
              const captionItems = line.items.slice(captionIndex,nextCaption < 0 ? undefined : nextCaption)
                .filter(item => item.x <= picture.right+60 && item.height <= first.height*1.2);
              let caption = picture.figure.querySelector('figcaption');
              if (!caption) {caption = document.createElement('figcaption');picture.figure.appendChild(caption);}
              caption.textContent = captionItems.map(item=>item.text).join(' ').replace(/\s+/g,' ').trim();
              picture.captionY = line.y;
              picture.captionHeight = captionItems.reduce((n,item)=>n+item.height,0)/captionItems.length;
              line.items = line.items.filter(item => !captionItems.includes(item));
              if (!line.items.length) return;
              line.height = Math.max(...line.items.map(item=>item.height));
            } else break;
            captionIndex = line.items.findIndex(item => /^(?:Figure|Fig\.)\s*(?:\d+\b.*)?$/i.test(item.text));
          }
          for (const picture of pictures) {
            if (picture.captionY == null || line.y >= picture.captionY || picture.captionY-line.y > picture.captionHeight*1.8) continue;
            const continuation = line.items.filter(item => item.x >= picture.x-60 && item.x+item.width <= picture.right+60 &&
              item.height <= picture.captionHeight*1.12);
            if (!continuation.length) continue;
            picture.figure.querySelector('figcaption').appendChild(document.createTextNode(' '+continuation.map(item=>item.text).join(' ')));
            picture.captionY = line.y;
            line.items = line.items.filter(item=>!continuation.includes(item));
          }
          if (!line.items.length) return;
          line.height = Math.max(...line.items.map(item=>item.height));

          const text = line.items
            .map(item => item.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();

          if (!text) return;

          const averageHeight =
            line.items.reduce(
              (total, item) =>
                total + item.height,
              0
            ) / line.items.length;

          /*
           * Larger text is treated as a possible heading.
           * This is intentionally conservative because PDFs do
           * not contain Word-style heading information.
           */
          const looksLikeHeading =
            averageHeight >= 16 &&
            text.length <= 120;

          const chapterMatch = text.match(/^chapter\s+(\d+)\s*[:.\-–—]/i);
          const looksLikeChapter =
            lineIndex === 0 &&
            chapterMatch && Number(chapterMatch[1]) === expectedChapter &&
            text.length <= 160;

          if (looksLikeHeading || looksLikeChapter) {
            if (looksLikeChapter) expectedChapter++;
            const heading =
              document.createElement(looksLikeChapter ? 'h1' : 'h2');

            heading.textContent = text;
            heading.dataset.pdfY = String(line.y);
            pageElement.appendChild(heading);

            paragraph = null;
            previousLine = line;
            return;
          }

          const gap =
            previousLine
              ? previousLine.y - line.y
              : 0;

          const normalGap =
            Math.max(
              previousLine?.height || 12,
              line.height
            );

          const startsNewParagraph =
            !paragraph ||
            !previousLine ||
            /^(?:Figure|Fig\.)\s*\d+/i.test(text) ||
            pictures.some(picture => previousLine.y > picture.y && line.y <= picture.y) ||
            gap > normalGap * 1.65;

          if (startsNewParagraph) {
            paragraph =
              document.createElement('p');

            paragraph.textContent = '';

            pageElement.appendChild(
              paragraph
            );
          } else paragraph.appendChild(document.createTextNode(' '));
          for (const item of line.items) {
            const baseline = Math.min(...line.items.filter(i => i.height >= line.height*0.9).map(i => i.y));
            const reference = /^\d+$/.test(item.text) && item.height < line.height*0.82 && item.y > baseline+1 &&
              !/(?:Figure|Fig\.)\s*$/i.test(paragraph.textContent);
            if (reference) {
              const sup = document.createElement('sup'), link = document.createElement('a');
              link.href = '#footnote-'+item.text+'-pdf-'+pageNumber; link.id = 'footnote-ref-'+pageNumber+'-'+(++referenceSerial);
              link.dataset.pdfReference = item.text;
              link.textContent = item.text; sup.appendChild(link); paragraph.appendChild(sup);
            } else paragraph.appendChild(document.createTextNode((paragraph.textContent && !/\s$/.test(paragraph.textContent) ? ' ' : '')+item.text));
          }
          paragraph.dataset.pdfY ||= String(line.y);

          previousLine = line;
        });

        // Place pictures by their original vertical position, pairing a
        // nearby caption where it is a separate paragraph.
        for (const picture of pictures.sort((a,b)=>b.y-a.y)) {
          const following = [...pageElement.children].find(el => Number(el.dataset.pdfY || 0) < picture.y);
          pageElement.insertBefore(picture.figure, following || null);
          if (!picture.figure.querySelector('figcaption') && following &&
            picture.bottom-Number(following.dataset.pdfY) >= -8 &&
            picture.bottom-Number(following.dataset.pdfY) <= 40 &&
            /^(?:Figure|Fig\.)\s*\d+/i.test(following.textContent.trim())) {
            const caption = document.createElement('figcaption'); caption.innerHTML = following.innerHTML;
            picture.figure.appendChild(caption); following.remove();
          }
        }
        if (pageNotes.length) {
          const notes = document.createElement('ol'); notes.append(...pageNotes); pageElement.appendChild(notes);
        }

        if (!pageElement.childNodes.length) {
          const empty =
            document.createElement('p');

          empty.textContent =
            `[Page ${pageNumber} contains no extractable text.]`;

          pageElement.appendChild(empty);
        }

        pages.push(pageElement);
      }

      // A reference and its footnote can occur on different PDF pages.
      const notesByNumber = new Map();
      for (const page of pages) for (const note of page.querySelectorAll('[data-pdf-note]')) {
        notesByNumber.set(String(note.value), note.id);
      }
      for (const page of pages) for (const link of page.querySelectorAll('[data-pdf-reference]')) {
        const id = notesByNumber.get(link.dataset.pdfReference);
        if (id) link.href = '#'+id;
        else link.replaceWith(document.createTextNode(link.textContent));
      }

      /*
       * PDF import produces editable HTML. Page markers are kept
       * in the HTML so the original page progression is not lost,
       * but EPUB chapter splitting can still use detected headings.
       */
      st.html = pages
        .map(page => page.outerHTML)
        .join('\n');
      // Keep temporary preview links out of the saved book model.
      for (const [path, image] of st.images) st.html = st.html.replaceAll(image.url, path);

      st.notes.push(
        'PDFs store text by position rather than as paragraphs. EC Doc Studio reconstructed the text into editable paragraphs; check line breaks, headings, columns, and special formatting before saving the EPUB.'
      );

      st.notes.push(
        `Preserved ${st.images.size} PDF pictures as PNG crops. Detected ${importedFootnotes} page footnotes; check their references and chapter-end notes against the original PDF. Complex columns and captions may still need review.`
      );

      const titleField =
        $('#bookTitle');

      if (titleField) {
        titleField.value =
          file.name.replace(/\.pdf$/i, '');
      }

      const authorField =
        $('#bookAuthor');

      if (authorField) {
        authorField.value = '';
      }

      showNotes();
      refresh();

      if (!st.chapters.length) {
        throw new Error(
          'The PDF was read, but no extractable text was found.'
        );
      }

      status(
        `Loaded ${file.name}. Review the reconstructed text before saving as EPUB.`
      );
    } catch (error) {
      console.error(
        'PDF import error:',
        error
      );

      status(
        'PDF error: ' +
        (
          error && error.message
            ? error.message
            : String(error)
        )
      );
    } finally {
      const input =
        $('#pdfEpubFile');

      if (input) {
        input.value = '';
      }
    }
  }
  
  async function openDocx(file) {
    if (!file) return;

    releaseResources();
    st.archive = null;
    st.packagePath = null;
    endEdit();

    status(
      'Reading Word document…'
    );

    st.external = false;

    st.images.forEach(image => {
      if (image.url) {
        URL.revokeObjectURL(
          image.url
        );
      }
    });

    st.images = new Map();
    st.notes = [];
    st.html = '';
    st.chapters = [];
    st.current = 0;

    try {
      if (
        typeof mammoth ===
        'undefined'
      ) {
        throw new Error(
          'The DOCX reader library ' +
          'did not load. Refresh the ' +
          'page and try again.'
        );
      }

      const arrayBuffer =
        await file.arrayBuffer();

      const result =
        await mammoth.convertToHtml(
          { arrayBuffer },
          {
            styleMap: [
              "p[style-name='Title'] => h1.book-title:fresh",
              "p[style-name='Subtitle'] => h2.book-subtitle:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh",
              "p[style-name='Caption'] => p.ec-word-caption:fresh"
],

            convertImage:
              mammoth.images.imgElement(
                async image => {
                  const ext =
                    EXT[
                      image.contentType
                    ];

                  if (!ext) {
                    throw new Error('This manuscript contains an unsupported picture type: ' + image.contentType + '. Convert that picture to PNG or JPEG and reopen the manuscript.');
                  }

                  const buffer =
                    await image
                      .readAsArrayBuffer();

                  const path =
                    `images/img-` +
                    `${st.images.size + 1}` +
                    `.${ext}`;

                  const blob =
                    new Blob(
                      [buffer],
                      {
                        type:
                          image.contentType
                      }
                    );

                  const url =
                    URL.createObjectURL(
                      blob
                    );

                  st.images.set(
                    path,
                    {
                      buf: buffer,
                      mime:
                        image.contentType,
                      url
                    }
                  );

                  return {
                    src: path
                  };
                }
              )
          }
        );
      
      st.html =
        normalizeFigures(
          result.value || ''
        );

      st.notes =
        (
          result.messages || []
        ).map(
          message =>
            message.message
        );

      const titleField =
        $('#bookTitle');

      if (titleField) {
        titleField.value =
          file.name.replace(
            /\.docx$/i,
            ''
          );
      }

      showNotes();
      refresh();

      if (
        !st.chapters.length
      ) {
        throw new Error(
          'The DOCX was read, ' +
          'but no document content ' +
          'was found.'
        );
      }

      status(
        `Loaded ${file.name}.`
      );
    } catch (error) {
      console.error(
        'DOCX import error:',
        error
      );

      status(
        'DOCX error: ' +
        (
          error &&
          error.message
            ? error.message
            : String(error)
        )
      );
    }
  }

  function beginEdit() {
    if (!st.chapters.length) {
      return;
    }

    const page =
      $('#bookPage');

    page.contentEditable =
      'true';

    page.focus();

        if ($('#editToolbar')) {
      $('#editToolbar').hidden =
        false;
    }
    
    if ($('#editChapter')) {
      $('#editChapter').hidden =
        true;
    }

    if ($('#saveChapter')) {
      $('#saveChapter').hidden =
        false;
    }

    if ($('#cancelEdit')) {
      $('#cancelEdit').hidden =
        false;
    }
  }

  function saveEdit() {
    if (!st.chapters.length) {
      return;
    }

    const page =
      $('#bookPage');

    const doc =
      new DOMParser()
        .parseFromString(
          '<!doctype html>' +
          '<html><body>' +
          page.innerHTML +
          '</body></html>',
          'text/html'
        );

    sanitize(doc);
    // Preview URLs are session-only. Store portable paths in the book model.
    restoreImagePaths(doc, st.chapters[st.current]);

    st.chapters[
      st.current
    ].nodes = [
      ...doc.body.childNodes
    ].map(
      node =>
        node.cloneNode(true)
    );
    st.chapters[st.current].edited = true;

    st.chapters[
      st.current
    ].title =
      doc.querySelector(
        'h1,h2,h3'
      )?.textContent.trim() ||
      st.chapters[
        st.current
      ].title;

    if (!st.external) {
      st.html =
        st.chapters
          .flatMap(
            chapter =>
              chapter.nodes
          )
          .map(
            node =>
              node.outerHTML ||
              esc(
                node.textContent ||
                ''
              )
          )
          .join('\n');

      st.doc =
        new DOMParser()
          .parseFromString(
            '<!doctype html>' +
            '<html><body>' +
            st.html +
            '</body></html>',
            'text/html'
          );
    }

    endEdit();
    render();

    status(
      'Chapter edits saved.'
    );
  }

  function endEdit() {
    const page =
      $('#bookPage');

    if (page) {
      page.contentEditable =
        'false';
    }

        if ($('#editToolbar')) {
      $('#editToolbar').hidden =
        true;
    }
    
    if ($('#editChapter')) {
      $('#editChapter').hidden =
        false;
    }

    if ($('#saveChapter')) {
      $('#saveChapter').hidden =
        true;
    }

    if ($('#cancelEdit')) {
      $('#cancelEdit').hidden =
        true;
    }
  }

   function editorPage() {
    const page = $('#bookPage');

    if (!page || !page.isContentEditable) {
      return null;
    }

    return page;
  }

  function runEditCommand(command) {
    const page = editorPage();

    if (!page) return;

    page.focus();

    try {
      document.execCommand(
        command,
        false,
        null
      );
    } catch (error) {
      console.warn(
        `Editor command ${command} failed:`,
        error
      );
    }
  }

  function undoChapterEdit() {
    runEditCommand('undo');
  }

  function redoChapterEdit() {
    runEditCommand('redo');
  }

  function cutChapterEdit() {
    runEditCommand('cut');
  }

  function copyChapterEdit() {
    const page = editorPage();

    if (!page) return;

    page.focus();

    try {
      document.execCommand(
        'copy',
        false,
        null
      );
    } catch (error) {
      console.warn(
        'Copy failed:',
        error
      );
    }
  }

  async function pasteChapterEdit() {
    const page = editorPage();

    if (!page) return;

    page.focus();

    try {
      if (
        navigator.clipboard &&
        navigator.clipboard.readText
      ) {
        const text =
          await navigator.clipboard.readText();

        if (!text) return;

        document.execCommand(
          'insertText',
          false,
          text
        );

        return;
      }
    } catch (error) {
      console.warn(
        'Clipboard paste permission was not available:',
        error
      );
    }

    /*
     * Some browsers do not allow a web page to read
     * the clipboard directly. Try the browser's normal
     * paste command as a fallback.
     */
    try {
      const worked =
        document.execCommand(
          'paste',
          false,
          null
        );

      if (!worked) {
        status(
          'Your browser blocked the Paste button. Click in the chapter and use Ctrl+V instead.'
        );
      }
    } catch (error) {
      status(
        'Your browser blocked the Paste button. Click in the chapter and use Ctrl+V instead.'
      );
    }
  }
  
  function bookCss() {
    return [
      'body{line-height:1.5;}',
      'p{margin:0 0 .7em;}',
      'img{max-width:100%;height:auto;}',
      'figure{break-inside:avoid;page-break-inside:avoid;margin:1em auto;}',
      'figcaption{margin-top:.4em;font-size:.92em;line-height:1.35;text-align:center;}',
      'h1,h2,h3{line-height:1.25;}'
    ].join('');
  }

  async function buildEpub() {
    try {
      if ($('#bookPage').isContentEditable) saveEdit();
      if (st.external) {
        await saveOpenedEpub();
        return;
      }
      if (
        typeof JSZip ===
        'undefined'
      ) {
        throw new Error(
          'The EPUB packaging ' +
          'library did not load.'
        );
      }

      if (!st.chapters.length) {
        throw new Error(
          'No book is loaded.'
        );
      }

      status(
        'Building EPUB…'
      );

      const zip =
        new JSZip();

      const lang =
        $('#bookLang')?.value ||
        'en';

      const bookTitle =
        $('#bookTitle')?.value ||
        'Untitled';

      const author =
        $('#bookAuthor')?.value ||
        '';

      const id =
        'urn:uuid:' +
        (
          crypto.randomUUID
            ? crypto.randomUUID()
            : Date.now()
        );

      zip.file(
        'mimetype',
        'application/epub+zip',
        {
          compression: 'STORE'
        }
      );

      zip.file(
        'META-INF/container.xml',
        '<?xml version="1.0"?>' +
        '<container version="1.0" ' +
        'xmlns="urn:oasis:names:' +
        'tc:opendocument:xmlns:' +
        'container">' +
        '<rootfiles>' +
        '<rootfile ' +
        'full-path="OEBPS/content.opf" ' +
        'media-type="' +
        'application/oebps-package+xml"/>' +
        '</rootfiles>' +
        '</container>'
      );

      const folder =
        zip.folder('OEBPS');

      folder.file(
        'styles.css',
        bookCss()
      );

      const manifest = [
        '<item id="nav" ' +
        'href="nav.xhtml" ' +
        'media-type="' +
        'application/xhtml+xml" ' +
        'properties="nav"/>',

        '<item id="css" ' +
        'href="styles.css" ' +
        'media-type="text/css"/>','<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>'
];

      const spine = [];
      const nav = [];
      const ncx = [];
      st.chapters.forEach(
        (chapter, index) => {
          const filename =
            `chapter-${index + 1}.xhtml`;

          const body =
            chapter.nodes
              .map(
                node =>
                  new XMLSerializer().serializeToString(node)
              )
              .join('\n');

          folder.file(
            filename,
            '<?xml version="1.0" ' +
            'encoding="utf-8"?>' +
            '<html ' +
            'xmlns="' +
            'http://www.w3.org/' +
            '1999/xhtml" ' +
            `lang="${esc(lang)}">` +
            '<head>' +
            `<title>${
              esc(
                chapterTitle(
                  chapter,
                  index
                )
              )
            }</title>` +
            '<link rel="stylesheet" ' +
            'href="styles.css"/>' +
            '</head>' +
            `<body>${body}</body>` +
            '</html>'
          );

          manifest.push(
            `<item id="c${index}" ` +
            `href="${filename}" ` +
            'media-type="' +
            'application/xhtml+xml"/>'
          );

          spine.push(
            `<itemref ` +
            `idref="c${index}"/>`
          );

          nav.push(
            `<li><a ` +
            `href="${filename}">` +
            `${
              esc(
                chapterTitle(
                  chapter,
                  index
                )
              )
            }` +
            '</a></li>'
          );ncx.push(
  '<navPoint id="navPoint-' +
  (index + 1) +
  '" playOrder="' +
  (index + 1) +
  '">' +
  '<navLabel><text>' +
  esc(
    chapterTitle(
      chapter,
      index
    )
  ) +
  '</text></navLabel>' +
  '<content src="' +
  filename +
  '"/>' +
  '</navPoint>'
);
        }
      );

      let imageIndex = 0;

      for (
        const [path, image]
        of st.images
      ) {
        imageIndex++;

        folder.file(
          path,
          image.buf
        );

        manifest.push(
          `<item ` +
          `id="img${imageIndex}" ` +
          `href="${path}" ` +
          `media-type="${
            image.mime
          }"/>`
        );
      }

      folder.file(
        'nav.xhtml',
        '<?xml version="1.0"?>' +
        '<html ' +
        'xmlns="' +
        'http://www.w3.org/' +
        '1999/xhtml" ' +
        'xmlns:epub="' +
        'http://www.idpf.org/' +
        '2007/ops">' +
        '<head>' +
        '<title>Contents</title>' +
        '</head>' +
        '<body>' +
        '<nav epub:type="toc">' +
        `<ol>${nav.join('')}</ol>` +
        '</nav>' +
        '</body>' +
        '</html>'
      );
      folder.file(
  'toc.ncx',
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">' +
  '<head>' +
  '<meta name="dtb:uid" content="' +
  esc(id) +
  '"/>' +
  '</head>' +
  '<docTitle><text>' +
  esc(bookTitle) +
  '</text></docTitle>' +
  '<navMap>' +
  ncx.join('') +
  '</navMap>' +
  '</ncx>'
);
      folder.file(
        'content.opf',
        '<?xml version="1.0"?>' +
        '<package ' +
        'xmlns="' +
        'http://www.idpf.org/' +
        '2007/opf" ' +
        'version="3.0" ' +
        'unique-identifier="id">' +
        '<metadata ' +
        'xmlns:dc="' +
        'http://purl.org/dc/' +
        'elements/1.1/">' +
        `<dc:identifier id="id">` +
        `${esc(id)}` +
        '</dc:identifier>' +
        `<dc:title>` +
        `${esc(bookTitle)}` +
        '</dc:title>' +
        `<dc:creator>` +
        `${esc(author)}` +
        '</dc:creator>' +
        `<dc:language>` +
        `${esc(lang)}` +
        '</dc:language>' +
        '<meta ' +
        'property="dcterms:modified">' +
        `${
          new Date()
            .toISOString()
            .replace(
              /\.\d+Z$/,
              'Z'
            )
        }` +
        '</meta>' +
        '</metadata>' +
        `<manifest>` +
        `${manifest.join('')}` +
        '</manifest>' +
        `<spine toc="ncx">` +
        `${spine.join('')}` +
        '</spine>' +
        '</package>'
      );

      const blob =
        await zip.generateAsync({
          type: 'blob',
          mimeType:
            'application/epub+zip'
        });

      const filename =
        (
          bookTitle
            .replace(
              /[^\w-]+/g,
              '-'
            )
            .replace(
              /^-+|-+$/g,
              ''
            ) ||
          'book'
        ) +
        '.epub';

      if (
        typeof window.saveBlob !==
        'function'
      ) {
        throw new Error(
          'The browser download ' +
          'helper is unavailable.'
        );
      }

      window.saveBlob(
        blob,
        filename
      );

      status(
        'EPUB saved.'
      );
    } catch (error) {
      console.error(
        'EPUB build error:',
        error
      );

      status(
        'EPUB error: ' +
        (
          error &&
          error.message
            ? error.message
            : String(error)
        )
      );
    }
  }

  function releaseResources() {
    st.resources.forEach(resource => URL.revokeObjectURL(resource.url));
    st.resources = new Map();
  }

  function archivePath(base, href) {
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) return null;
    const url = new URL(href, 'https://epub.invalid/' + base);
    return decodeURIComponent(url.pathname.slice(1));
  }

  function imageAttributes(root, transform) {
    const elements = [root, ...root.querySelectorAll('*')];
    for (const el of elements) {
      if (el.nodeType !== 1) continue;
      const name = el.localName?.toLowerCase();
      const attrs = name === 'img' ? ['src'] : name === 'image' ? ['href', 'xlink:href'] : [];
      for (const attr of attrs) {
        if (el.hasAttribute(attr)) el.setAttribute(attr, transform(el.getAttribute(attr)));
      }
      // Keep responsive image candidates portable as well as ordinary images.
      if ((name === 'img' || name === 'source') && el.hasAttribute('srcset')) {
        el.setAttribute('srcset', el.getAttribute('srcset').replace(/(^|,\s*)([^\s,]+)([^,]*)/g,
          (_, prefix, url, descriptor) => prefix + transform(url) + descriptor));
      }
      if (el.hasAttribute('style')) {
        el.setAttribute('style', el.getAttribute('style').replace(/url\(\s*(['"]?)(.*?)\1\s*\)/g,
          (_, quote, url) => 'url("' + transform(url) + '")'));
      }
    }
  }

  function previewImagePaths(root, chapter) {
    imageAttributes(root, href => {
      const path = archivePath(chapter.path, href);
      return st.resources.get(path)?.url || href;
    });
  }

  function restoreImagePaths(root, chapter) {
    const paths = new Map();
    if (st.external) {
      for (const [path, resource] of st.resources) {
        const from = chapter.path.split('/').slice(0, -1);
        const to = path.split('/');
        while (from.length && to.length && from[0] === to[0]) { from.shift(); to.shift(); }
        paths.set(resource.url, '../'.repeat(from.length) + to.map(encodeURIComponent).join('/'));
      }
    } else {
      for (const [path, image] of st.images) paths.set(image.url, path);
    }
    imageAttributes(root, href => paths.get(href) || href);
  }

  function parseXml(text, label) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error(label + ' contains invalid XML.');
    return doc;
  }

  async function saveOpenedEpub() {
    status('Saving EPUB with its original pictures…');
    // Clone the original archive so retries and later edits always start from it.
    const zip = await JSZip.loadAsync(st.archive);
    for (const chapter of st.chapters) {
      if (!chapter.edited) continue;
      const doc = parseXml(chapter.source, chapter.path);
      const body = doc.getElementsByTagNameNS('*', 'body')[0];
      if (!body) throw new Error('No body found in ' + chapter.path);
      const content = document.createElement('div');
      chapter.nodes.forEach(node => content.appendChild(node.cloneNode(true)));
      restoreImagePaths(content, chapter);
      body.replaceChildren(...[...content.childNodes].map(node => doc.importNode(node, true)));
      const xml = new XMLSerializer().serializeToString(doc);
      parseXml(xml, chapter.path);
      if (/blob:https?:/i.test(xml)) throw new Error('A temporary image link could not be saved. Reopen the book and try again.');
      zip.file(chapter.path, xml);
    }
    const packageDoc = parseXml(await zip.file(st.packagePath).async('text'), 'Book metadata');
    for (const [name, field] of [['title', '#bookTitle'], ['creator', '#bookAuthor'], ['language', '#bookLang']]) {
      const el = packageDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', name)[0];
      if (el) el.textContent = $(field).value;
    }
    zip.file(st.packagePath, new XMLSerializer().serializeToString(packageDoc));
    // EPUB requires the uncompressed mimetype entry to come first.
    const output = new JSZip();
    output.file('mimetype', 'application/epub+zip', {compression:'STORE'});
    for (const entry of Object.values(zip.files)) {
      if (entry.name !== 'mimetype' && !entry.dir) output.file(entry.name, await entry.async('uint8array'));
    }
    const blob = await output.generateAsync({type:'blob', mimeType:'application/epub+zip'});
    window.saveBlob(blob, ($('#bookTitle').value.replace(/[^\w-]+/g, '-') || 'book') + '.epub');
    status('EPUB saved with its pictures.');
  }

  async function openEpub(file) {
    if (!file) return;
    const resources = new Map();
    try {
      status('Opening EPUB and loading pictures…');
      const archive = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(archive);
      const containerFile = zip.file('META-INF/container.xml');
      if (!containerFile) throw new Error('This EPUB has no container file.');
      const container = parseXml(await containerFile.async('text'), 'EPUB container');
      const packagePath = container.querySelector('rootfile')?.getAttribute('full-path');
      const packageFile = packagePath && zip.file(packagePath);
      if (!packageFile) throw new Error('The EPUB package could not be found.');
      const packageDoc = parseXml(await packageFile.async('text'), 'EPUB package');
      const manifest = new Map([...packageDoc.querySelectorAll('manifest item')].map(item => [item.getAttribute('id'), item]));
      const notes = [];
      async function loadImage(path, mime) {
        if (resources.has(path)) return;
        const entry = zip.file(path);
        if (!entry) throw new Error('A picture is missing from this EPUB: ' + path);
        const bytes = await entry.async('uint8array');
        resources.set(path, {bytes, mime, url:URL.createObjectURL(new Blob([bytes], {type:mime}))});
      }
      for (const item of manifest.values()) {
        const mime = item.getAttribute('media-type') || '';
        if (!mime.startsWith('image/')) continue;
        const path = archivePath(packagePath, item.getAttribute('href'));
        if (!path) { notes.push('A linked picture is outside this EPUB and may need an internet connection.'); continue; }
        await loadImage(path, mime);
      }
      const chapters = [];
      for (const ref of packageDoc.querySelectorAll('spine itemref')) {
        const item = manifest.get(ref.getAttribute('idref'));
        const path = item && archivePath(packagePath, item.getAttribute('href'));
        const entry = path && zip.file(path);
        if (!entry) throw new Error('A chapter is missing from this EPUB.');
        const source = await entry.async('text');
        const doc = parseXml(source, path);
        const body = doc.getElementsByTagNameNS('*', 'body')[0];
        if (!body) throw new Error('A chapter has no readable body: ' + path);
        sanitize(doc);
        const references = [];
        imageAttributes(body, href => { references.push(href); return href; });
        for (const href of references) {
          if (href.startsWith('#')) continue;
          const imagePath = archivePath(path, href);
          if (!imagePath) continue;
          const extension = imagePath.split('.').pop().toLowerCase();
          const mime = Object.keys(EXT).find(type => EXT[type] === extension) || (extension === 'jpeg' ? 'image/jpeg' : 'application/octet-stream');
          await loadImage(imagePath, mime);
        }
        chapters.push({path, source, edited:false,
          title:doc.querySelector('h1,h2,h3')?.textContent.trim() || doc.querySelector('title')?.textContent.trim() || 'Chapter ' + (chapters.length + 1),
          nodes:[...body.childNodes].map(node => document.importNode(node, true))});
      }
      if (!chapters.length) throw new Error('No readable chapters were found.');
      // SVG cover files often wrap a raster image. Resolve their internal links
      // for the preview while leaving the original bytes in the saved archive.
      for (const [path, resource] of resources) {
        if (resource.mime !== 'image/svg+xml') continue;
        const svg = parseXml(new TextDecoder().decode(resource.bytes), path);
        sanitize(svg);
        imageAttributes(svg, href => {
          const nested = resources.get(archivePath(path, href));
          if (!nested) return href;
          let binary = '';
          for (let offset = 0; offset < nested.bytes.length; offset += 8192) {
            binary += String.fromCharCode(...nested.bytes.subarray(offset, offset + 8192));
          }
          return 'data:' + nested.mime + ';base64,' + btoa(binary);
        });
        URL.revokeObjectURL(resource.url);
        resource.url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], {type:resource.mime}));
      }
      releaseResources();
      st.images.forEach(image => URL.revokeObjectURL(image.url));
      st.images = new Map();
      st.resources = resources;
      st.archive = archive;
      st.packagePath = packagePath;
      st.chapters = chapters;
      st.notes = notes;
      st.external = true;
      st.current = 0;
      for (const [name, field, fallback] of [['title','#bookTitle',file.name.replace(/\.epub$/i,'')], ['creator','#bookAuthor',''], ['language','#bookLang','en']]) {
        $(field).value = packageDoc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', name)[0]?.textContent || fallback;
      }
      endEdit();
      render();
      showNotes();
      status('Opened ' + file.name + '. Pictures are included when you save as EPUB.');
    } catch (error) {
      resources.forEach(resource => URL.revokeObjectURL(resource.url));
      status('Could not open EPUB: ' + error.message);
    } finally { $('#openEpub').value = ''; }
  }

  const docxInput =
    $('#docxFile');

  const pdfInput =
    $('#pdfEpubFile');
  
  const epubInput =
    $('#openEpub');

  const splitSelect =
    $('#chapterSplit');

  const prev =
    $('#prevChapter');

  const next =
    $('#nextChapter');

  const edit =
    $('#editChapter');

  const save =
    $('#saveChapter');

  const cancel =
    $('#cancelEdit');

    const editToolbar =
    $('#editToolbar');

  const undoEdit =
    $('#undoEdit');

  const redoEdit =
    $('#redoEdit');

  const cutEdit =
    $('#cutEdit');

  const copyEdit =
    $('#copyEdit');

  const pasteEdit =
    $('#pasteEdit');
  
  const buildButton =
    $('#buildEpub');

  const size =
    $('#readerSize');

  const theme =
    $('#readerTheme');

  if (docxInput) {
    docxInput.onchange =
      event =>
        openDocx(
          event.target.files[0]
        );
  }

  if (pdfInput) {
    pdfInput.onchange =
      event =>
        openPdf(
          event.target.files[0]
        );
  }
  
  if (epubInput) {
    epubInput.onchange =
      event =>
        openEpub(
          event.target.files[0]
        );
  }

  if (splitSelect) {
    splitSelect.onchange =
      () => {
        st.current = 0;
        refresh();
      };
  }

  if (prev) {
    prev.onclick = () => {
      if (st.current > 0) {
        showChapter(st.current-1);
      }
    };
  }

  if (next) {
    next.onclick = () => {
      if (
        st.current <
        st.chapters.length - 1
      ) {
        showChapter(st.current+1);
      }
    };
  }

  if (edit) {
    edit.onclick =
      beginEdit;
  }

  if (save) {
    save.onclick =
      saveEdit;
  }

  if (cancel) {
    cancel.onclick = () => {
      endEdit();
      render();
    };
  }

    if (undoEdit) {
    undoEdit.onclick =
      undoChapterEdit;
  }

  if (redoEdit) {
    redoEdit.onclick =
      redoChapterEdit;
  }

  if (cutEdit) {
    cutEdit.onclick =
      cutChapterEdit;
  }

  if (copyEdit) {
    copyEdit.onclick =
      copyChapterEdit;
  }

  if (pasteEdit) {
    pasteEdit.onclick =
      pasteChapterEdit;
  }
  
  if (buildButton) {
    buildButton.onclick =
      buildEpub;
  }

  if (size) {
    size.oninput = event => {
      const page =
        $('#bookPage');

      if (page) {
        page.style.fontSize =
          (
            1.06 *
            Number(
              event.target.value
            ) /
            100
          ) +
          'rem';
      }
    };
  }

  if (theme) {
    theme.onclick = () => {
      document
        .querySelector('#epub')
        ?.classList.toggle(
          'reader-dark'
        );
    };
  }

  render();
})();
