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
    let current = {
      title: null,
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
        node.matches?.('img,svg') || node.querySelector?.('img,svg')
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
          endEdit();
          st.current = index;
          render();
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
              "p[style-name='Heading 1'] => h1:fresh",
              "p[style-name='Heading 2'] => h2:fresh",
              "p[style-name='Heading 3'] => h3:fresh"
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
        result.value || '';

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

  function bookCss() {
    return [
      'body{line-height:1.5;}',
      'p{margin:0 0 .7em;}',
      'img{max-width:100%;height:auto;}',
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
          title:doc.querySelector('h1,h2,h3')?.textContent.trim() || 'Chapter ' + (chapters.length + 1),
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
        endEdit();
        st.current--;
        render();
      }
    };
  }

  if (next) {
    next.onclick = () => {
      if (
        st.current <
        st.chapters.length - 1
      ) {
        endEdit();
        st.current++;
        render();
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
