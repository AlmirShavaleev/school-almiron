'use strict';

/* ═══════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════ */
const S = {
  sid: null,
  pages: 0,
  page: 0,
  scale: 2.0,          // render scale; display = natural/2 → 1 CSS px ≈ 1 PDF pt
  zoom: 1.0,           // display zoom of the page
  ver: 0,              // cache-bust version (bumped on page ops)
  dragPage: null,      // index of page being dragged in the organizer
  orgSel: 0,           // selected page in organizer
  pendingInsertAt: null, // where to insert appended files
  baseW: 0,            // page width  at zoom 1 (CSS px)
  baseH: 0,            // page height at zoom 1 (CSS px)
  tool: 'select',
  pageEls: [],         // [pageIdx] = [{id,type,x,y,...}]
  selId: null,
  history: [],
  redo: [],
  clip: null,
  fmt: { font: 'Arial', size: 16, bold: false, italic: false, under: false, color: '#000000' },
  dateFmt: 'dot',   // 'dot' = дд.мм.гггг  'slash' = дд/мм/гггг  'dash' = дд-мм-гггг
  sigLib: [],
  iniLib: [],
  stLib: [],
  selLib: {},          // {sig:'name', ini:'name', stamp:'name'}
};

/* ═══════════════════════════════════════════════════════
   DOM
═══════════════════════════════════════════════════════ */
const g = id => document.getElementById(id);
const pageWrap = g('page-wrap');
const pageImg  = g('page-img');
const viewer   = g('viewer');
const welcome  = g('welcome');
const thumbsEl = g('thumbs');

/* ═══════════════════════════════════════════════════════
   UNIQUE ID
═══════════════════════════════════════════════════════ */
let _id = 0;
const uid = () => 'e' + (++_id);

/* ═══════════════════════════════════════════════════════
   API
═══════════════════════════════════════════════════════ */
const api = {
  async upload(f) {
    const fd = new FormData(); fd.append('file', f);
    const r = await fetch('/api/upload', { method: 'POST', body: fd });
    if (!r.ok) {
      let detail = 'Не удалось открыть файл';
      try { detail = (await r.json()).detail || detail; } catch (e) {}
      throw new Error(detail);
    }
    return r.json();
  },
  pageUrl(n) { return `/api/page/${S.sid}/${n}?scale=${S.scale}&_=${S.ver}_${Date.now()}`; },
  thumbUrl(n){ return `/api/thumb/${S.sid}/${n}?_=${S.ver}`; },
  async export(body) {
    return fetch('/api/export', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  },
  async pageOp(op, page) {
    const r = await fetch(`/api/page_op/${S.sid}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op, page }),
    });
    if (!r.ok) { let d='Ошибка'; try { d=(await r.json()).detail||d; } catch(e){} throw new Error(d); }
    return r.json();
  },
  async pageMove(from, to) {
    const r = await fetch(`/api/page_op/${S.sid}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ op: 'move', page: from, to }),
    });
    if (!r.ok) { let d='Ошибка'; try { d=(await r.json()).detail||d; } catch(e){} throw new Error(d); }
    return r.json();
  },
  async append(file, at = -1) {
    const fd = new FormData(); fd.append('file', file); fd.append('at', String(at));
    const r = await fetch(`/api/append/${S.sid}`, { method: 'POST', body: fd });
    if (!r.ok) { let d='Не удалось добавить файл'; try { d=(await r.json()).detail||d; } catch(e){} throw new Error(d); }
    return r.json();
  },
  async getSigs()  { return (await fetch('/api/signatures')).json(); },
  async getInis()  { return (await fetch('/api/initials')).json(); },
  async getStamps(){ return (await fetch('/api/stamps')).json(); },
  async saveSig(name, blob) {
    const fd = new FormData(); fd.append('name', name); fd.append('file', blob, name+'.png');
    return (await fetch('/api/signatures', { method:'POST', body:fd })).json();
  },
  async delSig(n)   { await fetch(`/api/signatures/${enc(n)}`, { method:'DELETE' }); },
  async saveIni(o)  { await fetch('/api/initials', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(o) }); },
  async delIni(n)   { await fetch(`/api/initials/${enc(n)}`, { method:'DELETE' }); },
  async createTxtStamp(o) { return (await fetch('/api/stamps/text', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(o) })).json(); },
  async uploadStamp(name, f) {
    const fd = new FormData(); fd.append('name', name); fd.append('file', f);
    return (await fetch('/api/stamps/upload', { method:'POST', body:fd })).json();
  },
  async delStamp(n) { await fetch(`/api/stamps/${enc(n)}`, { method:'DELETE' }); },
};
const enc = s => encodeURIComponent(s);

/* ═══════════════════════════════════════════════════════
   UPLOAD PROGRESS BAR
═══════════════════════════════════════════════════════ */
function _showUploadBar(pct) {
  const wrap = g('upload-progress');
  const fill = g('upload-fill');
  wrap.style.display = 'block';
  wrap.style.opacity = '1';
  wrap.style.transition = '';
  if (pct === null) {
    wrap.classList.add('indeterminate');
  } else {
    wrap.classList.remove('indeterminate');
    fill.style.width = pct + '%';
  }
}

function _hideUploadBar() {
  const wrap = g('upload-progress');
  const fill = g('upload-fill');
  wrap.classList.remove('indeterminate');
  fill.style.width = '100%';
  setTimeout(() => {
    wrap.style.transition = 'opacity .4s ease';
    wrap.style.opacity = '0';
    setTimeout(() => {
      wrap.style.display = 'none';
      wrap.style.opacity = '1';
      wrap.style.transition = '';
      fill.style.width = '0%';
    }, 430);
  }, 160);
}

/* ═══════════════════════════════════════════════════════
   OPEN FILE
═══════════════════════════════════════════════════════ */
async function openFile(file) {
  let info;
  _showUploadBar(null);   // сразу показываем анимацию, не ждём progress-ивент
  g('file-name').value = `Загрузка: ${file.name}`;

  try {
    info = await new Promise((resolve, reject) => {
      const fd = new FormData();
      fd.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');

      // прогресс передачи файла: 0 → 70%
      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable)
          _showUploadBar(Math.round(e.loaded / e.total * 70));
      });
      // файл передан — сервер обрабатывает (конвертация LO и т.д.)
      xhr.upload.addEventListener('load', () => {
        _showUploadBar(null);   // indeterminate-анимация
        g('file-name').value = 'Обработка файла…';
      });
      // ответ сервера получен
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch { reject(new Error('Ошибка ответа сервера')); }
        } else {
          let d = 'Не удалось открыть файл';
          try { d = JSON.parse(xhr.responseText).detail || d; } catch {}
          reject(new Error(d));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Ошибка сети')));
      xhr.addEventListener('abort', () => reject(new Error('Загрузка отменена')));
      xhr.send(fd);
    });
  } catch (err) {
    _hideUploadBar();
    g('file-name').value = 'Файл не выбран';
    alert(err.message);
    return;
  }

  _hideUploadBar();
  S.sid   = info.sid;
  S.pages = info.pages;
  S.page  = 0;
  S.fileName = info.name;
  S.pageEls = Array.from({length: info.pages}, () => []);
  S.history = []; S.redo = []; S.selId = null;

  g('file-name').value = info.name;
  g('file-name').disabled = false;
  g('btn-export').disabled = false;
  g('export-fmt').disabled = false;
  g('btn-print').disabled  = false;
  g('btn-organize').disabled = false;

  welcome.classList.add('hide');
  g('page-sizer').style.display = 'block';
  g('navbar').style.display = 'flex';

  buildThumbs();
  await goPage(0);
}

