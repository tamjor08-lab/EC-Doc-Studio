const tabs=[...document.querySelectorAll('.tab')],panes=[...document.querySelectorAll('.pane')];
function showPane(id){tabs.forEach(x=>x.classList.toggle('active',x.dataset.tab===id));panes.forEach(x=>x.classList.toggle('active',x.id===id));window.scrollTo({top:0,behavior:'smooth'});}
tabs.forEach(b=>b.onclick=()=>showPane(b.dataset.tab));document.querySelectorAll('.jump').forEach(b=>b.onclick=()=>showPane(b.dataset.go));
function downloadBlob(name,blob){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500);}
function downloadFile(name,type,text){downloadBlob(name,new Blob([text],{type}));}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
