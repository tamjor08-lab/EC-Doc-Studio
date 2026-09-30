const tabs=[...document.querySelectorAll('.tab')],panes=[...document.querySelectorAll('.pane')];
function showPane(id){tabs.forEach(x=>x.classList.toggle('active',x.dataset.tab===id));panes.forEach(x=>x.classList.toggle('active',x.id===id));}
tabs.forEach(b=>b.onclick=()=>showPane(b.dataset.tab));document.querySelectorAll('.jump').forEach(b=>b.onclick=()=>showPane(b.dataset.go));
function downloadFile(name,type,text){const u=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),500);}
function escapeHtml(s){return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}