/* ═══════════════════════════════════════════════════════
   THUMBNAILS
═══════════════════════════════════════════════════════ */
function buildThumbs() {
  thumbsEl.innerHTML = '';
  for (let i = 0; i < S.pages; i++) {
    const d = document.createElement('div');
    d.className = 'thumb' + (i === S.page ? ' active' : '');
    d.dataset.p = i;
    d.draggable = true;

    const card = document.createElement('div');
    card.className = 'thumb-card';
    const im = document.createElement('img');
    im.src = api.thumbUrl(i);
    card.appendChild(im);

    // action buttons (появляются при наведении)
    const acts = document.createElement('div');
    acts.className = 'thumb-acts';
    acts.innerHTML =
      `<button title="Дублировать" data-a="dup">⧉</button>` +
      `<button title="Повернуть"  data-a="rot">↻</button>` +
      `<button title="Удалить"    data-a="del">🗑</button>`;
    acts.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', async ev => {
        ev.stopPropagation();
        const a = b.dataset.a;
        S.page = i;          // операция применяется к этой странице
        if (a === 'dup') await doPageOp('duplicate');
        else if (a === 'rot') await doPageOp('rotate_cw');
        else if (a === 'del') await doPageOp('delete');
      });
    });
    card.appendChild(acts);

    const pn = document.createElement('div');
    pn.className = 'pn'; pn.textContent = i + 1;

    d.append(card, pn);
    d.addEventListener('click', () => goPage(i));

    // ── drag & drop reorder ──
    d.addEventListener('dragstart', e => {
      if (_moveBusy) { e.preventDefault(); return; }
      S.dragPage = i;
      d.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    d.addEventListener('dragend', () => {
      S.dragPage = null;
      d.classList.remove('dragging');
      thumbsEl.querySelectorAll('.thumb').forEach(t => t.classList.remove('drop-before','drop-after'));
    });
    d.addEventListener('dragover', e => {
      e.preventDefault();
      if (S.dragPage === null || S.dragPage === i) return;
      const r = d.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      d.classList.toggle('drop-after', after);
      d.classList.toggle('drop-before', !after);
    });
    d.addEventListener('dragleave', () => d.classList.remove('drop-before','drop-after'));
    d.addEventListener('drop', async e => {
      e.preventDefault();
      const from = S.dragPage;
      S.dragPage = null;
      if (from === null || from === i) return;
      const r = d.getBoundingClientRect();
      const after = (e.clientY - r.top) > r.height / 2;
      let to = after ? i + 1 : i;
      if (from < to) to--;               // компенсация удаления исходного
      await movePage(from, to);
    });

    thumbsEl.appendChild(d);
  }

  // плитка «+ Добавить файлы»
  const add = document.createElement('div');
  add.className = 'thumb-add';
  add.innerHTML = `<div class="plus">+</div><div class="add-txt">Добавить<br>файлы</div>`;
  add.title = 'PDF, изображение, Word, Excel, PowerPoint';
  add.addEventListener('click', () => g('append-input').click());
  thumbsEl.appendChild(add);
}

/* ═══════════════════════════════════════════════════════
   GO TO PAGE
═══════════════════════════════════════════════════════ */
async function goPage(n) {
  syncActiveText();
  if (S.sid) saveDrawLayer();   // сохраняем рисунок текущей страницы

  S.page = n;
  document.querySelectorAll('.thumb').forEach(el =>
    el.classList.toggle('active', +el.dataset.p === n));

  const img = new Image();
  img.src = api.pageUrl(n);
  await new Promise(r => { img.onload = r; img.onerror = r; });

  // если картинка не загрузилась — не сбрасываем размеры, показываем ошибку
  if (!img.naturalWidth || !img.naturalHeight) {
    console.error('Не удалось загрузить страницу', n);
    return;
  }

  const W = Math.round(img.naturalWidth  / S.scale);
  const H = Math.round(img.naturalHeight / S.scale);

  S.baseW = W;
  S.baseH = H;

  pageImg.src = img.src;
  pageImg.style.width  = W + 'px';
  pageImg.style.height = H + 'px';
  pageWrap.style.width  = W + 'px';
  pageWrap.style.height = H + 'px';

  applyZoom();
  initDrawCanvas();
  renderElements();
  updateNav();
}

/* ═══════════════════════════════════════════════════════
   ZOOM & NAVIGATION
═══════════════════════════════════════════════════════ */
function applyZoom() {
  pageWrap.style.transform = `scale(${S.zoom})`;
  g('page-sizer').style.width  = (S.baseW * S.zoom) + 'px';
  g('page-sizer').style.height = (S.baseH * S.zoom) + 'px';
  g('nav-zoom').textContent = Math.round(S.zoom * 100) + '%';
}

function setZoom(z) {
  S.zoom = Math.min(3, Math.max(0.25, +z.toFixed(2)));
  applyZoom();
  if (DC.type === 'eraser' && S.tool === 'draw') updateEraserCursor();
}

function updateNav() {
  g('nav-info').textContent = `${S.page + 1} / ${S.pages}`;
  g('nav-prev').disabled = S.page <= 0;
  g('nav-next').disabled = S.page >= S.pages - 1;
}

g('nav-prev').addEventListener('click', () => { if (S.page > 0) goPage(S.page - 1); });
g('nav-next').addEventListener('click', () => { if (S.page < S.pages - 1) goPage(S.page + 1); });
g('nav-zoom-in').addEventListener('click',  () => setZoom(S.zoom + 0.1));
g('nav-zoom-out').addEventListener('click', () => setZoom(S.zoom - 0.1));

/* ── Page operations ── */
async function doPageOp(op) {
  if (!S.sid) return;
  syncActiveText();
  const p = S.page;

  if (op === 'delete' && !confirm('Удалить эту страницу?')) return;

  let res;
  try { res = await api.pageOp(op, p); }
  catch (e) { alert(e.message); return; }

  // синхронизируем наложения клиента с новым порядком страниц
  if (op === 'duplicate') {
    const copy = (S.pageEls[p] || []).map(el => ({ ...JSON.parse(JSON.stringify(el)), id: uid() }));
    S.pageEls.splice(p + 1, 0, copy);
  } else if (op === 'delete') {
    S.pageEls.splice(p, 1);
  }
  // rotate_* — наложения не трогаем

  S.pages = res.pages;
  S.ver++;                       // сброс кэша картинок/миниатюр

  let target = p;
  if (op === 'duplicate') target = p + 1;
  if (op === 'delete') {
    if (S.pages === 0) {
      // последняя страница удалена — возвращаем в исходное состояние
      S.sid = null; S.pages = 0; S.page = 0;
      S.pageEls = []; S.history = []; S.redo = []; S.selId = null;
      g('file-name').value = 'Файл не выбран';
      g('file-name').disabled = true;
      g('btn-export').disabled = true;
      g('export-fmt').disabled = true;
      g('btn-print').disabled = true;
      g('btn-organize').disabled = true;
      g('navbar').style.display = 'none';
      g('page-sizer').style.display = 'none';
      welcome.classList.remove('hide');
      thumbsEl.innerHTML = '';
      return;
    }
    target = Math.min(p, S.pages - 1);
  }

  refreshPages();
  await goPage(target);
}


