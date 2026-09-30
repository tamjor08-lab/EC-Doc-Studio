const file=document.getElementById('bookFile'),editor=document.getElementById('editor'),info=document.getElementById('bookInfo'),drop=document.getElementById('drop');
function loadBookFile(f){if(!f)return;const r=new FileReader();r.onload=()=>{editor.value=r.result;info.textContent=`${f.name} • ${(f.size/1024).toFixed(1)} KB`;};r.readAsText(f);}
file.onchange=()=>loadBookFile(file.files[0]);
['dragenter','dragover'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.add('drag')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,x=>{x.preventDefault();drop.classList.remove('drag')}));
drop.addEventListener('drop',e=>loadBookFile(e.dataTransfer.files[0]));
function makePreview(){let raw=editor.value.trim(),html;if(!raw)html='<p>Nothing to preview yet.</p>';else if(/<[^>]+>/.test(raw))html=raw;else html=raw.split(/\n{2,}/).map(p=>`<p>${escapeHtml(p).replace(/\n/g,'<br>')}</p>`).join('');
 const wrap=document.createElement('div');wrap.innerHTML=html;const heads=[...wrap.querySelectorAll('h1,h2,h3')],toc=document.getElementById('toc');toc.innerHTML='';
 heads.forEach((h,i)=>{h.id=h.id||`section-${i+1}`;const a=document.createElement('a');a.href='#'+h.id;a.textContent=h.textContent;a.style.paddingLeft=((+h.tagName[1]-1)*10+9)+'px';toc.appendChild(a)});
 if(!heads.length)toc.innerHTML='<span class="small">Add H1, H2 or H3 headings to build navigation.</span>';document.getElementById('reader').innerHTML=wrap.innerHTML;
 toc.querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();document.getElementById(a.getAttribute('href').slice(1)).scrollIntoView({behavior:'smooth',block:'start'});});}
document.getElementById('previewBtn').onclick=makePreview;
document.getElementById('downloadHtml').onclick=()=>downloadFile('edited-book.html','text/html',editor.value);
document.getElementById('clearBtn').onclick=()=>{editor.value='';document.getElementById('reader').innerHTML='<p class="small">Your preview will appear here.</p>';document.getElementById('toc').innerHTML='<span class="small">Headings will appear here.</span>';info.textContent='No file selected.'};