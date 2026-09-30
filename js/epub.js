(function(){
  "use strict";
  var $ = function(s){ return document.querySelector(s); };
  var EXT = {"image/png":"png","image/jpeg":"jpg","image/gif":"gif","image/svg+xml":"svg","image/webp":"webp"};
  var state = { fileName:"", html:"", images:new Map(), notes:[], skipped:0, doc:null, chapters:[], current:0, cover:null, titleDirty:false, externalEpub:false };

  function esc(s){ return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
  function setStatus(msg, kind){ var el=$("#epubStatus"); el.textContent=msg||""; el.className = kind==="error" ? "error" : ""; }
  function kb(n){ return n<1024*1024 ? Math.max(1,Math.round(n/1024))+" KB" : (n/1024/1024).toFixed(1)+" MB"; }

  function langVal(){ var v=$("#bookLang").value.trim(); return /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]+)*$/.test(v) ? v : "en"; }
  function opts(){
    return { title:$("#bookTitle").value.trim(), author:$("#bookAuthor").value.trim(), lang:langVal(),
      split:$("#chapterSplit").value, toc:$("#includeToc").checked, font:$("#bookFont").value,
      para:$("#bookPara").value, lh:$("#bookLine").value, just:$("#bookJustify").checked };
  }

  /* ---------- CSS shared by preview and EPUB ---------- */
  function buildCss(R, preview){
    var o = opts();
    var fam = o.font==="serif" ? 'Georgia,"Times New Roman",serif'
            : o.font==="sans"  ? (preview ? "var(--sans)" : '"Helvetica Neue",Arial,sans-serif')
            : null;
    var ind = o.para==="indent";
    var css = "";
    css += R+"{"+(fam?"font-family:"+fam+";":"")+"line-height:"+o.lh+";text-align:"+(o.just?"justify":"left")+";"+(o.just?"hyphens:auto;-webkit-hyphens:auto;":"")+"}\n";
    css += R+" p{margin:"+(ind?"0":"0 0 1em")+";text-indent:"+(ind?"1.4em":"0")+";orphans:2;widows:2}\n";
    if(ind){
      css += R+" > p:first-child,"+R+" h1+p,"+R+" h2+p,"+R+" h3+p,"+R+" h4+p,"+R+" blockquote+p,"+R+" img+p,"+R+" hr+p,"+R+" table+p{text-indent:0}\n";
    }
    css += R+" h1,"+R+" h2,"+R+" h3,"+R+" h4,"+R+" h5,"+R+" h6{line-height:1.25;margin:1.4em 0 .6em;text-align:left;text-indent:0;font-weight:700;hyphens:none;-webkit-hyphens:none;page-break-after:avoid;break-after:avoid}\n";
    css += R+" h1{font-size:1.7em;margin-top:1em}"+R+" h2{font-size:1.35em}"+R+" h3{font-size:1.15em}"+R+" h4,"+R+" h5,"+R+" h6{font-size:1em}\n";
    css += R+" blockquote{margin:1em 1.5em}"+R+" blockquote p{text-indent:0}\n";
    css += R+" ul,"+R+" ol{margin:0 0 1em;padding-left:1.6em}"+R+" li{margin:.25em 0}\n";
    css += R+" img{max-width:100%;height:auto}\n";
    css += R+" table{border-collapse:collapse;margin:1em 0;width:100%}"+R+" td,"+R+" th{border:1px solid #888;padding:.3em .5em;text-align:left;vertical-align:top}\n";
    css += R+" .subtitle{font-style:italic;text-indent:0}\n";
    css += R+" sup,"+R+" sub{font-size:.75em;line-height:0}\n";
    css += R+" a{color:inherit;text-decoration:underline}\n";
    return css;
  }
  function updateCss(){ $("#bookcss").textContent = buildCss(".book-page", true); }

  /* ---------- Reading the document ---------- */
  function revokeImages(){
    state.images.forEach(function(im){ URL.revokeObjectURL(im.url); });
    state.images = new Map(); state.skipped = 0;
  }

  async function handleFile(file){
    if(!file) return;
    if(!/\.docx$/i.test(file.name)){ setStatus("That isn't a .docx file. In Word, choose Save As and pick Word Document (.docx).", "error"); return; }
    if(typeof mammoth==="undefined" || typeof JSZip==="undefined"){ setStatus("The converter libraries didn't load. Check your connection and reload the page.", "error"); return; }
    setStatus("Reading document…");
    revokeImages();
    try{
      var arrayBuffer = await file.arrayBuffer();
      var n = 0;
      var result = await mammoth.convertToHtml({arrayBuffer:arrayBuffer}, {
        styleMap:[
          "p[style-name='Title'] => p.book-title:fresh",
          "p[style-name='Subtitle'] => p.subtitle:fresh",
          "p[style-name='Quote'] => blockquote:fresh",
          "p[style-name='Intense Quote'] => blockquote:fresh",
          "p[style-name='Block Text'] => blockquote:fresh"
        ],
        convertImage: mammoth.images.imgElement(async function(image){
          var ext = EXT[image.contentType];
          if(!ext){ state.skipped++; return {src:""}; }
          var buf = await image.readAsArrayBuffer();
          n++;
          var path = "images/img-"+String(n).padStart(3,"0")+"."+ext;
          state.images.set(path, {buf:buf, mime:image.contentType, ext:ext, url:URL.createObjectURL(new Blob([buf],{type:image.contentType}))});
          return {src:path};
        })
      });
      state.html = result.value;
      state.notes = result.messages.map(function(m){ return m.message; });
      if(state.skipped) state.notes.push(state.skipped+" image"+(state.skipped===1?"":"s")+" in a format EPUB can't display (such as EMF or WMF) were left out.");
      state.fileName = file.name;
      if(!state.titleDirty || !$("#bookTitle").value){
        $("#bookTitle").value = file.name.replace(/\.docx$/i,"").replace(/[_]+/g," ").trim();
      }
      $("#docxDropTitle").textContent = file.name;
      $("#docxDropSub").textContent = kb(file.size)+". Click to choose a different file.";
      state.current = 0;
      refresh();
      renderNotes();
      setStatus("");
    }catch(err){
      console.error(err);
      setStatus("Couldn't read that file. Make sure it's a valid .docx and not password-protected.", "error");
    }
  }

  function sanitize(doc){
    doc.querySelectorAll("script,style,iframe,object,embed,link,meta,form").forEach(function(e){ e.remove(); });
    doc.querySelectorAll("*").forEach(function(e){
      Array.prototype.slice.call(e.attributes).forEach(function(a){ if(/^on/i.test(a.name)) e.removeAttribute(a.name); });
    });
    doc.querySelectorAll("a[href]").forEach(function(a){
      if(!/^(https?:|mailto:|#)/i.test(a.getAttribute("href").trim())) a.removeAttribute("href");
    });
    doc.querySelectorAll("img").forEach(function(img){
      var s = img.getAttribute("src")||"";
      if(!s) img.remove(); else if(!img.hasAttribute("alt")) img.setAttribute("alt","");
    });
  }

  function hasContent(ch){
    return ch.nodes.some(function(n){
      if(n.nodeType===3) return n.textContent.trim().length>0;
      if(n.nodeType!==1) return false;
      return n.textContent.trim().length>0 || n.querySelector("img") || n.tagName==="IMG" || n.tagName==="HR";
    });
  }

  function splitChapters(doc, mode){
    var isBreak = function(el){
      return mode==="h1" ? el.tagName==="H1" : mode==="h12" ? (el.tagName==="H1"||el.tagName==="H2") : false;
    };
    var out=[], cur={title:null,nodes:[]};
    Array.prototype.slice.call(doc.body.childNodes).forEach(function(node){
      if(node.nodeType===1 && isBreak(node)){
        if(hasContent(cur)) out.push(cur);
        cur = {title:node.textContent.trim()||"Untitled", nodes:[node]};
      } else { cur.nodes.push(node); }
    });
    if(hasContent(cur)) out.push(cur);
    out.forEach(function(ch){
      ch.words = ch.nodes.reduce(function(s,n){ return s + (n.textContent.trim().split(/\s+/).filter(Boolean).length); }, 0);
    });
    return out;
  }

  function chTitle(ch){
    if(ch.title) return ch.title;
    return $("#chapterSplit").value==="none" ? (opts().title || "Book") : "Front matter";
  }

  function refresh(){
    if(!state.html){ renderPage(); return; }
    var doc = new DOMParser().parseFromString("<!DOCTYPE html><body>"+state.html, "text/html");
    sanitize(doc);
    state.doc = doc;
    state.chapters = splitChapters(doc, $("#chapterSplit").value);
    if(state.current >= state.chapters.length) state.current = 0;
    renderSelect(); renderPage(); renderStats();
    $("#buildEpub").disabled = !state.chapters.length;
  }

  function renderSelect(){
    var sel=$("#chapterSelect"); sel.textContent="";
    state.chapters.forEach(function(ch,i){
      var o=document.createElement("option"); o.value=i; o.textContent=chTitle(ch); sel.appendChild(o);
    });
    sel.value = state.current;
    sel.disabled = !state.chapters.length;
    renderToc();
    $("#prevChapter").disabled = state.current<=0;
    $("#nextChapter").disabled = state.current>=state.chapters.length-1;
  }

  function renderToc(){
    var list=$("#bookToc"); list.textContent="";
    if(!state.chapters.length){ var sp=document.createElement("span"); sp.className="note"; sp.textContent="Chapters will appear here."; list.appendChild(sp); return; }
    state.chapters.forEach(function(ch,i){
      var b=document.createElement("button"); b.type="button"; b.className="toc-button"+(i===state.current?" active":""); b.textContent=chTitle(ch);
      b.addEventListener("click",function(){ state.current=i; renderSelect(); renderPage(); }); list.appendChild(b);
    });
  }

  function renderPage(){
    var page=$("#bookPage"); page.textContent="";
    if(!state.chapters.length){
      var hint=document.createElement("div"); hint.className="hint";
      hint.innerHTML="<h2>Your book will appear here</h2><div>Choose a .docx file and this page shows how each chapter will read with your typography settings.</div>";
      page.appendChild(hint); return;
    }
    var ch = state.chapters[state.current];
    ch.nodes.forEach(function(n){
      var c = n.cloneNode(true);
      if(c.nodeType===1){
        var imgs = c.tagName==="IMG" ? [c] : Array.prototype.slice.call(c.querySelectorAll("img"));
        imgs.forEach(function(img){ var im=state.images.get(img.getAttribute("src")); if(im) img.setAttribute("src", im.url); });
      }
      page.appendChild(c);
    });
    page.scrollTop = 0;
  }

  function usedImagePaths(){
    var set = new Set();
    state.chapters.forEach(function(ch){
      ch.nodes.forEach(function(n){
        if(n.nodeType!==1) return;
        if(n.tagName==="IMG") set.add(n.getAttribute("src"));
        n.querySelectorAll("img").forEach(function(i){ set.add(i.getAttribute("src")); });
      });
    });
    return set;
  }

  function renderStats(){
    var el=$("#bookStats");
    if(!state.chapters.length){ el.textContent=""; return; }
    var words = state.chapters.reduce(function(s,c){ return s+c.words; },0);
    var imgs = usedImagePaths().size + (state.cover?1:0);
    var n = state.chapters.length;
    var t = n+" chapter"+(n===1?"":"s")+", "+words.toLocaleString()+" words, "+imgs+" image"+(imgs===1?"":"s");
    if(n===1 && $("#chapterSplit").value!=="none") t += ". No matching headings were found, so the book is a single chapter. Apply Heading 1 or Heading 2 styles in Word, or change the chapter setting.";
    el.textContent = t;
  }

  function renderNotes(){
    var d=$("#conversionNotes"), list=$("#conversionList"); list.textContent="";
    if(!state.notes.length){ d.hidden=true; return; }
    var uniq = Array.from(new Set(state.notes));
    uniq.forEach(function(m){ var li=document.createElement("li"); li.textContent=m; list.appendChild(li); });
    $("#conversionSummary").textContent = uniq.length+" conversion note"+(uniq.length===1?"":"s");
    d.hidden=false;
  }

  /* ---------- Building the EPUB ---------- */
  function uuid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,function(c){ var r=Math.random()*16|0; return (c==="x"?r:(r&3|8)).toString(16); });
  }
  function chFile(i){ return "chapter-"+String(i+1).padStart(3,"0")+".xhtml"; }
  function xhtmlDoc(lang, title, body, bodyAttrs){
    return '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n'
      + '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="'+esc(lang)+'" xml:lang="'+esc(lang)+'">\n'
      + '<head><meta charset="utf-8"/><title>'+esc(title)+'</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>\n'
      + '<body'+(bodyAttrs||"")+'>\n'+body+'\n</body>\n</html>';
  }
  function cleanXml(s){ return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,""); }

  function chapterBody(ch, i, idMap){
    var div = state.doc.createElement("div");
    ch.nodes.forEach(function(n){ div.appendChild(n.cloneNode(true)); });
    div.querySelectorAll('a[href^="#"]').forEach(function(a){
      var id = a.getAttribute("href").slice(1);
      try{ id = decodeURIComponent(id); }catch(e){}
      var j = idMap.get(id);
      if(j===undefined) a.removeAttribute("href");
      else if(j!==i) a.setAttribute("href", chFile(j)+"#"+encodeURIComponent(id));
    });
    var xml = new XMLSerializer().serializeToString(div);
    var m = xml.match(/^<div[^>]*>([\s\S]*)<\/div>$/);
    return cleanXml(m ? m[1] : "");
  }

  async function buildEpub(){
    var o = opts();
    var title = o.title || "Untitled";
    var id = "urn:uuid:"+uuid();
    var modified = new Date().toISOString().replace(/\.\d+Z$/,"Z");
    var zip = new JSZip();
    zip.file("mimetype","application/epub+zip",{compression:"STORE"});
    zip.file("META-INF/container.xml",'<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    var z = zip.folder("OEBPS");
    z.file("styles.css", buildCss("body", false));

    var idMap = new Map();
    state.chapters.forEach(function(ch,i){
      ch.nodes.forEach(function(n){
        if(n.nodeType!==1) return;
        if(n.id) idMap.set(n.id,i);
        n.querySelectorAll("[id]").forEach(function(e){ idMap.set(e.id,i); });
      });
    });

    var manifest=[], spine=[];
    // cover
    if(state.cover){
      var cp = "images/cover."+state.cover.ext;
      z.file(cp, state.cover.buf.slice(0));
      z.file("cover.xhtml", xhtmlDoc(o.lang, title, '<div style="text-align:center"><img src="'+cp+'" alt="Cover" style="max-width:100%;height:auto"/></div>', ' epub:type="cover"'));
      manifest.push('<item id="cover-image" href="'+cp+'" media-type="'+state.cover.mime+'" properties="cover-image"/>');
      manifest.push('<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="cover"/>');
    }
    // nav (required by EPUB 3)
    var navItems = state.chapters.map(function(ch,i){ return '<li><a href="'+chFile(i)+'">'+esc(chTitle(ch))+'</a></li>'; }).join("\n");
    z.file("nav.xhtml", xhtmlDoc(o.lang, "Contents", '<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>\n'+navItems+'\n</ol></nav>'));
    manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
    if(o.toc) spine.push('<itemref idref="nav"/>');
    // ncx for older readers
    var ncxPoints = state.chapters.map(function(ch,i){
      return '<navPoint id="np'+(i+1)+'" playOrder="'+(i+1)+'"><navLabel><text>'+esc(chTitle(ch))+'</text></navLabel><content src="'+chFile(i)+'"/></navPoint>';
    }).join("\n");
    z.file("toc.ncx",'<?xml version="1.0" encoding="UTF-8"?>\n<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="'+id+'"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text>'+esc(title)+'</text></docTitle><navMap>\n'+ncxPoints+'\n</navMap></ncx>');
    manifest.push('<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>');
    manifest.push('<item id="css" href="styles.css" media-type="text/css"/>');
    // chapters
    state.chapters.forEach(function(ch,i){
      z.file(chFile(i), xhtmlDoc(o.lang, chTitle(ch), chapterBody(ch,i,idMap)));
      manifest.push('<item id="ch'+(i+1)+'" href="'+chFile(i)+'" media-type="application/xhtml+xml"/>');
      spine.push('<itemref idref="ch'+(i+1)+'"/>');
    });
    // images
    var n=0;
    usedImagePaths().forEach(function(p){
      var im = state.images.get(p); if(!im) return;
      n++;
      z.file(p, im.buf.slice(0));
      manifest.push('<item id="img'+n+'" href="'+p+'" media-type="'+im.mime+'"'+(im.mime==="image/svg+xml"?"":"")+'/>');
    });

    var opf = '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="'+esc(o.lang)+'">\n'
      + '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n'
      + '<dc:identifier id="bookid">'+id+'</dc:identifier>\n'
      + '<dc:title>'+esc(title)+'</dc:title>\n'
      + (o.author ? '<dc:creator>'+esc(o.author)+'</dc:creator>\n' : '')
      + '<dc:language>'+esc(o.lang)+'</dc:language>\n'
      + '<meta property="dcterms:modified">'+modified+'</meta>\n'
      + (state.cover ? '<meta name="cover" content="cover-image"/>\n' : '')
      + '</metadata>\n<manifest>\n'+manifest.join("\n")+'\n</manifest>\n<spine toc="ncx">\n'+spine.join("\n")+'\n</spine>\n</package>';
    z.file("content.opf", opf);

    return zip.generateAsync({type:"blob", mimeType:"application/epub+zip", compression:"DEFLATE", compressionOptions:{level:6}});
  }

  function fileName(){
    var base = (opts().title||"book").replace(/[^\p{L}\p{N}]+/gu,"-").replace(/^-+|-+$/g,"") || "book";
    return base+".epub";
  }
  function saveBlob(blob, filename){
    var url=URL.createObjectURL(blob);
    var a=document.createElement("a"); a.href=url; a.download=filename; a.style.display="none";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); },1500);
  }

  async function onBuild(){
    if(!state.chapters.length) return;
    var btn=$("#buildEpub"); btn.disabled=true; btn.textContent="Building…"; setStatus("");
    try{
      var blob = await buildEpub();
      saveBlob(blob,fileName());
      setStatus("Downloaded "+fileName()+".");
    }catch(err){
      console.error(err); setStatus("Couldn't build the EPUB. Try a different chapter setting or re-add the file.", "error");
    }finally{ btn.disabled=!state.chapters.length; btn.textContent="Download EPUB"; }
  }

  async function openEpub(file){
    if(!file) return;
    if(!/\.epub$/i.test(file.name)){ setStatus("Choose an EPUB file to open in the reader.","error"); return; }
    try{
      setStatus("Opening EPUB…"); revokeImages();
      var zip=await JSZip.loadAsync(await file.arrayBuffer());
      var container=await zip.file("META-INF/container.xml").async("text");
      var cm=container.match(/full-path=["']([^"']+)["']/i); if(!cm) throw new Error("No package file");
      var opfPath=cm[1], base=opfPath.includes("/")?opfPath.slice(0,opfPath.lastIndexOf("/")+1):"";
      var opf=await zip.file(opfPath).async("text"), odoc=new DOMParser().parseFromString(opf,"application/xml");
      var manifest=new Map(); Array.from(odoc.querySelectorAll("manifest item")).forEach(function(it){ manifest.set(it.getAttribute("id"),it.getAttribute("href")); });
      var spine=Array.from(odoc.querySelectorAll("spine itemref")).map(function(it){return it.getAttribute("idref");});
      var titleNode=odoc.querySelector("title, dc\:title"); if(titleNode) $("#bookTitle").value=titleNode.textContent.trim();
      var chapters=[];
      for(var i=0;i<spine.length;i++){
        var href=manifest.get(spine[i]); if(!href) continue; var full=base+decodeURIComponent(href.split("#")[0]); var f=zip.file(full); if(!f) continue;
        var html=await f.async("text"); var d=new DOMParser().parseFromString(html,"text/html"); sanitize(d);
        var h=d.querySelector("h1,h2,h3,title"); chapters.push({title:(h&&h.textContent.trim())||("Chapter "+(chapters.length+1)),nodes:Array.from(d.body.childNodes),words:d.body.textContent.trim().split(/\s+/).filter(Boolean).length});
      }
      state.doc=document.implementation.createHTMLDocument(""); state.chapters=chapters; state.current=0; state.externalEpub=true;
      renderSelect(); renderPage(); renderStats(); $("#buildEpub").disabled=true; setStatus("Opened "+file.name+" in the reader.");
    }catch(err){ console.error(err); setStatus("Couldn't open that EPUB. It may use a structure this simple reader doesn't support yet.","error"); }
  }


  /* ---------- Cover ---------- */
  async function onCover(file){
    if(!file) return;
    var mime = file.type, ext = EXT[mime];
    if(!(mime==="image/png"||mime==="image/jpeg")){ setStatus("Cover images must be PNG or JPEG.", "error"); return; }
    if(state.cover) URL.revokeObjectURL(state.cover.url);
    var buf = await file.arrayBuffer();
    state.cover = {buf:buf, mime:mime, ext:ext, url:URL.createObjectURL(new Blob([buf],{type:mime}))};
    var t=$("#coverThumb"); t.src=state.cover.url; t.hidden=false;
    setStatus(""); renderStats();
  }

  /* ---------- Wiring ---------- */
  var drop=$("#docxDrop");
  $("#docxFile").addEventListener("change", function(e){ handleFile(e.target.files[0]); });
  ["dragenter","dragover"].forEach(function(ev){ drop.addEventListener(ev,function(e){ e.preventDefault(); drop.classList.add("over"); }); });
  ["dragleave","drop"].forEach(function(ev){ drop.addEventListener(ev,function(e){ e.preventDefault(); drop.classList.remove("over"); }); });
  drop.addEventListener("drop", function(e){ handleFile(e.dataTransfer.files[0]); });
  $("#coverFile").addEventListener("change", function(e){ onCover(e.target.files[0]); });
  $("#openEpub").addEventListener("change", function(e){ openEpub(e.target.files[0]); });
  $("#bookTitle").addEventListener("input", function(){ state.titleDirty=true; if($("#chapterSplit").value==="none") renderSelect(); });
  $("#chapterSplit").addEventListener("change", function(){ state.current=0; refresh(); });
  ["font","para","lh","just"].forEach(function(id){ $("#"+id).addEventListener("change", updateCss); });
  $("#chapterSelect").addEventListener("change", function(e){ state.current=+e.target.value; renderSelect(); renderPage(); });
  $("#prevChapter").addEventListener("click", function(){ if(state.current>0){ state.current--; renderSelect(); renderPage(); } });
  $("#nextChapter").addEventListener("click", function(){ if(state.current<state.chapters.length-1){ state.current++; renderSelect(); renderPage(); } });
  $("#bookPage").addEventListener("click", function(e){ if(e.target.closest("a")) e.preventDefault(); });
  $("#buildEpub").addEventListener("click", onBuild);
  $("#readerSize").addEventListener("input",function(e){ $("#bookPage").style.fontSize=(1.0625*(+e.target.value/100))+"rem"; });
  $("#readerTheme").addEventListener("click",function(){
    var page=$("#bookPage"); var dark=page.classList.toggle("reader-dark"); this.textContent=dark?"Light reader":"Dark reader";
  });

  updateCss();
  renderPage();
})();