/* ── Move (reorder) page ── */
let _moveBusy = false;
async function movePage(from, to) {
  if (from === to || _moveBusy) return;
  _moveBusy = true;
  syncActiveText();
  try { await api.pageMove(from, to); }
  catch (e) { alert(e.message); _moveBusy = false; return; }

  const [moved] = S.pageEls.splice(from, 1);
  S.pageEls.splice(to, 0, moved);

  S.ver++;
  S.page = to;
  refreshPages();
  _moveBusy = false;
  // если органайзер открыт — goPage вызовет closeOrganizer, не дублируем
  if (g('organizer').style.display === 'none') {
    await goPage(to);
  }
}

/* ── Append files (merge), optionally at a position ── */
async function appendFiles(files, at = -1) {
  if (!S.sid || !files.length) return;
  let firstNew = null;
  for (const f of files) {
    try {
      const res = await api.append(f, at);
      const insertAt = res.at;
      const blanks = Array.from({ length: res.added }, () => []);
      S.pageEls.splice(insertAt, 0, ...blanks);
      S.pages = res.pages;
      if (firstNew === null && res.added > 0) firstNew = insertAt;
      if (at >= 0) at = insertAt + res.added;   // следующий файл — за предыдущим
    } catch (e) { alert(e.message); }
  }
  S.ver++;
  refreshPages();
  if (firstNew !== null) await goPage(firstNew);
  else updateNav();
}

g('append-input').addEventListener('change', e => {
  const files = [...e.target.files];
  const at = (S.pendingInsertAt ?? -1);
  S.pendingInsertAt = null;
  e.target.value = '';
  appendFiles(files, at);
});

/* Обновить и левую панель миниатюр, и организатор (если открыт). */
function refreshPages() {
  buildThumbs();
  if (g('organizer').style.display !== 'none') buildOrganizer();
}

/* ═══════════════════════════════════════════════════════
   ORGANIZER (полноэкранный режим)
═══════════════════════════════════════════════════════ */
function openOrganizer() {
  if (!S.sid) return;
  syncActiveText();
  S.orgSel = S.page;
  g('organizer').style.display = 'flex';
  buildOrganizer();
}
function closeOrganizer() {
  g('organizer').style.display = 'none';
  goPage(Math.min(S.page, S.pages - 1));
}

function buildOrganizer() {
  const grid = g('org-grid');
  grid.innerHTML = '';

  for (let i = 0; i < S.pages; i++) {
    // кнопка "+" перед каждой страницей — вставка файла сюда
    grid.appendChild(makeOrgPlus(i));

    const card = document.createElement('div');
    card.className = 'org-card' + (i === S.orgSel ? ' sel' : '');
    card.dataset.p = i;
    card.draggable = true;

    const thumb = document.createElement('div');
    thumb.className = 'org-thumb';
    const img = document.createElement('img');
    img.src = api.thumbUrl(i);
    thumb.appendChild(img);

    const acts = document.createElement('div');
    acts.className = 'org-acts';
    acts.innerHTML =
      `<button title="Дублировать" data-a="dup">⧉</button>` +
      `<button title="Повернуть"  data-a="rot">↻</button>` +
      `<button title="Удалить"    data-a="del">🗑</button>`;
    acts.querySelectorAll('button').forEach(b =>
      b.addEventListener('click', async ev => {
        ev.stopPropagation();
        S.page = i;
        const a = b.dataset.a;
        if (a === 'dup') await doPageOp('duplicate');
        else if (a === 'rot') await doPageOp('rotate_cw');
        else if (a === 'del') await doPageOp('delete');
        S.orgSel = Math.min(S.page, S.pages - 1);
      }));
    thumb.appendChild(acts);

    const pn = document.createElement('div');
    pn.className = 'org-pn'; pn.textContent = i + 1;

    card.append(thumb, pn);
    card.addEventListener('click', () => {
      S.orgSel = i;
      grid.querySelectorAll('.org-card').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
    });
    card.addEventListener('dblclick', () => { S.page = i; closeOrganizer(); });

    // drag & drop (горизонтально)
    card.addEventListener('dragstart', e => {
      if (_moveBusy) { e.preventDefault(); return; }
      S.dragPage = i; card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      S.dragPage = null;
      card.classList.remove('dragging');
      grid.querySelectorAll('.org-card').forEach(c => c.classList.remove('drop-before','drop-after'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault();
      if (S.dragPage === null || S.dragPage === i) return;
      const r = card.getBoundingClientRect();
      const after = (e.clientX - r.left) > r.width / 2;
      card.classList.toggle('drop-after', after);
      card.classList.toggle('drop-before', !after);
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before','drop-after'));
    card.addEventListener('drop', async e => {
      e.preventDefault();
      const from = S.dragPage; S.dragPage = null;
      if (from === null || from === i) return;
      const r = card.getBoundingClientRect();
      const after = (e.clientX - r.left) > r.width / 2;
      let to = after ? i + 1 : i;
      if (from < to) to--;
      S.orgSel = to;
      await movePage(from, to);
    });

    grid.appendChild(card);
  }

  // "+" в самом конце
  grid.appendChild(makeOrgPlus(S.pages));

  // плитка добавления файлов
  const tile = document.createElement('div');
  tile.className = 'org-add-tile';
  tile.innerHTML = `<div class="plus">+</div><div class="txt">Добавьте файлы PDF,<br>изображение, Word,<br>Excel и PowerPoint</div>`;
  tile.addEventListener('click', () => { S.pendingInsertAt = -1; g('append-input').click(); });
  grid.appendChild(tile);
}

function makeOrgPlus(index) {
  const plus = document.createElement('button');
  plus.className = 'org-plus';
  plus.textContent = '+';
  plus.title = 'Добавить файл сюда';
  plus.addEventListener('click', () => { S.pendingInsertAt = index; g('append-input').click(); });
  return plus;
}

g('btn-organize').addEventListener('click', openOrganizer);
g('org-close').addEventListener('click', closeOrganizer);
g('org-done').addEventListener('click', closeOrganizer);
g('org-add').addEventListener('click', () => { S.pendingInsertAt = -1; g('append-input').click(); });
g('org-rot-ccw').addEventListener('click', async () => { S.page = S.orgSel; await doPageOp('rotate_ccw'); S.orgSel = S.page; });
g('org-rot-cw').addEventListener('click',  async () => { S.page = S.orgSel; await doPageOp('rotate_cw');  S.orgSel = S.page; });

/* ═══════════════════════════════════════════════════════
   ELEMENTS LIST (current page)
═══════════════════════════════════════════════════════ */
function els() { return S.pageEls[S.page] || []; }

/* ═══════════════════════════════════════════════════════
   RENDER ALL ELEMENTS (rebuild DOM)
═══════════════════════════════════════════════════════ */
function renderElements() {
  pageWrap.querySelectorAll('.doc-el').forEach(e => e.remove());
  for (const el of els()) {
    pageWrap.appendChild(makeDOM(el));
  }
  if (S.selId) {
    const d = pageWrap.querySelector(`[data-id="${S.selId}"]`);
    if (d) d.classList.add('sel');
  }
}

/* ═══════════════════════════════════════════════════════
   MAKE DOM ELEMENT
═══════════════════════════════════════════════════════ */
function makeDOM(el) {
  const div = document.createElement('div');
  div.className = 'doc-el';
  div.dataset.id   = el.id;
  div.dataset.type = el.type;
  div.style.left = el.x + 'px';
  div.style.top  = el.y + 'px';

  if (el.type === 'text' || el.type === 'date' || el.type === 'ini') {
    div.style.width = el.w ? el.w + 'px' : 'auto';
    const span = document.createElement('div');
    span.className = 'el-text';
    span.contentEditable = 'false';
    span.style.fontFamily = el.font || 'Arial';
    span.style.fontSize   = (el.size || 16) + 'px';
    span.style.fontWeight = el.bold   ? 'bold'   : 'normal';
    span.style.fontStyle  = el.italic ? 'italic' : 'normal';
    span.style.textDecoration = el.under ? 'underline' : 'none';
    span.style.color      = el.color || '#000';
    span.textContent      = el.text || '';
    div.appendChild(span);
  } else {
    // signature / stamp
    div.style.width  = (el.w || 160) + 'px';
    div.style.height = (el.h || 60)  + 'px';
    const img = document.createElement('img');
    img.className = 'el-img';
    img.src = el.src;
    div.appendChild(img);
    // resize handle
    const rh = document.createElement('div');
    rh.className = 'resize-se';
    rh.addEventListener('mousedown', onResizeStart);
    div.appendChild(rh);
  }

  // drag on the wrapper
  div.addEventListener('mousedown', onElMouseDown);
  // double-click → edit text
  div.addEventListener('dblclick', onElDblClick);

  return div;
}

/* ═══════════════════════════════════════════════════════
   DRAG / RESIZE
═══════════════════════════════════════════════════════ */
let drag = null;

function onElMouseDown(e) {
  if (e.target.classList.contains('resize-se')) return;
  if (e.target.contentEditable === 'true') return;
  e.preventDefault();
  e.stopPropagation();

  const div  = e.currentTarget;
  const id   = div.dataset.id;
  selectEl(id);

  const wr = pageWrap.getBoundingClientRect();
  drag = {
    type: 'move',
    div,
    id,
    ox: (e.clientX - wr.left) / S.zoom - div.offsetLeft,
    oy: (e.clientY - wr.top)  / S.zoom - div.offsetTop,
    sx: div.offsetLeft,
    sy: div.offsetTop,
  };
}

function onResizeStart(e) {
  e.preventDefault();
  e.stopPropagation();
  const div = e.target.closest('.doc-el');
  drag = {
    type: 'resize',
    div,
    id: div.dataset.id,
    ox: e.clientX,
    oy: e.clientY,
    sw: div.offsetWidth,
    sh: div.offsetHeight,
  };
}

document.addEventListener('mousemove', e => {
  if (!drag) return;
  if (drag.type === 'move') {
    const wr = pageWrap.getBoundingClientRect();
    const x = (e.clientX - wr.left) / S.zoom - drag.ox;
    const y = (e.clientY - wr.top)  / S.zoom - drag.oy;
    drag.div.style.left = x + 'px';
    drag.div.style.top  = y + 'px';
  } else {
    const w = Math.max(40, drag.sw + (e.clientX - drag.ox) / S.zoom);
    const h = Math.max(20, drag.sh + (e.clientY - drag.oy) / S.zoom);
    drag.div.style.width  = w + 'px';
    drag.div.style.height = h + 'px';
  }
});

document.addEventListener('mouseup', () => {
  if (!drag) return;
  const div = drag.div;
  const el  = els().find(e => e.id === drag.id);
  if (el) {
    if (drag.type === 'move') {
      const moved = div.offsetLeft !== drag.sx || div.offsetTop !== drag.sy;
      if (moved) {
        pushHistory();
        el.x = div.offsetLeft;
        el.y = div.offsetTop;
      }
    } else {
      pushHistory();
      el.w = div.offsetWidth;
      el.h = div.offsetHeight;
    }
  }
  drag = null;
});

/* ═══════════════════════════════════════════════════════
   DOUBLE-CLICK TO EDIT TEXT
═══════════════════════════════════════════════════════ */
function onElDblClick(e) {
  const div  = e.currentTarget;
  const type = div.dataset.type;
  if (type !== 'text' && type !== 'date' && type !== 'ini') return;
  e.stopPropagation();

  const el = els().find(x => x.id === div.dataset.id);
  if (!el) return;
  pushHistory();
  selectEl(el.id);
  S.fmtBarLock = true;
  g('fmt-bar').classList.add('show');
  startEditing(div, el, false);
}

/* ═══════════════════════════════════════════════════════
   CLICK ON PAGE BACKGROUND
═══════════════════════════════════════════════════════ */
pageWrap.addEventListener('mousedown', e => {
  if (e.target !== pageWrap && e.target !== pageImg) return;

  // prevent the browser from stealing focus away from a contenteditable
  if (S.tool !== 'select') e.preventDefault();

  deselect();

  if (!S.sid) return;
  const rect = pageWrap.getBoundingClientRect();
  const x = (e.clientX - rect.left) / S.zoom;
  const y = (e.clientY - rect.top)  / S.zoom;

  if (S.tool === 'text') {
    placeText(x, y);
  } else if (S.tool === 'date') {
    placeDate(x, y);
  } else if (S.tool === 'check') {
    placeSymbol(x, y, '✓', '#1a8a1a');
  } else if (S.tool === 'cross') {
    placeSymbol(x, y, '✗', '#cc0000');
  } else if (S.tool === 'arrow') {
    placeSymbol(x, y, '→', S.fmt.color);
  } else if (S.tool === 'sig') {
    placeSig(x, y);
  } else if (S.tool === 'ini') {
    placeIni(x, y);
  } else if (S.tool === 'stamp') {
    placeStamp(x, y);
  }
});

/* ═══════════════════════════════════════════════════════
   PLACE ELEMENTS
═══════════════════════════════════════════════════════ */
function placeText(x, y) {
  const id  = uid();
  const el  = { id, type:'text', text:'', x, y, font: S.fmt.font, size: S.fmt.size, bold: S.fmt.bold, italic: S.fmt.italic, under: S.fmt.under, color: S.fmt.color };
  pushHistory();
  els().push(el);
  const dom = makeDOM(el);
  pageWrap.appendChild(dom);

  S.selId = id;
  dom.classList.add('sel');
  S.fmtBarLock = true;             // keep format bar visible while typing
  g('fmt-bar').classList.add('show');
  syncFmtBar(el);

  startEditing(dom, el, true);
  setTool('select');
}

/* Make a text element editable and focus it. */
function startEditing(dom, el, removeIfEmpty) {
  const span = dom.querySelector('.el-text');
  span.contentEditable = 'true';
  S.editId = el.id;

  // focus on next frame so the browser doesn't steal it back
  requestAnimationFrame(() => {
    span.focus();
    // place caret at end
    const range = document.createRange();
    range.selectNodeContents(span);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const finish = () => {
    span.contentEditable = 'false';
    S.editId = null;
    el.text = span.textContent;
    if (removeIfEmpty && !el.text.trim()) {
      S.pageEls[S.page] = els().filter(e => e.id !== el.id);
      dom.remove();
      S.selId = null;
    }
  };

  span.addEventListener('blur', finish, { once: true });
  span.addEventListener('keydown', ke => {
    if (ke.key === 'Escape') { ke.preventDefault(); span.blur(); }
  });
}

function placeDate(x, y) {
  const d = new Date();
  const sep = S.dateFmt === 'slash' ? '/' : S.dateFmt === 'dash' ? '-' : '.';
  const txt = `${pad(d.getDate())}${sep}${pad(d.getMonth()+1)}${sep}${d.getFullYear()}`;
  const id = uid();
  const el = { id, type:'date', text: txt, x, y, font: S.fmt.font, size: S.fmt.size, bold: S.fmt.bold, italic: S.fmt.italic, under: S.fmt.under, color: S.fmt.color };
  pushHistory();
  els().push(el);
  pageWrap.appendChild(makeDOM(el));
  // выделяем без показа fmt-bar (чтобы страница не прыгала)
  S.selId = id;
  pageWrap.querySelector(`[data-id="${id}"]`)?.classList.add('sel');
  setTool('select');
}

function placeSymbol(x, y, char, color) {
  const id = uid();
  const el = { id, type: 'date', text: char, x, y,
    font: S.fmt.font, size: S.fmt.size || 24,
    bold: true, italic: false, under: false,
    color: color };
  pushHistory();
  els().push(el);
  pageWrap.appendChild(makeDOM(el));
  S.selId = id;
  pageWrap.querySelector(`[data-id="${id}"]`)?.classList.add('sel');
  setTool('select');
}

function placeSig(x, y) {
  const nm = S.selLib.sig;
  if (!nm) { alert('Выбери подпись в панели справа'); return; }
  const s = S.sigLib.find(s => s.name === nm);
  if (!s) return;
  const id = uid();
  addEl({ id, type:'sig', src: s.path, x, y, w: 160, h: 60 });
  setTool('select');
}

function placeIni(x, y) {
  const nm = S.selLib.ini;
  if (!nm) { alert('Выбери инициалы в панели справа'); return; }
  const ini = S.iniLib.find(i => i.name === nm);
  if (!ini) return;
  const id = uid();
  addEl({ id, type:'ini', text: ini.text, x, y, font: S.fmt.font, size: S.fmt.size, bold: S.fmt.bold, italic: S.fmt.italic, under: S.fmt.under, color: S.fmt.color });
  setTool('select');
}

function placeStamp(x, y) {
  const nm = S.selLib.stamp;
  if (!nm) { alert('Выбери печать в панели справа'); return; }
  const st = S.stLib.find(s => s.name === nm);
  if (!st) return;
  const id = uid();
  addEl({ id, type:'stamp', src: st.path, x, y, w: 200, h: 80 });
  setTool('select');
}

function addEl(el) {
  pushHistory();
  els().push(el);
  const dom = makeDOM(el);
  pageWrap.appendChild(dom);
  selectEl(el.id);
}

/* ═══════════════════════════════════════════════════════
   SELECTION
═══════════════════════════════════════════════════════ */
function selectEl(id) {
  deselect();
  S.selId = id;
  const dom = pageWrap.querySelector(`[data-id="${id}"]`);
  if (dom) dom.classList.add('sel');

  // show format bar if text (не для date — иначе страница прыгает при вставке)
  const el = els().find(e => e.id === id);
  if (el && (el.type === 'text' || el.type === 'ini')) {
    S.fmtBarLock = true;
    g('fmt-bar').classList.add('show');
    syncFmtBar(el);
  } else if (el && el.type === 'date') {
    syncFmtBar(el);  // синхронизируем значения без показа панели
  }
}

function deselect() {
  syncActiveText();
  S.selId = null;
  S.fmtBarLock = false;
  pageWrap.querySelectorAll('.doc-el.sel').forEach(d => d.classList.remove('sel'));
  if (S.tool !== 'text') g('fmt-bar').classList.remove('show');
}

function syncActiveText() {
  const active = pageWrap.querySelector('.el-text[contenteditable="true"]');
  if (active) {
    active.blur();
  }
}

/* ═══════════════════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════════════════ */
function pushHistory() {
  S.history.push(JSON.stringify(S.pageEls));
  S.redo = [];
}

function undo() {
  if (!S.history.length) return;
  S.redo.push(JSON.stringify(S.pageEls));
  S.pageEls = JSON.parse(S.history.pop());
  S.selId = null;
  renderElements();
}

function redo() {
  if (!S.redo.length) return;
  S.history.push(JSON.stringify(S.pageEls));
  S.pageEls = JSON.parse(S.redo.pop());
  S.selId = null;
  renderElements();
}

/* ═══════════════════════════════════════════════════════
   TOOLS
═══════════════════════════════════════════════════════ */
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('.t-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tool === t));
  g('fmt-bar').classList.toggle('show', t === 'text' || S.fmtBarLock);
  g('draw-bar').classList.toggle('show', t === 'draw');

  if (t === 'draw') {
    drawCanvas.className = DC.type === 'eraser' ? 'eraser-active' : 'draw-active';
    pageWrap.style.cursor = 'default';
  } else {
    drawCanvas.className = '';
    pageWrap.style.cursor = t === 'select' ? 'default' : 'crosshair';
  }
}

document.querySelectorAll('.t-btn').forEach(b =>
  b.addEventListener('click', () => {
    if (b.id === 'btn-date-tool') {
      const dropdown = g('date-dropdown');
      if (dropdown.style.display === 'none') {
        // позиционируем dropdown рядом с кнопкой
        const rect = b.getBoundingClientRect();
        dropdown.style.left = (rect.right + 10) + 'px';
        dropdown.style.top = rect.top + 'px';
        dropdown.style.display = 'flex';
      } else {
        dropdown.style.display = 'none';
      }
      return;
    }
    setTool(b.dataset.tool);
  }));

/* ═══════════════════════════════════════════════════════
   FORMAT BAR
═══════════════════════════════════════════════════════ */
function syncFmtBar(el) {
  g('ff').value = el.font || 'Arial';
  g('fs').value = el.size || 16;
  g('fc').value = el.color || '#000000';
  g('fb').classList.toggle('on', !!el.bold);
  g('fi').classList.toggle('on', !!el.italic);
  g('fu').classList.toggle('on', !!el.under);
}

function applyFmtToSel() {
  if (!S.selId) return;
  const el = els().find(e => e.id === S.selId);
  if (!el) return;
  el.font   = S.fmt.font;
  el.size   = S.fmt.size;
  el.bold   = S.fmt.bold;
  el.italic = S.fmt.italic;
  el.under  = S.fmt.under;
  el.color  = S.fmt.color;
  const dom = pageWrap.querySelector(`[data-id="${S.selId}"] .el-text`);
  if (dom) {
    dom.style.fontFamily    = el.font;
    dom.style.fontSize      = el.size + 'px';
    dom.style.fontWeight    = el.bold   ? 'bold'   : 'normal';
    dom.style.fontStyle     = el.italic ? 'italic' : 'normal';
    dom.style.textDecoration= el.under  ? 'underline' : 'none';
    dom.style.color         = el.color;
  }
}

g('ff').addEventListener('change', e => { S.fmt.font  = e.target.value; applyFmtToSel(); });
g('fs').addEventListener('input',  e => { S.fmt.size  = +e.target.value; applyFmtToSel(); });
g('fc').addEventListener('input',  e => { S.fmt.color = e.target.value; applyFmtToSel(); });
['bold','italic','under'].forEach(p => {
  const key = p === 'bold' ? 'fb' : p === 'italic' ? 'fi' : 'fu';
  const fld = p;
  // keep focus inside the text being edited
  g(key).addEventListener('mousedown', e => e.preventDefault());
  g(key).addEventListener('click', () => {
    S.fmt[fld] = !S.fmt[fld];
    g(key).classList.toggle('on', S.fmt[fld]);
    applyFmtToSel();
  });
});

/* ═══════════════════════════════════════════════════════
   KEYBOARD
═══════════════════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  const tag = document.activeElement.tagName;
  const ce  = document.activeElement.contentEditable;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ce === 'true') return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && (e.code === 'Digit2' || e.key === '2')) {
    e.preventDefault();
    if (g('organizer').style.display === 'none') openOrganizer();
    else closeOrganizer();
    return;
  }
  if (e.key === 'Escape' && g('organizer').style.display !== 'none') {
    closeOrganizer();
    return;
  }

  // e.code — физическая клавиша, не зависит от раскладки (рус/eng)
  if (ctrl && e.code === 'KeyZ') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (ctrl && e.code === 'KeyY') { e.preventDefault(); redo(); return; }

  if ((e.key === 'Delete' || e.key === 'Backspace') && S.selId) {
    pushHistory();
    S.pageEls[S.page] = els().filter(el => el.id !== S.selId);
    pageWrap.querySelector(`[data-id="${S.selId}"]`)?.remove();
    S.selId = null;
    return;
  }

  if (ctrl && e.code === 'KeyC' && S.selId) {
    const el = els().find(el => el.id === S.selId);
    if (el) S.clip = JSON.parse(JSON.stringify(el));
  }
  if (ctrl && e.code === 'KeyV' && S.clip) {
    e.preventDefault();
    const copy = { ...JSON.parse(JSON.stringify(S.clip)), id: uid(), x: S.clip.x + 16, y: S.clip.y + 16 };
    addEl(copy);
  }
});

/* ═══════════════════════════════════════════════════════
   EXPORT
═══════════════════════════════════════════════════════ */
g('btn-export').addEventListener('click', async () => {
  if (!S.sid) return;
  syncActiveText();

  saveDrawLayer();  // зафиксировать текущую страницу перед экспортом

  const pages = S.pageEls.map((pageArr, pi) => {
    const els = pageArr.map(el => {
      const out = { ...el };
      if (el.src) {
        const m = el.src.match(/^\/api\/(signatures|stamps)\/file\/(.+)$/);
        if (m) out.imgPath = `data/${m[1]}/${m[2]}`;
      }
      return out;
    });
    // добавляем draw-слой если есть
    if (drawLayers[pi]) {
      els.unshift({ type: 'draw', dataUrl: drawLayers[pi], x: 0, y: 0 });
    }
    return els;
  });

  const fmt = g('export-fmt').value;        // pdf | png | jpg | docx | xlsx
  const btn = g('btn-export');
  const old = btn.textContent;
  btn.textContent = '⏳ Сохранение…';
  btn.disabled = true;

  try {
    const resp = await api.export({ sid: S.sid, pages, scale: S.scale, format: fmt });
    if (!resp.ok) {
      let d = 'Ошибка экспорта';
      try { d = (await resp.json()).detail || d; } catch (e) {}
      alert(d);
      return;
    }
    const blob = await resp.blob();

    // расширение: zip если несколько страниц для картинок
    let ext = fmt;
    const ct = resp.headers.get('Content-Type') || '';
    if (ct.includes('zip')) ext = 'zip';

    let base = (g('file-name').value || 'document').trim().replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url;
    a.download = `${base}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  } finally {
    btn.textContent = old;
    btn.disabled = false;
  }
});

g('btn-print').addEventListener('click', async () => {
  if (!S.sid) return;

  const btn = g('btn-print');
  btn.disabled = true;
  btn.textContent = '⏳';

  // Собираем URL всех страниц
  const urls = Array.from({ length: S.pages }, (_, i) => api.pageUrl(i));

  // Скрытый iframe
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none';
  document.body.appendChild(iframe);

  // Ждём готовности iframe — создаём базовый HTML
  await new Promise(r => {
    iframe.onload = r;
    iframe.contentDocument.open();
    iframe.contentDocument.write(`<!DOCTYPE html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      body{background:#fff}
      img{display:block;width:100%;height:auto;page-break-after:always}
      img:last-child{page-break-after:avoid}
    </style></head><body></body></html>`);
    iframe.contentDocument.close();
  });

  // Добавляем картинки в iframe и ждём их загрузки
  const body = iframe.contentDocument.body;
  const loadPromises = urls.map(url => {
    return new Promise((resolve) => {
      const img = iframe.contentDocument.createElement('img');
      img.onload = resolve;
      img.onerror = resolve;  // resolve even on error
      img.src = url;
      body.appendChild(img);
    });
  });

  await Promise.all(loadPromises);

  iframe.contentWindow.focus();
  iframe.contentWindow.print();

  setTimeout(() => {
    document.body.removeChild(iframe);
    btn.disabled = false;
    btn.textContent = '🖨 Печать';
  }, 1000);
});

/* ═══════════════════════════════════════════════════════
   FILE OPEN
═══════════════════════════════════════════════════════ */
g('file-input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) openFile(f);
  e.target.value = '';
});

/* drag & drop */
document.addEventListener('dragover', e => { e.preventDefault(); g('drop-zone').classList.add('show'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) g('drop-zone').classList.remove('show'); });
document.addEventListener('drop', e => {
  e.preventDefault();
  g('drop-zone').classList.remove('show');
  const f = e.dataTransfer.files[0];
  if (f) openFile(f);
});

/* ═══════════════════════════════════════════════════════
   PANEL TABS
═══════════════════════════════════════════════════════ */
document.querySelectorAll('.p-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.p-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.p-body').forEach(b => b.classList.remove('active'));
    tab.classList.add('active');
    g(`pb-${tab.dataset.p}`).classList.add('active');
  });
});

/* ═══════════════════════════════════════════════════════
   SIGNATURES
═══════════════════════════════════════════════════════ */
let sigDrawing = false;
let sigPts = [];
const sigCtx = g('draw-sig').getContext('2d');
sigCtx.lineWidth   = 2.5;
sigCtx.lineCap     = 'round';
sigCtx.lineJoin    = 'round';

// ── Цвет подписи — загружаем сохранённый или дефолт ──
let _sigColor = localStorage.getItem('sigColor') || '#1a1a2e';

function setSigColor(color) {
  _sigColor = color;
  sigCtx.strokeStyle = color;
  localStorage.setItem('sigColor', color);
  // обновляем активный свотч
  document.querySelectorAll('.sig-swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.color === color);
  });
  // если цвет совпадает с кастомным пикером — обновляем его значение
  const custom = g('sig-color-custom');
  if (custom) custom.value = color;
}

// применяем при загрузке
setSigColor(_sigColor);

// клики по свотчам
document.querySelectorAll('.sig-swatch[data-color]').forEach(b => {
  b.addEventListener('click', () => setSigColor(b.dataset.color));
});

// кастомный colorpicker
g('sig-color-custom').addEventListener('input', e => {
  setSigColor(e.target.value);
  // убираем active со всех preset-свотчей
  document.querySelectorAll('.sig-swatch[data-color]').forEach(b => b.classList.remove('active'));
});
g('sig-color-custom').addEventListener('change', e => setSigColor(e.target.value));

g('btn-draw-sig').addEventListener('click', () => {
  sigCtx.clearRect(0, 0, g('draw-sig').width, g('draw-sig').height);
  sigPts = [];
  setSigColor(_sigColor);  // восстанавливаем активный свотч
  openM('m-sig');
});

g('draw-sig').addEventListener('mousedown', e => {
  sigDrawing = true;
  sigPts = [];
  sigCtx.strokeStyle = _sigColor;   // актуальный цвет перед каждым штрихом
  const r = g('draw-sig').getBoundingClientRect();
  const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
  sigPts.push(pt);
  sigCtx.beginPath();
  sigCtx.moveTo(pt.x, pt.y);
});

const SIG_SMOOTH = 0.2;  // 20% сглаживания: точка подтягивается к предыдущей

g('draw-sig').addEventListener('mousemove', e => {
  if (!sigDrawing) return;
  const r   = g('draw-sig').getBoundingClientRect();
  const raw = { x: e.clientX - r.left, y: e.clientY - r.top };

  // экспоненциальное сглаживание относительно последней точки
  const prev = sigPts[sigPts.length - 1];
  const pt = prev
    ? { x: prev.x * SIG_SMOOTH + raw.x * (1 - SIG_SMOOTH),
        y: prev.y * SIG_SMOOTH + raw.y * (1 - SIG_SMOOTH) }
    : raw;
  sigPts.push(pt);

  if (sigPts.length < 3) {
    sigCtx.lineTo(pt.x, pt.y);
    sigCtx.stroke();
    return;
  }

  // smooth: draw through midpoints using quadratic bezier
  const p1 = sigPts[sigPts.length - 2];
  const p2 = sigPts[sigPts.length - 1];
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

  sigCtx.quadraticCurveTo(p1.x, p1.y, mid.x, mid.y);
  sigCtx.stroke();
  sigCtx.beginPath();
  sigCtx.moveTo(mid.x, mid.y);
});

g('draw-sig').addEventListener('mouseup', () => {
  if (sigPts.length > 0) {
    const last = sigPts[sigPts.length - 1];
    sigCtx.lineTo(last.x, last.y);
    sigCtx.stroke();
  }
  sigDrawing = false;
  sigPts = [];
});
g('sig-clear').addEventListener('click', () =>
  sigCtx.clearRect(0, 0, g('draw-sig').width, g('draw-sig').height));

g('sig-save').addEventListener('click', () => {
  const name = g('sig-name').value.trim() || 'Подпись';
  g('draw-sig').toBlob(async blob => {
    await api.saveSig(name, blob);
    closeM('m-sig');
    await loadSigs();
  });
});

async function loadSigs() {
  S.sigLib = await api.getSigs();
  const list = g('sig-list');
  list.innerHTML = '';
  S.sigLib.forEach(s => {
    const row = document.createElement('div');
    row.className = 'lib-row' + (S.selLib.sig === s.name ? ' sel' : '');
    row.innerHTML = `<img src="${s.path}" style="height:40px;width:68px;object-fit:contain;flex-shrink:0"><span class="rname">${s.name}</span><button class="lib-edit" title="Изменить цвет">✏</button><button class="del-x" data-n="${s.name}">×</button>`;
    row.querySelector('.lib-edit').addEventListener('click', ev => {
      ev.stopPropagation();
      editSig(s.name, s.path);
    });
    row.querySelector('.del-x').addEventListener('click', async ev => {
      ev.stopPropagation();
      await api.delSig(s.name);
      if (S.selLib.sig === s.name) S.selLib.sig = null;
      await loadSigs();
    });
    row.addEventListener('click', () => {
      S.selLib.sig = s.name;
      list.querySelectorAll('.lib-row').forEach(r => r.classList.remove('sel'));
      row.classList.add('sel');
      setTool('sig');
    });
    list.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════
   SIGNATURE EDIT (recolor)
═══════════════════════════════════════════════════════ */
const _sigEdit = { name: null, origData: null, w: 0, h: 0 };
let _sigEditColor = '#1a1a2e';

function _applyEditColor(hexColor) {
  _sigEditColor = hexColor;
  const canvas = g('sig-edit-preview');
  const ctx = canvas.getContext('2d');
  if (!_sigEdit.origData) return;

  const cr = parseInt(hexColor.slice(1, 3), 16);
  const cg = parseInt(hexColor.slice(3, 5), 16);
  const cb = parseInt(hexColor.slice(5, 7), 16);

  const copy = new ImageData(
    new Uint8ClampedArray(_sigEdit.origData.data),
    _sigEdit.w, _sigEdit.h
  );
  const px = copy.data;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] > 0) { px[i] = cr; px[i + 1] = cg; px[i + 2] = cb; }
  }
  ctx.putImageData(copy, 0, 0);

  document.querySelectorAll('#sig-edit-swatches .sig-swatch[data-color]').forEach(b =>
    b.classList.toggle('active', b.dataset.color === hexColor));
  const picker = g('sig-edit-color-custom');
  if (picker) picker.value = hexColor;
}

function editSig(name, path) {
  _sigEdit.name = name;
  _sigEdit.origData = null;
  const canvas = g('sig-edit-preview');
  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const maxW = 360;
    const scale = Math.min(1, maxW / img.naturalWidth);
    canvas.style.width  = Math.round(img.naturalWidth  * scale) + 'px';
    canvas.style.height = Math.round(img.naturalHeight * scale) + 'px';
    ctx.drawImage(img, 0, 0);
    _sigEdit.origData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    _sigEdit.w = canvas.width;
    _sigEdit.h = canvas.height;
    _applyEditColor(_sigEditColor);
  };
  img.src = path + (path.includes('?') ? '&' : '?') + '_=' + Date.now();
  openM('m-sig-edit');
}

document.querySelectorAll('#sig-edit-swatches .sig-swatch[data-color]').forEach(b =>
  b.addEventListener('click', () => _applyEditColor(b.dataset.color)));
g('sig-edit-color-custom').addEventListener('input', e => _applyEditColor(e.target.value));

g('sig-edit-save').addEventListener('click', () => {
  g('sig-edit-preview').toBlob(async blob => {
    await api.saveSig(_sigEdit.name, blob);
    closeM('m-sig-edit');
    await loadSigs();
  });
});

/* ═══════════════════════════════════════════════════════
   INITIALS
═══════════════════════════════════════════════════════ */
g('btn-add-ini').addEventListener('click', () => {
  g('ini-name').value = '';
  g('ini-text').value = '';
  openM('m-ini');
});
g('ini-save').addEventListener('click', async () => {
  const name = g('ini-name').value.trim();
  const text = g('ini-text').value.trim();
  if (!name || !text) return;
  await api.saveIni({ name, text });
  closeM('m-ini');
  await loadInis();
});

async function loadInis() {
  S.iniLib = await api.getInis();
  const list = g('ini-list');
  list.innerHTML = '';
  S.iniLib.forEach(ini => {
    const row = document.createElement('div');
    row.className = 'lib-row' + (S.selLib.ini === ini.name ? ' sel' : '');
    row.innerHTML = `<span style="font-size:18px;font-weight:bold;min-width:36px">${ini.text}</span><span class="rname">${ini.name}</span><button class="del-x" data-n="${ini.name}">×</button>`;
    row.querySelector('.del-x').addEventListener('click', async ev => {
      ev.stopPropagation();
      await api.delIni(ini.name);
      if (S.selLib.ini === ini.name) S.selLib.ini = null;
      await loadInis();
    });
    row.addEventListener('click', () => {
      S.selLib.ini = ini.name;
      list.querySelectorAll('.lib-row').forEach(r => r.classList.remove('sel'));
      row.classList.add('sel');
      setTool('ini');
    });
    list.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════
   STAMPS
═══════════════════════════════════════════════════════ */
g('st-save').addEventListener('click', async () => {
  const name  = g('st-name').value.trim() || 'Печать';
  const text  = g('st-text').value.trim();
  const color = g('st-color').value;
  if (!text) return;
  await api.createTxtStamp({ name, text, color });
  closeM('m-stamp');
  await loadStamps();
});

g('stamp-upload').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  const def = file.name.replace(/\.png$/i, '');
  const name = (prompt('Название печати:', def) || '').trim() || def;
  await api.uploadStamp(name, file);
  e.target.value = '';
  await loadStamps();
});

async function loadStamps() {
  S.stLib = await api.getStamps();
  const list = g('stamp-list');
  list.innerHTML = '';
  S.stLib.forEach(st => {
    const row = document.createElement('div');
    row.className = 'lib-row' + (S.selLib.stamp === st.name ? ' sel' : '');
    row.innerHTML = `<img src="${st.path}"><span class="rname">${st.name}</span><button class="del-x">×</button>`;
    row.querySelector('.del-x').addEventListener('click', async ev => {
      ev.stopPropagation();
      await api.delStamp(st.name);
      if (S.selLib.stamp === st.name) S.selLib.stamp = null;
      await loadStamps();
    });
    row.addEventListener('click', () => {
      S.selLib.stamp = st.name;
      list.querySelectorAll('.lib-row').forEach(r => r.classList.remove('sel'));
      row.classList.add('sel');
      setTool('stamp');
    });
    list.appendChild(row);
  });
}

/* ═══════════════════════════════════════════════════════
   MODALS
═══════════════════════════════════════════════════════ */
function openM(id)  { g(id).classList.add('show'); }
function closeM(id) { g(id).classList.remove('show'); }
window.closeM = closeM;

document.querySelectorAll('.modal-bg').forEach(m =>
  m.addEventListener('click', e => { if (e.target === m) closeM(m.id); }));

/* ═══════════════════════════════════════════════════════
   DRAW TOOL
═══════════════════════════════════════════════════════ */
const drawCanvas = g('page-draw-canvas');
const drawCtx    = drawCanvas.getContext('2d');
const DC = { type: 'pencil', color: '#000000', size: 2, opacity: 1.0 };
const drawLayers = [];   // [pageIdx] = dataURL | null
let   isDrawing  = false;
let   lastPt     = null;

function initDrawCanvas() {
  const w = S.baseW, h = S.baseH;
  drawCanvas.width  = w;
  drawCanvas.height = h;
  drawCanvas.style.width  = w + 'px';
  drawCanvas.style.height = h + 'px';
  drawCtx.clearRect(0, 0, w, h);
  const saved = drawLayers[S.page];
  if (saved) {
    const img = new Image();
    img.onload = () => drawCtx.drawImage(img, 0, 0);
    img.src = saved;
  }
}

function saveDrawLayer() {
  // сохраняем только если что-то нарисовано
  const data = drawCtx.getImageData(0, 0, drawCanvas.width, drawCanvas.height);
  const hasContent = data.data.some((v, i) => i % 4 === 3 && v > 0);
  drawLayers[S.page] = hasContent ? drawCanvas.toDataURL('image/png') : null;
}

function drawPoint(e) {
  const r  = drawCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / S.zoom,
    y: (e.clientY - r.top)  / S.zoom,
  };
}

drawCanvas.addEventListener('mousedown', e => {
  if (S.tool !== 'draw') return;
  e.preventDefault();
  isDrawing = true;
  lastPt = drawPoint(e);
  drawCtx.save();
  applyDrawStyle();
  drawCtx.beginPath();
  drawCtx.moveTo(lastPt.x, lastPt.y);
});

drawCanvas.addEventListener('mousemove', e => {
  if (!isDrawing) return;
  const pt = drawPoint(e);
  drawCtx.lineTo(pt.x, pt.y);
  drawCtx.stroke();
  drawCtx.beginPath();
  drawCtx.moveTo(pt.x, pt.y);
  lastPt = pt;
});

drawCanvas.addEventListener('mouseup', () => {
  if (!isDrawing) return;
  isDrawing = false;
  drawCtx.restore();
  saveDrawLayer();
  lastPt = null;
});

drawCanvas.addEventListener('mouseleave', () => {
  if (isDrawing) {
    isDrawing = false;
    drawCtx.restore();
    saveDrawLayer();
    lastPt = null;
  }
});

function applyDrawStyle() {
  if (DC.type === 'eraser') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.lineWidth   = DC.size * 3;
    drawCtx.globalAlpha = 1;
  } else if (DC.type === 'marker') {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = DC.color;
    drawCtx.lineWidth   = DC.size * 4;
    drawCtx.globalAlpha = DC.opacity * 0.4;  // маркер полупрозрачный
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = DC.color;
    drawCtx.lineWidth   = DC.size;
    drawCtx.globalAlpha = DC.opacity;
  }
  drawCtx.lineCap  = 'round';
  drawCtx.lineJoin = 'round';
}

function setDrawSubTool(dt) {
  DC.type = dt;
  document.querySelectorAll('.d-sub').forEach(b =>
    b.classList.toggle('active', b.dataset.dt === dt));
  drawCanvas.className = dt === 'eraser' ? 'eraser-active' : 'draw-active';
  if (dt === 'eraser') updateEraserCursor();
  else drawCanvas.style.cursor = '';
}

/* Генерирует SVG-курсор в виде круга, отражающего реальный размер ластика. */
function updateEraserCursor() {
  if (DC.type !== 'eraser') return;
  // ластик рисует линию толщиной DC.size * 3 в canvas-px; на экране умножаем на zoom
  const screenR = Math.round((DC.size * 3 * S.zoom) / 2);
  // Chrome ограничивает кастомный курсор до 128×128px
  const r    = Math.min(58, Math.max(3, screenR));
  const size = r * 2 + 4;
  const cx   = size / 2;
  const svg  = [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}'>`,
    `<circle cx='${cx}' cy='${cx}' r='${r}' fill='rgba(255,255,255,0.25)' stroke='rgba(0,0,0,0.55)' stroke-width='1.5'/>`,
    `<circle cx='${cx}' cy='${cx}' r='${r}' fill='none' stroke='white' stroke-width='0.8' stroke-dasharray='3,2'/>`,
    `</svg>`,
  ].join('');
  drawCanvas.style.cursor =
    `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${cx} ${cx}, crosshair`;
}

// sub-tool buttons
document.querySelectorAll('.d-sub').forEach(b => {
  b.addEventListener('click', () => {
    setDrawSubTool(b.dataset.dt);
    document.querySelectorAll('.d-sub').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
});

// colors
document.querySelectorAll('.d-color').forEach(b => {
  b.addEventListener('click', () => {
    DC.color = b.dataset.c;
    document.querySelectorAll('.d-color').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
});

// sizes
document.querySelectorAll('.d-size').forEach(b => {
  b.addEventListener('click', () => {
    DC.size = +b.dataset.s;
    document.querySelectorAll('.d-size').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    if (DC.type === 'eraser') updateEraserCursor();
  });
});

// opacity
document.querySelectorAll('.d-op').forEach(b => {
  b.addEventListener('click', () => {
    DC.opacity = +b.dataset.o / 100;
    document.querySelectorAll('.d-op').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
  });
});

// clear
g('dc-clear').addEventListener('click', () => {
  if (!confirm('Очистить всё рисование на этой странице?')) return;
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  drawLayers[S.page] = null;
});

/* ═══════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════ */
const pad = n => String(n).padStart(2, '0');

/* ═══════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════ */
// date format dropdown
document.querySelectorAll('.date-fmt-btn').forEach(b => {
  b.addEventListener('click', () => {
    S.dateFmt = b.dataset.fmt;
    document.querySelectorAll('.date-fmt-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    // включаем инструмент дата после выбора формата
    setTool('date');
    g('date-dropdown').style.display = 'none';
  });
});

// закрываем dropdown при клике вне его
document.addEventListener('click', e => {
  const dd = g('date-dropdown');
  const btn = g('btn-date-tool');
  if (dd.style.display !== 'none' && !dd.contains(e.target) && e.target !== btn) {
    dd.style.display = 'none';
  }
});

(async () => {
  await Promise.all([loadSigs(), loadInis(), loadStamps()]);
})();
