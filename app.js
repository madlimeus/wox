'use strict';

/* 화면(index.html)과 코드(app.js) 버전이 섞여 받아졌으면 한 번 새로고침한다.
   배포할 때마다 BUILD, index.html의 wox-build, sw.js의 VERSION을 같이 올린다. */
const BUILD = 'v29';
(function checkBuild() {
  const m = document.querySelector('meta[name="wox-build"]');
  if ((m && m.content) === BUILD) return;
  let tried = false;
  try { tried = sessionStorage.getItem('wox.reload') === BUILD; sessionStorage.setItem('wox.reload', BUILD); } catch (e) { /* 무시 */ }
  if (!tried) { location.reload(); throw new Error('버전이 달라 새로고침'); }
})();
window.addEventListener('error', (e) => { try { toast('오류: ' + e.message, 8000); } catch (_) { /* 무시 */ } });
window.addEventListener('unhandledrejection', (e) => {
  try { toast('오류: ' + ((e.reason && e.reason.message) || e.reason), 8000); } catch (_) { /* 무시 */ }
});

/* =========================================================
   WOX — PDF 위에 체크칸(V/W) · 주석 · 빈칸을 다는 공부용 앱
   모든 데이터는 폰 안(IndexedDB)에 저장된다.
   ========================================================= */

pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib/pdf.worker.min.js';
const PDF_OPTS = {
  cMapUrl: new URL('lib/cmaps/', location.href).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('lib/standard_fonts/', location.href).href,
};

const $ = (s) => document.querySelector(s);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };

/* ---------------- IndexedDB ---------------- */
// folders: {id, name, created}
// files:   {id, name, folderId, size, pages, added, opened, zoom, scrollRatio}
// blobs:   {id, blob}            ← PDF 원본 (목록 볼 때는 안 읽음)
// marks:   {id(fileId), items, autoDone}
let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open('wox', 2);
    r.onupgradeneeded = () => { // 없는 저장소만 만든다 → 기존 데이터는 그대로
      const d = r.result;
      for (const s of ['folders', 'files', 'blobs', 'marks', 'settings']) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    let out;
    const r = fn(t.objectStore(store));
    if (r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}
const dbGet = (st, id) => tx(st, 'readonly', (s) => s.get(id));
const dbAll = (st) => tx(st, 'readonly', (s) => s.getAll());
// raw*: PC 폴더 동기화를 다시 예약하지 않는 내부용 (동기화 코드 자신이 쓴다)
const rawPut = (st, v) => tx(st, 'readwrite', (s) => s.put(v));
const rawDel = (st, id) => tx(st, 'readwrite', (s) => s.delete(id));
const dbPut = (st, v) => rawPut(st, v).then((r) => { diskNotify(st, v && v.id); return r; });
const dbDel = (st, id) => rawDel(st, id).then((r) => { diskNotify(st, id); return r; });

function requestPersist() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

/* ---------------- 모달 · 토스트 ---------------- */
let modalResolve = null;
function showModal({ title = '', body = null, actions = [], list = false, onOpen = null }) {
  closeModal(null);
  return new Promise((resolve) => {
    modalResolve = resolve;
    $('#modal-title').textContent = title;
    const b = $('#modal-body');
    b.innerHTML = '';
    if (typeof body === 'string') b.textContent = body;
    else if (body) b.appendChild(body);
    const a = $('#modal-actions');
    a.innerHTML = '';
    a.className = 'modal-actions' + (list ? ' list' : '');
    for (const act of actions) {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (act.cls || '');
      btn.textContent = act.label;
      if (act.key || act.hint) { // 메뉴 단축키: 버튼 옆에 표시하고 그 키로 누를 수 있게
        const k = document.createElement('kbd');
        k.textContent = act.key || act.hint;
        btn.appendChild(k);
        if (act.key) btn.dataset.key = 'Key' + act.key;
      }
      btn.onclick = () => closeModal(typeof act.value === 'function' ? act.value() : act.value);
      a.appendChild(btn);
    }
    $('#modal').hidden = false;
    if (onOpen) onOpen();
  });
}
function closeModal(v) {
  if (!modalResolve) return;
  const r = modalResolve;
  modalResolve = null;
  $('#modal').hidden = true;
  r(v);
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(null); });

const sheet = (title, items) =>
  showModal({ title, list: true, actions: [...items, { label: '취소', value: null, cls: 'ghost', hint: 'Esc' }] });
const confirmBox = (title, msg, okLabel = '확인', danger = false) =>
  showModal({
    title, body: msg,
    actions: [{ label: '취소', value: false, cls: 'ghost' }, { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' }],
  });
function promptBox(title, init = '', { multiline = false, placeholder = '' } = {}) {
  const el = document.createElement(multiline ? 'textarea' : 'input');
  if (!multiline) el.type = 'text';
  el.value = init;
  el.placeholder = placeholder;
  let body = el;
  if (multiline) { // 주석 입력: 굵게 (Ctrl+B 또는 버튼) → **글자**
    body = div('');
    const tools = div('note-tools');
    const bBtn = document.createElement('button');
    bBtn.type = 'button';
    bBtn.className = 'btn tool-btn';
    bBtn.innerHTML = '<b>B</b> 굵게';
    bBtn.onmousedown = (e) => e.preventDefault(); // 입력창 선택 유지
    bBtn.onclick = () => { toggleBold(el); el.focus(); };
    const hint = document.createElement('span');
    hint.className = 'tool-hint';
    hint.textContent = 'Ctrl+B 굵게 · 표 줄에서 Enter는 줄바꿈 · Ctrl+Enter 저장';
    const tBtn = document.createElement('button');
    tBtn.type = 'button';
    tBtn.className = 'btn tool-btn';
    tBtn.textContent = '표';
    tBtn.onmousedown = (e) => e.preventDefault();
    tBtn.onclick = () => { insertTable(el); el.focus(); };
    tools.append(bBtn, tBtn, hint);
    body.append(tools, el);
    el.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyB') { e.preventDefault(); toggleBold(el); }
    });
  }
  return showModal({
    title, body,
    actions: [{ label: '취소', value: null, cls: 'ghost' }, { label: '저장', value: () => el.value, cls: 'primary' }],
    onOpen: () => setTimeout(() => el.focus(), 60),
  });
}

// 커서 자리에 표 틀을 넣고 첫 칸을 선택
function insertTable(el) {
  const tpl = '| 구분 | 내용 |\n|---|---|\n|  |  |\n|  |  |';
  const v = el.value, a = el.selectionStart, b = el.selectionEnd;
  const pre = a > 0 && v[a - 1] !== '\n' ? '\n' : '';
  el.value = v.slice(0, a) + pre + tpl + v.slice(b);
  const start = a + pre.length + 2;
  el.setSelectionRange(start, start + 2);
}

// 선택한 글자 앞뒤에 ** 를 붙이거나(굵게) 떼기(해제). 선택이 없으면 **|** 넣고 커서를 가운데로
function toggleBold(el) {
  const v = el.value, a = el.selectionStart, b = el.selectionEnd;
  const sel = v.slice(a, b);
  let out, s, e;
  if (v.slice(a - 2, a) === '**' && v.slice(b, b + 2) === '**') {
    out = v.slice(0, a - 2) + sel + v.slice(b + 2); s = a - 2; e = b - 2;
  } else if (sel.length > 4 && sel.startsWith('**') && sel.endsWith('**')) {
    out = v.slice(0, a) + sel.slice(2, -2) + v.slice(b); s = a; e = b - 4;
  } else {
    out = v.slice(0, a) + '**' + sel + '**' + v.slice(b); s = a + 2; e = b + 2;
  }
  el.value = out;
  el.setSelectionRange(s, e);
}

// 주석 글자 → 화면용 HTML (**굵게**만 허용, 나머지는 그대로 글자로)
function mdInline(t) {
  const esc = String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return esc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
// 주석 글자 → 화면용 HTML: **굵게** + 마크다운 표(| 머리 | … | 다음 줄 |---|---|)
function noteHtml(text) {
  const lines = String(text).split('\n');
  const isRow = (l) => /^\s*\|.*\|\s*$/.test(l);
  const isSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => mdInline(c.trim()));
  const blocks = [];
  let text_ = [];
  const flush = () => {
    if (text_.length) blocks.push(`<div class="md-text">${text_.map(mdInline).join('\n')}</div>`);
    text_ = [];
  };
  for (let i = 0; i < lines.length;) {
    if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
      flush();
      const head = cells(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      blocks.push('<table class="md-table"><thead><tr>' + head.map((c) => `<th>${c}</th>`).join('') +
        '</tr></thead><tbody>' + rows.map((r) => '<tr>' + head.map((_, k) => `<td>${r[k] || ''}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
    } else {
      text_.push(lines[i++]);
    }
  }
  flush();
  return blocks.join('');
}

let toastT = null;
function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, ms);
}

function showScreen(name) {
  $('#library').hidden = name !== 'library';
  $('#viewer').hidden = name !== 'viewer';
}

/* =========================================================
   파일 목록 (라이브러리)
   ========================================================= */
const lib = { folders: [], files: [], tab: localStorage.getItem('wox.tab') || 'all' };

async function loadLibrary() {
  lib.folders = (await dbAll('folders')).sort((a, b) => a.created - b.created);
  lib.files = await dbAll('files');
  if (lib.tab !== 'all' && lib.tab !== 'none' && !lib.folders.some((f) => f.id === lib.tab)) lib.tab = 'all';
  renderLibrary();
}

function setTab(t) {
  lib.tab = t;
  try { localStorage.setItem('wox.tab', t); } catch (e) { /* 무시 */ }
  renderLibrary();
}

const folderName = (id) => (lib.folders.find((f) => f.id === id) || {}).name || '미분류';
const fmtDate = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
const fmtSize = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');

function renderLibrary() {
  const tabs = $('#folder-tabs');
  tabs.innerHTML = '';
  const mkTab = (label, key, count, extraCls = '') => {
    const b = document.createElement('button');
    b.className = 'tab ' + extraCls + (lib.tab === key ? ' on' : '');
    b.textContent = label;
    if (count !== undefined) {
      const c = document.createElement('span');
      c.className = 'cnt';
      c.textContent = count;
      b.appendChild(c);
    }
    tabs.appendChild(b);
    return b;
  };
  mkTab('전체', 'all', lib.files.length).onclick = () => setTab('all');
  for (const f of lib.folders) {
    const b = mkTab(f.name, f.id, lib.files.filter((x) => x.folderId === f.id).length);
    b.onclick = () => (lib.tab === f.id ? folderMenu(f) : setTab(f.id));
    b.oncontextmenu = (e) => { e.preventDefault(); folderMenu(f); };
  }
  const noneCnt = lib.files.filter((x) => !x.folderId || !lib.folders.some((f) => f.id === x.folderId)).length;
  if (lib.folders.length && noneCnt) mkTab('미분류', 'none', noneCnt).onclick = () => setTab('none');
  mkTab('+ 과목', '__add', undefined, 'add').onclick = newFolder;

  const list = $('#file-list');
  list.innerHTML = '';
  let files = lib.files;
  if (lib.tab === 'none') files = files.filter((x) => !x.folderId || !lib.folders.some((f) => f.id === x.folderId));
  else if (lib.tab !== 'all') files = files.filter((x) => x.folderId === lib.tab);
  files = [...files].sort((a, b) => (b.opened || b.added) - (a.opened || a.added));

  if (!files.length) {
    const e = div('empty');
    e.innerHTML = lib.files.length
      ? '이 과목에는 아직 파일이 없어요.<br>오른쪽 위 <b>+ PDF</b>로 불러오세요.'
      : '아직 불러온 PDF가 없어요.<br>오른쪽 위 <b>+ PDF</b>를 눌러<br>내 파일에서 PDF를 골라 주세요.';
    list.appendChild(e);
    return;
  }
  for (const f of files) {
    const row = div('file-row');
    const icon = div('file-icon');
    icon.textContent = 'PDF';
    const info = div('file-info');
    const nm = div('file-name');
    nm.textContent = f.name;
    const meta = div('file-meta');
    meta.textContent = `${folderName(f.folderId)} · ${f.pages}쪽 · ${fmtSize(f.size)} · ${f.opened ? '최근 ' + fmtDate(f.opened) : '추가 ' + fmtDate(f.added)}`;
    info.append(nm, meta);
    const more = document.createElement('button');
    more.className = 'file-more';
    more.textContent = '⋮';
    more.onclick = (e) => { e.stopPropagation(); fileMenu(f); };
    row.append(icon, info, more);
    row.onclick = () => openFile(f.id);
    row.oncontextmenu = (e) => { e.preventDefault(); fileMenu(f); };
    list.appendChild(row);
  }
}

/* ---- 과목(폴더) ---- */
async function newFolder() {
  const name = await promptBox('새 과목 이름', '', { placeholder: '예: 정보보호론' });
  if (!name || !name.trim()) return null;
  const f = { id: uid(), name: name.trim(), created: Date.now() };
  await dbPut('folders', f);
  lib.tab = f.id;
  await loadLibrary();
  return f;
}

async function folderMenu(f) {
  const v = await sheet(f.name, [
    { label: '이름 바꾸기', value: 'rename' },
    { label: '과목 삭제 (파일은 미분류로)', value: 'del', cls: 'danger' },
  ]);
  if (v === 'rename') {
    const name = await promptBox('과목 이름 바꾸기', f.name);
    if (name && name.trim()) { f.name = name.trim(); await dbPut('folders', f); await loadLibrary(); }
  } else if (v === 'del') {
    if (!(await confirmBox('과목 삭제', `"${f.name}" 과목을 지울까요? 안에 있던 파일은 지워지지 않고 미분류로 옮겨져요.`, '삭제', true))) return;
    for (const x of lib.files.filter((x) => x.folderId === f.id)) { x.folderId = null; await dbPut('files', x); }
    await dbDel('folders', f.id);
    lib.tab = 'all';
    await loadLibrary();
  }
}

async function pickFolder(title, currentId) {
  const items = lib.folders.map((f) => ({ label: (f.id === currentId ? '✓ ' : '') + f.name, value: f.id }));
  items.push({ label: (!currentId ? '✓ ' : '') + '미분류', value: '__none' });
  items.push({ label: '+ 새 과목 만들기', value: '__new' });
  const v = await sheet(title, items);
  if (v === null) return undefined;
  if (v === '__none') return null;
  if (v === '__new') { const f = await newFolder(); return f ? f.id : undefined; }
  return v;
}

/* ---- 파일 ---- */
async function fileMenu(f) {
  const v = await sheet(f.name, [
    { label: '열기', value: 'open' },
    { label: '이름 바꾸기', value: 'rename' },
    { label: '과목 이동', value: 'move' },
    { label: '삭제', value: 'del', cls: 'danger' },
  ]);
  if (v === 'open') openFile(f.id);
  else if (v === 'rename') {
    const name = await promptBox('파일 이름 바꾸기', f.name);
    if (name && name.trim()) { f.name = name.trim(); await dbPut('files', f); await loadLibrary(); }
  } else if (v === 'move') {
    const to = await pickFolder('어느 과목으로 옮길까요?', f.folderId);
    if (to === undefined) return;
    f.folderId = to;
    await dbPut('files', f);
    await loadLibrary();
    toast(`${folderName(to)}(으)로 옮겼어요`);
  } else if (v === 'del') {
    if (!(await confirmBox('파일 삭제', `"${f.name}"을(를) 지울까요? 체크·주석·빈칸도 함께 지워지고 되돌릴 수 없어요.`, '삭제', true))) return;
    await dbDel('files', f.id);
    await dbDel('blobs', f.id);
    await dbDel('marks', f.id);
    await loadLibrary();
    toast('삭제했어요');
  }
}

$('#btn-import').onclick = () => $('#file-input').click();
$('#file-input').onchange = async (e) => {
  const picked = [...e.target.files];
  e.target.value = '';
  if (!picked.length) return;
  let folderId = lib.tab !== 'all' && lib.tab !== 'none' ? lib.tab : null;
  if (lib.tab === 'all' && lib.folders.length) {
    const to = await pickFolder('어느 과목에 넣을까요?', null);
    if (to === undefined) return;
    folderId = to;
  }
  toast('불러오는 중…', 60000);
  let ok = 0;
  for (const f of picked) {
    try {
      const buf = await f.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf.slice(0), ...PDF_OPTS }).promise;
      const pages = doc.numPages;
      doc.destroy();
      const id = uid();
      await dbPut('blobs', { id, blob: new Blob([buf], { type: 'application/pdf' }) });
      await dbPut('files', {
        id, name: f.name.replace(/\.pdf$/i, ''), folderId, size: f.size, pages, added: Date.now(), opened: 0,
      });
      ok++;
    } catch (err) {
      console.error(err);
      toast(`"${f.name}"은(는) 열 수 없는 PDF예요`);
    }
  }
  requestPersist();
  if (folderId) lib.tab = folderId;
  await loadLibrary();
  if (ok) toast(`${ok}개 불러왔어요`);
};

/* ---- 라이브러리 메뉴 (백업 등) ---- */
$('#btn-lib-menu').onclick = async () => {
  const v = await sheet('메뉴', [
    { label: '새 과목 만들기', value: 'folder' },
    { label: '전체 백업 (PDF 포함)', value: 'full' },
    { label: '표시만 백업 (체크·주석·빈칸, 가벼움)', value: 'marks' },
    { label: '백업 파일에서 복원', value: 'restore' },
    ...(window.showDirectoryPicker ? [disk.handle
      ? { label: `PC 폴더: ${disk.handle.name} (연결 해제)`, value: 'disk-off' }
      : { label: 'PC 폴더에 자동 저장 연결', value: 'disk-on' }] : []),
    { label: '저장공간 확인', value: 'storage' },
    { label: '사용법', value: 'help' },
  ]);
  if (v === 'folder') newFolder();
  else if (v === 'full') exportBackup(true);
  else if (v === 'marks') exportBackup(false);
  else if (v === 'restore') $('#backup-input').click();
  else if (v === 'storage') showStorage();
  else if (v === 'disk-on') diskConnect();
  else if (v === 'disk-off') diskDisconnect();
  else if (v === 'help') showHelp();
};

function blobToB64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
function b64ToBlob(b64, type = 'application/pdf') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}
const ymd = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };

async function exportBackup(withPdf) {
  toast('백업 파일 만드는 중…', 60000);
  const folders = await dbAll('folders');
  const files = await dbAll('files');
  const marks = await dbAll('marks');
  const parts = [JSON.stringify({ app: 'wox', v: 1, kind: withPdf ? 'full' : 'marks', exported: Date.now(), folders, files, marks }).slice(0, -1)];
  parts.push(',"blobs":[');
  if (withPdf) {
    const blobs = await dbAll('blobs');
    for (let i = 0; i < blobs.length; i++) {
      parts.push((i ? ',' : '') + JSON.stringify({ id: blobs[i].id, data: await blobToB64(blobs[i].blob) }));
    }
  }
  parts.push(']}');
  download(new Blob(parts, { type: 'application/json' }), `wox-${withPdf ? '전체' : '표시'}백업-${ymd()}.json`);
  toast('백업 파일을 다운로드 폴더에 저장했어요', 3500);
}

$('#backup-input').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let data;
  try { data = JSON.parse(await f.text()); } catch (err) { toast('백업 파일을 읽을 수 없어요'); return; }
  if (!data || data.app !== 'wox') { toast('WOX 백업 파일이 아니에요'); return; }
  if (!(await confirmBox('백업 복원', '지금 있는 데이터에 합칠게요. 같은 파일의 표시는 백업 내용으로 덮어써요.', '복원'))) return;
  toast('복원하는 중…', 60000);
  const localFiles = await dbAll('files');
  const blobIds = new Set((data.blobs || []).map((b) => b.id));
  for (const b of data.blobs || []) await dbPut('blobs', { id: b.id, blob: b64ToBlob(b.data) });
  for (const fo of data.folders || []) await dbPut('folders', fo);
  let restored = 0;
  for (const fm of data.files || []) {
    const hasHere = localFiles.find((x) => x.id === fm.id);
    const mk = (data.marks || []).find((m) => m.id === fm.id);
    if (blobIds.has(fm.id) || hasHere) {
      await dbPut('files', hasHere && !blobIds.has(fm.id) ? { ...hasHere, folderId: fm.folderId } : fm);
      if (mk) await dbPut('marks', mk);
      restored++;
    } else if (mk) {
      // PDF가 없는 "표시만 백업": 같은 이름의 파일을 찾아서 표시를 입힌다
      const same = localFiles.find((x) => x.name === fm.name);
      if (same) { await dbPut('marks', { ...mk, id: same.id }); restored++; }
    }
  }
  requestPersist();
  await loadLibrary();
  toast(`${restored}개 파일을 복원했어요`, 3000);
};

async function showStorage() {
  let msg = '확인할 수 없어요';
  if (navigator.storage && navigator.storage.estimate) {
    const est = await navigator.storage.estimate();
    const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    msg = `사용 중: ${fmtSize(est.usage || 0)}\n사용 가능: 약 ${fmtSize(est.quota || 0)}\n\n` +
      (persisted ? '✓ 보호됨: 폰 용량이 부족해도 자동으로 지워지지 않아요.'
        : '보호 안 됨: 앱을 홈 화면에 설치하고 자주 쓰면 보통 보호돼요. 그래도 가끔 백업해 두세요.');
  }
  const body = div('');
  body.style.whiteSpace = 'pre-wrap';
  body.textContent = msg;
  showModal({ title: '저장공간', body, actions: [{ label: '닫기', value: null, cls: 'primary' }] });
}

function showHelp() {
  const body = div('');
  body.style.whiteSpace = 'pre-wrap';
  body.textContent = [
    '■ 파일',
    '· + PDF: 내 파일에서 PDF를 골라 불러와요 (여러 개 가능)',
    '· 파일 오른쪽 ⋮ 또는 꾹 누르기: 이름 바꾸기 · 과목 이동 · 삭제',
    '· 과목 탭을 한 번 더 누르거나 꾹 누르기: 과목 이름 바꾸기 · 삭제',
    '',
    '■ 체크칸',
    '· 문제 번호 옆에 체크칸이 자동으로 생겨요',
    '· 탭할 때마다 빈칸 → V → W → 빈칸',
    '· 위의 ☐ 버튼 (PC는 S): 새 체크칸 → 끌어서 위치 잡고 [고정] (` 또는 Enter) · 취소는 Esc',
    '',
    '■ 주석 · 빈칸',
    '· 글자 위를 꾹 누른 채로 끌면 영역이 선택돼요',
    '· 아래 [주석] [빈칸] [빈칸+주석] [메모] 중 하나를 누르세요',
    '· 메모: 누르지 않아도 글자가 바로 보이는 메모지',
    '· 빈칸: 탭하면 보이고, 다시 탭하면 가려져요',
    '· 주석: 주황 세모 표시. 탭하면 열리고 다시 탭하면 닫혀요',
    '· 주석 굵게: 글자 고르고 Ctrl+B (또는 [B 굵게] 버튼) → **글자**',
    '· 주석 표: [표] 버튼 또는 | 칸 | 칸 | 다음 줄 |---|---| 형식 (표 줄에서 Enter는 줄바꿈, Ctrl+Enter 저장)',
    '· 빈칸과 주석이 겹치면: 빈칸 → 글자 → 주석 열기 → 닫기 → 다시 빈칸',
    '· 표시를 꾹 누르면 수정 · 삭제 메뉴가 떠요',
    '',
    '■ 기타',
    '· 두 손가락으로 벌리면 확대, 오므리면 축소',
    '· 위의 100% 버튼: 100% ↔ 200% 바로 전환',
    '',
    '■ PC (마우스 · 키보드)',
    '· 그냥 드래그하면 영역 선택',
    '· 우클릭: 표시 수정 · 삭제 메뉴 (메뉴에서 Q 위치 이동 · X X표시/빈칸 추가 · W 표시 지우기 · E 주석 수정 · Z 주석 달기 · D 삭제)',
    '· 체크칸 우클릭 → 체크칸 이동: 끌어서 옮기고 ` 또는 Enter 고정 · Esc 취소 · 방향키 미세조정',
    '· 오른쪽 버튼 누른 채 끌기: 화면 잡고 이동',
    '· 선택 후 Z 주석 · X 빈칸 · C 빈칸+주석 · A 메모(바로 보임) · Esc 취소',
    '· 주석 입력: Enter 저장 · Shift+Enter 줄바꿈',
    '· S 체크칸 추가 · A 100%↔200% · Ctrl+Z 되돌리기',
    '',
    '· ↶ 되돌리기',
    '· 데이터는 폰 안에만 저장돼요. 메뉴에서 가끔 백업하세요.',
  ].join('\n');
  showModal({ title: '사용법', body, actions: [{ label: '닫기', value: null, cls: 'primary' }] });
}

/* =========================================================
   뷰어
   ========================================================= */
const BOX = 0.0243; // 체크칸 한 변 = 페이지 너비의 2.43%
const MIN_Z = 0.5, MAX_Z = 5;
const scroller = $('#scroller');
const pagesEl = $('#pages');

const V = {
  file: null, doc: null, pages: [], token: 0,
  zoom: 1, scale: 1, items: [], autoDone: false,
  checkMode: false, undo: [], runtime: new Map(),
  sel: null, selEl: null, io: null,
};

async function openFile(id) {
  const token = ++V.token;
  const meta = await dbGet('files', id);
  const b = await dbGet('blobs', id);
  if (!meta || !b) { toast('파일을 찾을 수 없어요'); return; }
  showScreen('viewer');
  history.pushState({ wox: 'viewer' }, '');
  V.file = meta;
  $('#doc-title').textContent = meta.name;
  $('#page-ind').textContent = '여는 중…';
  pagesEl.innerHTML = '';
  const m = (await dbGet('marks', id)) || { id, items: [], autoDone: false };
  V.items = m.items;
  V.autoDone = m.autoDone;
  V.undo = [];
  V.runtime.clear();
  clearSel();
  setCheckMode(false);
  try {
    V.doc = await pdfjsLib.getDocument({ data: await b.blob.arrayBuffer(), ...PDF_OPTS }).promise;
  } catch (err) {
    console.error(err);
    toast('PDF를 열 수 없어요');
    history.back();
    return;
  }
  if (token !== V.token) return;
  V.pages = [];
  for (let i = 1; i <= V.doc.numPages; i++) {
    const p = await V.doc.getPage(i);
    if (token !== V.token) return;
    const vp = p.getViewport({ scale: 1 });
    V.pages.push({ num: i, pdfPage: p, w: vp.width, h: vp.height });
  }
  V.zoom = meta.zoom || 1;
  buildPages();
  renderAllMarks();
  requestAnimationFrame(() => {
    scroller.scrollTop = (meta.scrollRatio || 0) * scroller.scrollHeight;
    updatePageInd();
  });
  meta.opened = Date.now();
  dbPut('files', meta);
  if (!V.autoDone) autoPlaceChecks(token);
}

function fitWidth() { return Math.min(scroller.clientWidth - 16, 900); }

function buildPages() {
  pagesEl.innerHTML = '';
  if (V.io) V.io.disconnect();
  V.io = new IntersectionObserver(onPageVisibility, { root: scroller, rootMargin: '120% 0px' });
  for (const pg of V.pages) {
    const el = div('page');
    el.dataset.page = pg.num;
    const cv = document.createElement('canvas');
    const layer = div('layer');
    const num = div('page-num');
    num.textContent = pg.num;
    el.append(cv, layer, num);
    pagesEl.appendChild(el);
    Object.assign(pg, { el, canvas: cv, layer, rendered: null, visible: false, task: null });
    V.io.observe(el);
  }
  layoutPages();
}

function layoutPages() {
  const maxW = Math.max(...V.pages.map((p) => p.w));
  V.scale = (fitWidth() * V.zoom) / maxW;
  for (const pg of V.pages) {
    pg.el.style.width = pg.w * V.scale + 'px';
    pg.el.style.height = pg.h * V.scale + 'px';
    if (pg.visible) renderPage(pg);
  }
}

function onPageVisibility(entries) {
  for (const e of entries) {
    const pg = V.pages[+e.target.dataset.page - 1];
    if (!pg) continue;
    pg.visible = e.isIntersecting;
    if (pg.visible) renderPage(pg);
    else freePage(pg);
  }
}

function freePage(pg) {
  if (pg.task) { pg.task.cancel(); pg.task = null; }
  pg.canvas.width = 0;
  pg.canvas.height = 0;
  pg.rendered = null;
}

async function renderPage(pg) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  let px = V.scale * dpr;
  const maxPx = 12e6;
  if (pg.w * pg.h * px * px > maxPx) px = Math.sqrt(maxPx / (pg.w * pg.h));
  const key = px.toFixed(3);
  if (pg.rendered === key) return;
  if (pg.task) pg.task.cancel();
  const vp = pg.pdfPage.getViewport({ scale: px });
  const cv = document.createElement('canvas');
  cv.width = Math.floor(vp.width);
  cv.height = Math.floor(vp.height);
  const task = pg.pdfPage.render({ canvasContext: cv.getContext('2d'), viewport: vp });
  pg.task = task;
  try { await task.promise; } catch (err) { return; }
  if (pg.task !== task) return;
  pg.task = null;
  pg.canvas.replaceWith(cv);
  pg.canvas = cv;
  pg.rendered = key;
}

function updatePageInd() {
  if (!V.pages.length) return;
  const mid = scroller.scrollTop + scroller.clientHeight / 3;
  let cur = 1;
  for (const pg of V.pages) if (pg.el.offsetTop <= mid) cur = pg.num;
  $('#page-ind').textContent = `${cur} / ${V.pages.length}쪽`;
  $('#btn-zoom').textContent = `${Math.round(V.zoom * 100)}%`;
}

// 100% ↔ 200% 바로 전환 (화면 가운데를 기준으로)
function toggleZoom() {
  const mx = scroller.clientWidth / 2, my = scroller.clientHeight / 2;
  applyZoom(Math.abs(V.zoom - 1) < 0.05 ? 2 : 1, {
    cx: scroller.scrollLeft + mx, cy: scroller.scrollTop + my, mx, my,
  });
}
$('#btn-zoom').onclick = toggleZoom;
let scrollRaf = 0;
scroller.addEventListener('scroll', () => {
  if (scrollRaf) return;
  scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; updatePageInd(); });
});

function applyZoom(z, anchor) {
  z = clamp(z, MIN_Z, MAX_Z);
  const f = z / V.zoom;
  V.zoom = z;
  layoutPages();
  if (anchor) {
    scroller.scrollLeft = anchor.cx * f - anchor.mx;
    scroller.scrollTop = anchor.cy * f - anchor.my;
  }
  updatePageInd();
  saveViewState();
}

let resizeT = 0;
window.addEventListener('resize', () => {
  if (!V.file) return;
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const ratio = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
    layoutPages();
    scroller.scrollTop = ratio * scroller.scrollHeight;
  }, 150);
});

function saveViewState() {
  if (!V.file) return;
  V.file.zoom = V.zoom;
  V.file.scrollRatio = scroller.scrollTop / Math.max(1, scroller.scrollHeight);
  dbPut('files', V.file);
}

async function closeViewer() {
  if (!V.file) { showScreen('library'); return; }
  if (V.moving) endMoveCheck(true);
  saveViewState();
  await flushMarks();
  V.token++;
  if (V.io) V.io.disconnect();
  for (const pg of V.pages) if (pg.task) pg.task.cancel();
  if (V.doc) V.doc.destroy();
  V.doc = null;
  V.pages = [];
  V.file = null;
  pagesEl.innerHTML = '';
  clearSel();
  showScreen('library');
  loadLibrary();
}

$('#btn-back').onclick = () => history.back();
window.addEventListener('popstate', () => {
  if (modalResolve) {
    closeModal(null);
    if (V.file) history.pushState({ wox: 'viewer' }, '');
    return;
  }
  if (V.file) closeViewer();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && V.file) { saveViewState(); flushMarks(); }
});

/* ---------------- 표시(마크) 데이터 ---------------- */
// check: {id,type:'check',page,x,y,state(0/1/2),auto?}
// note : {id,type:'note',page,x,y,w,h,text}
// blank: {id,type:'blank',page,x,y,w,h}
// 좌표는 모두 페이지 기준 0~1 비율 → 확대해도 그대로

let saveT = 0;
function saveMarks() { clearTimeout(saveT); saveT = setTimeout(flushMarks, 250); }
function flushMarks() {
  clearTimeout(saveT);
  if (!V.file) return Promise.resolve();
  return dbPut('marks', { id: V.file.id, items: V.items, autoDone: V.autoDone, updated: Date.now() });
}
function snapshot() {
  V.undo.push(JSON.stringify(V.items));
  if (V.undo.length > 80) V.undo.shift();
}
$('#btn-undo').onclick = () => {
  if (V.moving) return;
  if (!V.undo.length) { toast('되돌릴 게 없어요'); return; }
  V.items = JSON.parse(V.undo.pop());
  renderAllMarks();
  saveMarks();
};

const byId = (id) => V.items.find((x) => x.id === id);
function rt(id) {
  if (!V.runtime.has(id)) V.runtime.set(id, { revealed: false, open: false, justClosed: false });
  return V.runtime.get(id);
}
function overlapRatio(a, b) { // a 면적 중 b와 겹치는 비율
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.max(1e-9, a.w * a.h);
}
const blanksOver = (note) =>
  V.items.filter((b) => b.type === 'blank' && b.page === note.page && overlapRatio(note, b) >= 0.5);
const notesUnder = (blank) =>
  V.items.filter((n) => n.type === 'note' && n.page === blank.page && overlapRatio(n, blank) >= 0.5);

function renderAllMarks() { for (const pg of V.pages) renderMarks(pg.num); }

function renderMarks(pnum) {
  const pg = V.pages[pnum - 1];
  if (!pg || !pg.layer) return;
  const L = pg.layer;
  L.innerHTML = '';
  const pops = [];
  for (const it of V.items) {
    if (it.page !== pnum) continue;
    if (it.type === 'check') {
      const d = div('chk s' + it.state);
      d.style.left = it.x * 100 + '%';
      d.style.top = it.y * 100 + '%';
      d.textContent = ['', 'V', 'W', 'X'][it.state];
      d.dataset.id = it.id;
      if (V.moving && V.moving.ids.includes(it.id)) d.classList.add('moving');
      L.appendChild(d);
      continue;
    }
    if (it.type === 'memo') { // 메모: 누르지 않아도 글자가 바로 보이는 메모지 (너비 = 선택 영역, 높이 = 내용)
      const m = div('memo');
      m.dataset.id = it.id;
      m.style.left = it.x * 100 + '%';
      m.style.top = it.y * 100 + '%';
      m.style.width = it.w * 100 + '%';
      m.innerHTML = noteHtml(it.text);
      if (V.moving && V.moving.ids.includes(it.id)) m.classList.add('moving');
      L.appendChild(m);
      continue;
    }
    const d = div(it.type);
    d.dataset.id = it.id;
    d.style.left = it.x * 100 + '%';
    d.style.top = it.y * 100 + '%';
    d.style.width = it.w * 100 + '%';
    d.style.height = it.h * 100 + '%';
    const r = rt(it.id);
    if (it.type === 'blank') d.classList.add(r.revealed ? 'revealed' : 'covered');
    if (it.type === 'note' && r.open) { d.classList.add('open'); pops.push(it); }
    if (V.moving && V.moving.ids.includes(it.id)) d.classList.add('moving');
    L.appendChild(d);
    const b = it.type === 'note' ? blanksOver(it)[0] : null;
    // 빈칸이 가려져 있으면 세모도 숨긴다 (빈칸을 열어야 주석 표시가 보임)
    if (it.type === 'note' && !(b && !rt(b.id).revealed)) {
      // 세모: 세로 = 겹친 빈칸 세로(없으면 주석 영역 세로)의 절반, 가로 = 세로와 같은 길이
      const top = b ? b.y : it.y, h = (b ? b.h : it.h) / 2;
      const tri = div('note-tri');
      tri.dataset.id = it.id;
      tri.style.left = it.x * 100 + '%';
      tri.style.top = top * 100 + '%';
      tri.style.height = h * 100 + '%';
      tri.style.width = (h * pg.h / pg.w) * 100 + '%';
      L.appendChild(tri);
    }
  }
  for (const n of pops) {
    const p = div('note-pop');
    p.innerHTML = noteHtml(n.text);
    if (n.x > 0.55) p.style.right = (1 - n.x - n.w) * 100 + '%';
    else p.style.left = n.x * 100 + '%';
    if (n.y + n.h > 0.8) p.style.bottom = `calc(${(1 - n.y) * 100}% + 4px)`;
    else p.style.top = `calc(${(n.y + n.h) * 100}% + 4px)`;
    L.appendChild(p);
  }
  if (V.sel && V.sel.page === pnum) {
    V.selEl = div('sel');
    placeSel();
    L.appendChild(V.selEl);
  }
}

function placeSel() {
  const s = V.sel;
  Object.assign(V.selEl.style, {
    left: s.x * 100 + '%', top: s.y * 100 + '%', width: s.w * 100 + '%', height: s.h * 100 + '%',
  });
}

function addItem(it) {
  snapshot();
  V.items.push(it);
  renderMarks(it.page);
  saveMarks();
}
function removeItem(id) {
  const it = byId(id);
  if (!it) return;
  snapshot();
  V.items = V.items.filter((x) => x.id !== id);
  V.runtime.delete(id);
  renderMarks(it.page);
  saveMarks();
}

/* ---- 탭 동작 ---- */
function cycleCheck(it) {
  snapshot();
  it.state = it.state === 3 ? 0 : (it.state + 1) % 3; // 탭: 빈칸→V→W→빈칸, X는 탭하면 빈칸으로
  renderMarks(it.page);
  saveMarks();
}

function tapBlank(b) {
  const r = rt(b.id);
  if (!r.revealed) {
    r.revealed = true;
  } else {
    r.revealed = false;
    for (const n of notesUnder(b)) Object.assign(rt(n.id), { open: false, justClosed: false });
  }
  renderMarks(b.page);
}

// 겹친 경우: 빈칸 → (탭) 글자+주석표시 → (탭) 주석 열림 → (탭) 닫힘 → (탭) 다시 빈칸
function tapNote(n) {
  const r = rt(n.id);
  const parent = blanksOver(n).find((b) => rt(b.id).revealed);
  if (r.open) {
    r.open = false;
    r.justClosed = !!parent;
  } else if (r.justClosed && parent) {
    r.justClosed = false;
    rt(parent.id).revealed = false;
  } else {
    r.open = true;
    r.justClosed = false;
  }
  renderMarks(n.page);
}

function closeAllNotes() {
  let changed = false;
  for (const it of V.items) {
    if (it.type !== 'note') continue;
    const r = rt(it.id);
    if (r.open) { r.open = false; changed = true; }
  }
  if (changed) renderAllMarks();
}

function handleTap(target, x, y) {
  if (V.sel) { clearSel(); return; }
  const markEl = target.closest('[data-id]');
  const pageEl = target.closest('.page');
  if (V.checkMode) {
    if (markEl && markEl.classList.contains('chk')) cycleCheck(byId(markEl.dataset.id));
    else if (pageEl) addCheckAt(pageEl, x, y);
    return;
  }
  if (!markEl) { closeAllNotes(); return; }
  const it = byId(markEl.dataset.id);
  if (!it) return;
  if (it.type === 'check') cycleCheck(it);
  else if (it.type === 'blank') tapBlank(it);
  else if (it.type === 'note') tapNote(it);
  // memo: 탭해도 그대로 (항상 보임)
}

async function handleLongPress(target) {
  const markEl = target.closest('[data-id]');
  if (!markEl) return;
  const it = byId(markEl.dataset.id);
  if (!it) return;
  if (it.type === 'check') {
    if (V.checkMode) { removeItem(it.id); toast('체크칸을 지웠어요'); return; }
    const v = await sheet('체크칸', [
      { label: '체크칸 이동', value: 'move', key: 'Q' },
      { label: 'X 표시', value: 'x', key: 'X' },
      { label: '표시 지우기 (빈 네모로)', value: 'reset', key: 'W' },
      { label: '체크칸 삭제', value: 'del', cls: 'danger', key: 'D' },
    ]);
    if (v === 'move') startMoveCheck(it);
    else if (v === 'x') { snapshot(); it.state = 3; renderMarks(it.page); saveMarks(); }
    else if (v === 'reset') { snapshot(); it.state = 0; renderMarks(it.page); saveMarks(); }
    else if (v === 'del') removeItem(it.id);
  } else if (it.type === 'note') {
    const v = await sheet('주석', [
      { label: '주석 위치 이동', value: 'move', key: 'Q' },
      { label: '이 주석에 빈칸 추가', value: 'blank', key: 'X' },
      { label: '주석 수정', value: 'edit', key: 'E' },
      { label: '주석 삭제', value: 'del', cls: 'danger', key: 'D' },
    ]);
    if (v === 'move') startMoveCheck(it);
    else if (v === 'blank') {
      // 주석과 같은 자리·크기로 빈칸 → C로 만든 빈칸+주석 쌍과 똑같이 동작
      if (V.items.some((o) => o.type === 'blank' && sameRect(o, it))) { toast('이미 빈칸이 있어요'); return; }
      Object.assign(rt(it.id), { open: false, justClosed: false });
      addItem({ id: uid(), type: 'blank', page: it.page, x: it.x, y: it.y, w: it.w, h: it.h });
    } else if (v === 'edit') {
      const text = await promptBox('주석 수정', it.text, { multiline: true });
      if (text !== null && text.trim()) { snapshot(); it.text = text.trim(); renderMarks(it.page); saveMarks(); }
    } else if (v === 'del') removeItem(it.id);
  } else if (it.type === 'blank') {
    const v = await sheet('빈칸', [
      { label: '빈칸 위치 이동', value: 'move', key: 'Q' },
      { label: '이 빈칸에 주석 달기', value: 'note', key: 'Z' },
      { label: '빈칸 삭제', value: 'del', cls: 'danger', key: 'D' },
    ]);
    if (v === 'move') startMoveCheck(it);
    else if (v === 'note') {
      const text = await promptBox('주석 달기', '', { multiline: true });
      if (text && text.trim()) addItem({ id: uid(), type: 'note', page: it.page, x: it.x, y: it.y, w: it.w, h: it.h, text: text.trim() });
    } else if (v === 'del') removeItem(it.id);
  } else if (it.type === 'memo') {
    const v = await sheet('메모', [
      { label: '메모 위치 이동', value: 'move', key: 'Q' },
      { label: '메모 수정', value: 'edit', key: 'E' },
      { label: '메모 삭제', value: 'del', cls: 'danger', key: 'D' },
    ]);
    if (v === 'move') startMoveCheck(it);
    else if (v === 'edit') {
      const text = await promptBox('메모 수정', it.text, { multiline: true });
      if (text !== null && text.trim()) { snapshot(); it.text = text.trim(); renderMarks(it.page); saveMarks(); }
    } else if (v === 'del') removeItem(it.id);
  }
}

/* ---- 표시 이동 (체크칸·주석·빈칸 공통: 메뉴 → 끌기/클릭 → ` 또는 Enter 고정 · Esc 취소) ----
   같은 자리에 겹친 빈칸+주석 쌍(C로 만든 것)은 함께 움직인다 */
const sameRect = (a, b) => a.page === b.page && ['x', 'y', 'w', 'h'].every((k) => Math.abs(a[k] - b[k]) < 0.003);
const movingItems = () => V.moving.ids.map(byId).filter(Boolean);

function startMoveCheck(it, isNew = false) {
  clearSel();
  setCheckMode(false);
  if (!isNew) snapshot(); // 새 칸은 addCheckAndMove에서 이미 저장
  const group = it.type === 'check' ? [it]
    : [it, ...V.items.filter((o) => o !== it && o.type !== 'check' && sameRect(o, it))];
  for (const g of group) if (g.type === 'note') Object.assign(rt(g.id), { open: false, justClosed: false });
  V.moving = {
    id: it.id, ids: group.map((g) => g.id), isNew,
    orig: group.map((g) => ({ id: g.id, page: g.page, x: g.x, y: g.y })),
  };
  $('#move-bar').hidden = false;
  scroller.classList.add('moving-chk');
  renderMarks(it.page);
}

// 레이어를 다시 그리지 않고 위치만 바꾼다 (다시 그리면 손가락 아래 요소가 사라져 터치가 끊김)
function placeMoving(oldPage) {
  const items = movingItems();
  const page = items[0].page;
  if (page !== oldPage) { renderMarks(oldPage); renderMarks(page); return; }
  const L = V.pages[page - 1].layer;
  for (const g of items) {
    for (const el of L.querySelectorAll(`[data-id="${g.id}"]`)) {
      el.style.left = g.x * 100 + '%';
      el.style.top = g.y * 100 + '%';
    }
  }
}

function moveCheckTo(x, y) {
  const main = byId(V.moving.id);
  if (!main) return;
  const hit = document.elementFromPoint(x, y);
  const pageEl = (hit && hit.closest('.page')) || V.pages[main.page - 1].el;
  const r = pageEl.getBoundingClientRect();
  const page = +pageEl.dataset.page;
  const oldPage = main.page;
  let nx = clamp((x - r.left) / r.width, 0, 1);
  let ny = clamp((y - r.top) / r.height, 0, 1);
  if (main.type !== 'check') { // 영역은 가운데가 손가락(커서)에 오게
    nx = clamp(nx - main.w / 2, 0, 1 - main.w);
    ny = clamp(ny - main.h / 2, 0, 1 - main.h);
  }
  for (const g of movingItems()) Object.assign(g, { page, x: nx, y: ny });
  placeMoving(oldPage);
}

function nudgeCheck(dx, dy) {
  const main = byId(V.moving.id);
  if (!main) return;
  const pg = V.pages[main.page - 1];
  const w = main.type === 'check' ? 0 : main.w, h = main.type === 'check' ? 0 : main.h;
  const nx = clamp(main.x + dx, 0, 1 - w);
  const ny = clamp(main.y + dy * (pg.w / pg.h), 0, 1 - h); // 가로·세로 같은 거리만큼
  for (const g of movingItems()) Object.assign(g, { x: nx, y: ny });
  renderMarks(main.page);
}

function endMoveCheck(keep) {
  if (!V.moving) return;
  const pages = new Set();
  for (const g of movingItems()) pages.add(g.page);
  if (!keep) {
    if (V.moving.isNew) V.items = V.items.filter((x) => !V.moving.ids.includes(x.id)); // 새 칸 취소 = 안 만든 것으로
    else for (const o of V.moving.orig) { const g = byId(o.id); if (g) { Object.assign(g, o); pages.add(o.page); } }
    V.undo.pop();
  }
  V.moving = null;
  $('#move-bar').hidden = true;
  scroller.classList.remove('moving-chk');
  for (const p of pages) renderMarks(p);
  if (keep) { saveMarks(); toast('이 위치에 고정했어요', 1500); }
}
$('#btn-move-ok').onclick = () => endMoveCheck(true);

// 새 체크칸: 화면 가운데에 만들고 바로 이동 모드 (위치 잡고 Enter 고정 / Esc 취소)
function addCheckAndMove() {
  if (V.moving || !V.pages.length) return;
  const sr = scroller.getBoundingClientRect();
  const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2;
  const hit = document.elementFromPoint(cx, cy);
  let pageEl = hit && hit.closest('.page');
  if (!pageEl) { // 가운데가 페이지 사이 여백이면 가장 가까운 페이지
    let best = Infinity;
    for (const pg of V.pages) {
      const r = pg.el.getBoundingClientRect();
      const d = Math.abs((r.top + r.bottom) / 2 - cy);
      if (d < best) { best = d; pageEl = pg.el; }
    }
  }
  const r = pageEl.getBoundingClientRect();
  const it = {
    id: uid(), type: 'check', page: +pageEl.dataset.page, state: 0,
    x: clamp((cx - r.left) / r.width, 0.03, 0.97), y: clamp((cy - r.top) / r.height, 0.02, 0.98),
  };
  snapshot();
  V.items.push(it);
  startMoveCheck(it, true);
}
$('#btn-move-cancel').onclick = () => endMoveCheck(false);

function addCheckAt(pageEl, x, y) {
  const r = pageEl.getBoundingClientRect();
  addItem({
    id: uid(), type: 'check', page: +pageEl.dataset.page,
    x: clamp((x - r.left) / r.width, 0, 1), y: clamp((y - r.top) / r.height, 0, 1), state: 0,
  });
}

/* ---- 선택 영역 → 주석 / 빈칸 ---- */
function clearSel() {
  const had = V.sel;
  V.sel = null;
  if (V.selEl) { V.selEl.remove(); V.selEl = null; }
  $('#sel-bar').hidden = true;
  return had;
}
$('#btn-sel-cancel').onclick = () => clearSel();
$('#btn-sel-blank').onclick = () => {
  const s = clearSel();
  if (s) addItem({ id: uid(), type: 'blank', ...s });
};
// 빈칸 + 주석을 같은 영역에 한 번에 (되돌리기 한 번에 둘 다 취소)
// 메모: 선택 영역에 글자가 바로 보이는 메모지
$('#btn-sel-memo').onclick = async () => {
  const s = V.sel;
  if (!s) return;
  const text = await promptBox('메모', '', { multiline: true, placeholder: '페이지에 바로 보일 메모' });
  clearSel();
  if (text && text.trim()) addItem({ id: uid(), type: 'memo', ...s, text: text.trim() });
};
$('#btn-sel-both').onclick = async () => {
  const s = V.sel;
  if (!s) return;
  const text = await promptBox('빈칸 + 주석', '', { multiline: true, placeholder: '빈칸에 달 주석' });
  clearSel();
  if (!text || !text.trim()) return;
  snapshot();
  V.items.push({ id: uid(), type: 'blank', ...s }, { id: uid(), type: 'note', ...s, text: text.trim() });
  renderMarks(s.page);
  saveMarks();
};
$('#btn-sel-note').onclick = async () => {
  const s = V.sel;
  if (!s) return;
  const text = await promptBox('주석 달기', '', { multiline: true, placeholder: '예: SHA-3의 기반이 된 알고리즘' });
  clearSel();
  if (text && text.trim()) addItem({ id: uid(), type: 'note', ...s, text: text.trim() });
};

/* ---- 체크칸 배치 모드 ---- */
function setCheckMode(on) {
  V.checkMode = on;
  $('#btn-check-mode').classList.toggle('on', on);
  $('#mode-hint').hidden = !on;
  pagesEl.classList.toggle('checkmode', on);
}
$('#btn-check-mode').onclick = () => { clearSel(); addCheckAndMove(); };

/* ---- 문제 번호 / 선지 번호 옆 체크칸 자동 배치 ---- */
// prev: 다시 배치할 때 지운 예전 자동 체크칸 → 근처에 새로 생긴 칸에 V/W를 옮겨 준다
async function autoPlaceChecks(token, prev = []) {
  const found = [];
  const used = new Set();
  let expected = 1, qCount = 0, cCount = 0;
  for (const pg of V.pages) {
    let tc;
    try { tc = await pg.pdfPage.getTextContent(); } catch (err) { continue; }
    if (token !== V.token) return;
    const vp = pg.pdfPage.getViewport({ scale: 1 });
    const place = (item, frac) => {
      const [, , c, d, e, f] = item.transform;
      const fontH = Math.hypot(c, d) || 10;
      const [vx, vy] = vp.convertToViewportPoint(e + (item.width || 0) * frac, f);
      // 네모 오른쪽 끝과 번호 사이를 페이지 너비의 0.4%(약 3pt)만 띄운다
      const x = clamp((vx - BOX * vp.width / 2 - 0.004 * vp.width) / vp.width, BOX / 2, 1 - BOX / 2);
      const y = clamp((vy - fontH * 0.35) / vp.height, 0, 1);
      const near = V.items.concat(found).some((o) => o.type === 'check' && o.page === pg.num && Math.hypot(o.x - x, o.y - y) < 0.012);
      if (near) return false;
      let state = 0, best = 0.04;
      let match = null;
      for (const o of prev) {
        if (o.page !== pg.num || used.has(o.id) || Math.abs(o.y - y) > 0.012) continue;
        const dx = Math.abs(o.x - x);
        if (dx < best) { best = dx; match = o; }
      }
      if (match) { used.add(match.id); state = match.state; }
      found.push({ id: uid(), type: 'check', auto: true, page: pg.num, x, y, state });
      return true;
    };
    for (const item of tc.items) {
      const s = item.str;
      if (!s) continue;
      const m = s.match(/^\s*(\d{1,2})\s*\.(?!\d)/);
      if (m) {
        const n = +m[1];
        if (n >= expected && n <= expected + 2) {
          expected = n + 1;
          if (place(item, 0)) qCount++;
        }
      }
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i);
        if (code >= 0x2460 && code <= 0x2464 && place(item, i / s.length)) cCount++;
      }
    }
  }
  if (token !== V.token) return;
  V.autoDone = true;
  if (found.length) {
    V.items.push(...found);
    renderAllMarks();
    toast(`문제 번호 ${qCount}개${cCount ? `, 선지 ${cCount}개` : ''}에 체크칸을 넣었어요`, 3000);
  } else {
    toast('문제 번호를 자동으로 못 찾았어요. 위의 ☐ 버튼으로 직접 넣을 수 있어요', 3500);
  }
  saveMarks();
}

/* ---- 뷰어 메뉴 ---- */
$('#btn-view-menu').onclick = async () => {
  const v = await sheet('메뉴', [
    { label: '빈칸 모두 다시 가리기', value: 'cover' },
    { label: '빈칸 모두 보기', value: 'reveal' },
    { label: 'V/W 표시 모두 지우기 (다시 풀기)', value: 'resetchk' },
    { label: '체크칸 자동 배치 다시 하기', value: 'reauto' },
    { label: '체크칸 모두 삭제', value: 'delchk', cls: 'danger' },
    { label: '화면 너비에 맞추기', value: 'fit' },
  ]);
  if (v === 'cover' || v === 'reveal') {
    for (const it of V.items) {
      if (it.type === 'blank') rt(it.id).revealed = v === 'reveal';
      if (it.type === 'note') Object.assign(rt(it.id), { open: false, justClosed: false });
    }
    renderAllMarks();
  } else if (v === 'resetchk') {
    if (!(await confirmBox('V/W 지우기', '이 파일의 V/W 표시를 모두 빈 네모로 돌릴까요?', '지우기'))) return;
    snapshot();
    for (const it of V.items) if (it.type === 'check') it.state = 0;
    renderAllMarks();
    saveMarks();
  } else if (v === 'reauto') {
    snapshot();
    const prev = V.items.filter((it) => it.type === 'check' && it.auto);
    V.items = V.items.filter((it) => !(it.type === 'check' && it.auto));
    renderAllMarks();
    autoPlaceChecks(V.token, prev);
  } else if (v === 'delchk') {
    if (!(await confirmBox('체크칸 삭제', '이 파일의 체크칸을 모두 지울까요? (↶로 되돌릴 수 있어요)', '삭제', true))) return;
    snapshot();
    V.items = V.items.filter((it) => it.type !== 'check');
    renderAllMarks();
    saveMarks();
  } else if (v === 'fit') {
    applyZoom(1);
  }
};

/* =========================================================
   터치 제스처
   - 짧게 탭: 표시 조작 / (배치 모드) 체크칸 추가
   - 꾹 누른 뒤 끌기: 영역 선택
   - 꾹 누르고 그대로 떼기: 표시 메뉴
   - (배치 모드) 체크칸 끌기: 이동
   - 두 손가락: 확대/축소
   ========================================================= */
const LONG_MS = 380, MOVE_TOL = 10;
const G = { mode: null, timer: 0 };

function gBegin(x, y, target, mouse = false) {
  clearTimeout(G.timer);
  if (V.moving) { // 체크칸 이동 모드: 누른 곳으로 바로 옮기고 끄는 대로 따라감
    G.mode = 'movechk';
    moveCheckTo(x, y);
    return;
  }
  Object.assign(G, {
    mode: 'pending', sx: x, sy: y, target, mouse,
    pageEl: target.closest('.page'),
    chkEl: V.checkMode ? target.closest('.chk') : null,
  });
  G.timer = setTimeout(() => {
    if (G.mode !== 'pending') return;
    G.mode = 'held';
    if (navigator.vibrate) navigator.vibrate(12);
  }, LONG_MS);
}

// true를 돌려주면 브라우저 기본 스크롤을 막는다
function gMove(x, y) {
  if (G.mode === 'movechk') { moveCheckTo(x, y); return true; }
  const dist = Math.hypot(x - G.sx, y - G.sy);
  if (G.mode === 'pending') {
    if (G.chkEl) {
      if (dist > 4) {
        clearTimeout(G.timer);
        G.mode = 'dragchk';
        G.chkItem = byId(G.chkEl.dataset.id);
        snapshot();
        G.chkEl.classList.add('dragging');
      }
      return true;
    }
    if (dist > MOVE_TOL) {
      clearTimeout(G.timer);
      // 마우스는 드래그해도 스크롤되지 않으니 꾹 누를 필요 없이 바로 선택
      if (G.mouse) G.mode = 'held';
      else { G.mode = 'scroll'; return false; }
    } else return false;
  }
  if (G.mode === 'held') {
    if (dist > MOVE_TOL && G.pageEl && !V.checkMode) {
      clearSel();
      const r = G.pageEl.getBoundingClientRect();
      G.nx0 = clamp((G.sx - r.left) / r.width, 0, 1);
      G.ny0 = clamp((G.sy - r.top) / r.height, 0, 1);
      G.mode = 'select';
      V.sel = { page: +G.pageEl.dataset.page, x: G.nx0, y: G.ny0, w: 0, h: 0 };
      // 레이어를 다시 그리면 손가락이 닿은 요소가 사라져 터치가 끊기므로 선택 상자만 붙인다
      V.selEl = div('sel');
      placeSel();
      V.pages[V.sel.page - 1].layer.appendChild(V.selEl);
    }
    return true;
  }
  if (G.mode === 'select') {
    const sr = scroller.getBoundingClientRect();
    if (y < sr.top + 40) scroller.scrollTop -= 10;
    else if (y > sr.bottom - 40) scroller.scrollTop += 10;
    const r = G.pageEl.getBoundingClientRect();
    const nx = clamp((x - r.left) / r.width, 0, 1);
    const ny = clamp((y - r.top) / r.height, 0, 1);
    Object.assign(V.sel, {
      x: Math.min(G.nx0, nx), y: Math.min(G.ny0, ny), w: Math.abs(nx - G.nx0), h: Math.abs(ny - G.ny0),
    });
    placeSel();
    return true;
  }
  if (G.mode === 'dragchk') {
    const r = G.pageEl.getBoundingClientRect();
    G.chkItem.x = clamp((x - r.left) / r.width, 0, 1);
    G.chkItem.y = clamp((y - r.top) / r.height, 0, 1);
    G.chkEl.style.left = G.chkItem.x * 100 + '%';
    G.chkEl.style.top = G.chkItem.y * 100 + '%';
    return true;
  }
  return G.mode === 'pinch' || G.mode === 'ignore';
}

function gEnd() {
  clearTimeout(G.timer);
  const mode = G.mode;
  G.mode = null;
  if (mode === 'movechk') return true; // 고정은 Enter / [고정] 버튼으로
  if (mode === 'pending') handleTap(G.target, G.sx, G.sy);
  else if (mode === 'held') handleLongPress(G.target);
  else if (mode === 'select') {
    const r = G.pageEl.getBoundingClientRect();
    if (V.sel.w * r.width < 8 || V.sel.h * r.height < 5) clearSel();
    else $('#sel-bar').hidden = false;
  } else if (mode === 'dragchk') {
    G.chkEl.classList.remove('dragging');
    renderMarks(G.chkItem.page);
    saveMarks();
  }
  return mode !== 'scroll' && mode !== null;
}

/* ---- 두 손가락 확대 ---- */
function pinchStart(t) {
  clearTimeout(G.timer);
  if (G.mode === 'select') clearSel();
  if (G.mode === 'dragchk') { G.chkEl.classList.remove('dragging'); renderMarks(G.chkItem.page); saveMarks(); }
  const [a, b] = [t[0], t[1]];
  const sr = scroller.getBoundingClientRect();
  G.mode = 'pinch';
  G.d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
  G.z0 = V.zoom;
  G.ps = 1;
  G.mx = (a.clientX + b.clientX) / 2 - sr.left;
  G.my = (a.clientY + b.clientY) / 2 - sr.top;
  G.cx = scroller.scrollLeft + G.mx;
  G.cy = scroller.scrollTop + G.my;
  pagesEl.style.transformOrigin = `${G.cx}px ${G.cy}px`;
}
function pinchMove(t) {
  const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  G.ps = clamp(G.z0 * (d / G.d0), MIN_Z, MAX_Z) / G.z0;
  pagesEl.style.transform = `scale(${G.ps})`;
}
function pinchEnd() {
  pagesEl.style.transform = '';
  G.mode = 'ignore';
  if (Math.abs(G.ps - 1) > 0.02) applyZoom(G.z0 * G.ps, { cx: G.cx, cy: G.cy, mx: G.mx, my: G.my });
}

let lastTouch = 0;
scroller.addEventListener('touchstart', (e) => {
  lastTouch = Date.now();
  if (e.touches.length === 2) { pinchStart(e.touches); e.preventDefault(); return; }
  if (e.touches.length > 2) return;
  if (G.mode === 'ignore') return;
  gBegin(e.touches[0].clientX, e.touches[0].clientY, e.target);
}, { passive: false });

scroller.addEventListener('touchmove', (e) => {
  lastTouch = Date.now();
  if (G.mode === 'pinch') {
    if (e.touches.length >= 2) pinchMove(e.touches);
    e.preventDefault();
    return;
  }
  if (G.mode === 'ignore') { e.preventDefault(); return; }
  const t = e.touches[0];
  if (gMove(t.clientX, t.clientY) && e.cancelable) e.preventDefault();
}, { passive: false });

scroller.addEventListener('touchend', (e) => {
  lastTouch = Date.now();
  if (G.mode === 'pinch') { if (e.touches.length < 2) pinchEnd(); if (!e.touches.length) G.mode = null; e.preventDefault(); return; }
  if (G.mode === 'ignore') { if (!e.touches.length) G.mode = null; e.preventDefault(); return; }
  if (e.touches.length) return;
  if (gEnd() && e.cancelable) e.preventDefault(); // 가짜 click/mouse 이벤트 막기
});
scroller.addEventListener('touchcancel', () => {
  clearTimeout(G.timer);
  if (G.mode === 'pinch') pinchEnd();
  if (G.mode === 'select') clearSel();
  G.mode = null;
});
// 우클릭 = 폰에서 꾹 누르기 (표시 수정·삭제 메뉴)
// 폰에서 꾹 누를 때도 contextmenu가 오지만 그건 터치 제스처가 이미 처리한다
scroller.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (Date.now() - lastTouch < 1000) return;
  if (pan.moved) { pan.moved = false; return; } // 오른쪽 버튼으로 화면을 끈 경우엔 메뉴 안 띄움
  clearTimeout(G.timer);
  G.mode = null;
  mouseDown = false;
  handleLongPress(e.target);
});

/* PC 마우스 */
let mouseDown = false;
scroller.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || Date.now() - lastTouch < 1000) return;
  e.preventDefault(); // 드래그할 때 글자·이미지 끌기 방지
  mouseDown = true;
  gBegin(e.clientX, e.clientY, e.target, true);
});
window.addEventListener('mousemove', (e) => { if (mouseDown) gMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { if (mouseDown) { mouseDown = false; gEnd(); } });

/* 오른쪽 버튼 누른 채 끌기 = 화면 잡고 이동 (끌지 않고 떼면 기존 우클릭 메뉴) */
const pan = { on: false, moved: false, x: 0, y: 0, sl: 0, st: 0 };
scroller.addEventListener('mousedown', (e) => {
  if (e.button !== 2 || Date.now() - lastTouch < 1000) return;
  Object.assign(pan, { on: true, moved: false, x: e.clientX, y: e.clientY, sl: scroller.scrollLeft, st: scroller.scrollTop });
});
window.addEventListener('mousemove', (e) => {
  if (!pan.on) return;
  const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
  if (!pan.moved && Math.hypot(dx, dy) < 5) return;
  if (!pan.moved) { pan.moved = true; scroller.classList.add('panning'); }
  scroller.scrollLeft = pan.sl - dx;
  scroller.scrollTop = pan.st - dy;
});
window.addEventListener('mouseup', (e) => {
  if (e.button !== 2 || !pan.on) return;
  pan.on = false;
  scroller.classList.remove('panning');
  // 창 밖에서 떼면 contextmenu가 안 오므로 잠시 뒤 표시 초기화
  if (pan.moved) setTimeout(() => { pan.moved = false; }, 300);
});
scroller.addEventListener('wheel', (e) => {
  if (!e.ctrlKey || !V.file) return;
  e.preventDefault();
  const sr = scroller.getBoundingClientRect();
  const mx = e.clientX - sr.left, my = e.clientY - sr.top;
  applyZoom(V.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), { cx: scroller.scrollLeft + mx, cy: scroller.scrollTop + my, mx, my });
}, { passive: false });

/* =========================================================
   단축키 (한글 입력 상태여도 동작하도록 e.code 사용)
   - 영역 선택 후: Z 주석 · X 빈칸 · C 빈칸+주석 · A 메모 · Esc 취소
   - Ctrl+Z 되돌리기 · A 100%↔200%
   - 입력창: Enter 저장 · Shift+Enter 줄바꿈 · Esc 닫기
   ========================================================= */
document.addEventListener('keydown', (e) => {
  if (e.isComposing) return;
  if (modalResolve) {
    if (e.key === 'Escape') { e.preventDefault(); closeModal(null); return; }
    const field = e.target.closest && e.target.closest('#modal-body textarea, #modal-body input');
    if (!field && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const hit = document.querySelector(`#modal-actions .btn[data-key="${e.code}"]`);
      if (hit) { e.preventDefault(); hit.click(); return; }
    }
    if (field && e.key === 'Enter' && !e.shiftKey) {
      const v = field.value, a = field.selectionStart;
      const line = v.slice(v.lastIndexOf('\n', a - 1) + 1, a);
      const inTable = field.tagName === 'TEXTAREA' && /^\s*\|/.test(line);
      if (inTable && !(e.ctrlKey || e.metaKey)) return; // 표 줄: 기본 줄바꿈
      e.preventDefault();
      $('#modal-actions .btn.primary').click();
    }
    return;
  }
  if (!V.file) return;
  if (V.moving) {
    const step = e.shiftKey ? 0.01 : 0.002;
    const arrows = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (e.key === 'Enter' || e.code === 'Backquote') { e.preventDefault(); endMoveCheck(true); } // ` 는 Esc 바로 아래라 가까움
    else if (e.key === 'Escape') { e.preventDefault(); endMoveCheck(false); }
    else if (arrows[e.key]) { e.preventDefault(); nudgeCheck(...arrows[e.key]); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); $('#btn-undo').click(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (V.sel && !$('#sel-bar').hidden) {
    if (e.code === 'KeyZ') { e.preventDefault(); $('#btn-sel-note').click(); return; }
    if (e.code === 'KeyX') { e.preventDefault(); $('#btn-sel-blank').click(); return; }
    if (e.code === 'KeyC') { e.preventDefault(); $('#btn-sel-both').click(); return; }
    if (e.code === 'KeyA') { e.preventDefault(); $('#btn-sel-memo').click(); return; }
    if (e.key === 'Escape') { e.preventDefault(); clearSel(); return; }
  }
  if (e.code === 'KeyA') { e.preventDefault(); toggleZoom(); }
  else if (e.code === 'KeyS') { e.preventDefault(); clearSel(); addCheckAndMove(); }
  else if (e.key === 'Escape' && V.checkMode) setCheckMode(false);
});

/* =========================================================
   시작
   ========================================================= */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
/* =========================================================
   PC 폴더 자동 저장 (PC 크롬·엣지 전용, File System Access API)
   - 브라우저 저장소 = 작업용, PC 폴더 = 원본 사본
   - 폴더 구조: 과목/파일이름.pdf + 과목/파일이름.wox.json(표시) + wox-library.json(목록)
   - 시작할 때 폴더에서 빠진 파일·더 최신 표시를 불러오고, 바뀐 건 폴더로 쓴다
   ========================================================= */
const disk = {
  handle: null, ok: false, lastIndex: null, full: true,
  dirtyMarks: new Set(), timer: 0, chain: Promise.resolve(), savedAt: 0, error: '',
};

function diskNotify(store, id) {
  if (!disk.handle || store === 'settings') return;
  if (store === 'marks') disk.dirtyMarks.add(id);
  clearTimeout(disk.timer);
  disk.timer = setTimeout(() => diskQueue(diskSync), 1200);
}
function diskQueue(fn) {
  disk.chain = disk.chain.then(fn).catch((err) => {
    console.error(err);
    disk.error = String((err && err.message) || err);
    renderDiskStatus();
  });
  return disk.chain;
}

const safeName = (n) =>
  String(n || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 100) || '이름없음';

async function fsDir(root, parts, create) {
  let d = root;
  for (const p of parts) d = await d.getDirectoryHandle(p, { create });
  return d;
}
async function fsWrite(root, path, data) {
  const parts = path.split('/');
  const name = parts.pop();
  const fh = await (await fsDir(root, parts, true)).getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}
async function fsRead(root, path) { // 없으면 null
  try {
    const parts = path.split('/');
    const name = parts.pop();
    return await (await (await fsDir(root, parts, false)).getFileHandle(name)).getFile();
  } catch (e) { return null; }
}
async function fsRemove(root, path) {
  try {
    const parts = path.split('/');
    const name = parts.pop();
    await (await fsDir(root, parts, false)).removeEntry(name);
    if (parts.length) { // 빈 과목 폴더 정리 (안 비었으면 실패 → 무시)
      const parent = await fsDir(root, parts.slice(0, -1), false);
      await parent.removeEntry(parts[parts.length - 1]).catch(() => {});
    }
  } catch (e) { /* 이미 없음 */ }
}

async function diskPermission(ask) {
  const h = disk.handle;
  if (!h) return false;
  if (!h.queryPermission) return true;
  const opt = { mode: 'readwrite' };
  if ((await h.queryPermission(opt)) === 'granted') return true;
  return ask ? (await h.requestPermission(opt)) === 'granted' : false;
}

// 폴더 → 브라우저: 브라우저에 없는 파일, 폴더 쪽이 더 최신인 표시를 가져온다
async function diskPull() {
  const root = disk.handle;
  const f = await fsRead(root, 'wox-library.json');
  if (!f) return 0;
  let idx;
  try { idx = JSON.parse(await f.text()); } catch (e) { return 0; }
  disk.lastIndex = idx;
  const localFolders = new Set((await dbAll('folders')).map((x) => x.id));
  const localFiles = new Set((await dbAll('files')).map((x) => x.id));
  let pulled = 0;
  for (const fo of idx.folders || []) if (!localFolders.has(fo.id)) await rawPut('folders', fo);
  for (const fm of idx.files || []) {
    if (!fm.diskPath) continue;
    if (!localFiles.has(fm.id)) {
      const pdf = await fsRead(root, fm.diskPath + '.pdf');
      if (!pdf) continue;
      await rawPut('blobs', { id: fm.id, blob: new Blob([await pdf.arrayBuffer()], { type: 'application/pdf' }) });
      await rawPut('files', fm);
      pulled++;
    }
    const mf = await fsRead(root, fm.diskPath + '.wox.json');
    if (!mf) continue;
    let dm;
    try { dm = JSON.parse(await mf.text()); } catch (e) { continue; }
    const lm = await dbGet('marks', fm.id);
    if (!lm || (dm.updated || 0) > (lm.updated || 0)) {
      await rawPut('marks', { id: fm.id, items: dm.items || [], autoDone: !!dm.autoDone, updated: dm.updated || 0 });
      if (lm) pulled++;
    }
  }
  return pulled;
}

// 브라우저 → 폴더
async function diskSync() {
  if (!disk.handle || !disk.ok) return;
  const root = disk.handle;
  const full = disk.full;
  disk.full = false;
  const dirty = new Set(disk.dirtyMarks);
  disk.dirtyMarks.clear();
  const folders = await dbAll('folders');
  const files = (await dbAll('files')).sort((a, b) => a.added - b.added);
  const fname = (id) => (folders.find((f) => f.id === id) || {}).name || '미분류';
  const used = new Set();
  for (const f of files) {
    const base = safeName(fname(f.folderId)) + '/' + safeName(f.name);
    let p = base, k = 2;
    while (used.has(p.toLowerCase())) p = `${base} (${k++})`;
    used.add(p.toLowerCase());
    const moved = f.diskPath !== p;
    if (moved || (full && !(await fsRead(root, p + '.pdf')))) {
      const b = await dbGet('blobs', f.id);
      if (b) await fsWrite(root, p + '.pdf', b.blob);
      if (moved && f.diskPath) {
        await fsRemove(root, f.diskPath + '.pdf');
        await fsRemove(root, f.diskPath + '.wox.json');
      }
      f.diskPath = p;
      await rawPut('files', f);
      if (V.file && V.file.id === f.id) V.file.diskPath = p;
      dirty.add(f.id);
    }
    if (full || dirty.has(f.id)) {
      const m = (await dbGet('marks', f.id)) || { id: f.id, items: [], autoDone: false, updated: 0 };
      await fsWrite(root, p + '.wox.json', JSON.stringify({ app: 'wox', file: f.name, ...m }));
    }
  }
  // 브라우저에서 지운 파일은 폴더에서도 지운다
  const now = new Set(files.map((f) => f.id));
  for (const old of (disk.lastIndex && disk.lastIndex.files) || []) {
    if (!now.has(old.id) && old.diskPath) {
      await fsRemove(root, old.diskPath + '.pdf');
      await fsRemove(root, old.diskPath + '.wox.json');
    }
  }
  const idx = { app: 'wox', v: 1, saved: Date.now(), folders, files };
  await fsWrite(root, 'wox-library.json', JSON.stringify(idx, null, 1));
  disk.lastIndex = idx;
  disk.savedAt = Date.now();
  disk.error = '';
  renderDiskStatus();
}

async function diskStart(ask) {
  disk.ok = await diskPermission(ask);
  renderDiskStatus();
  if (!disk.ok) return;
  await diskQueue(async () => {
    const pulled = await diskPull();
    if (pulled) { await loadLibrary(); toast(`PC 폴더에서 ${pulled}개를 불러왔어요`); }
    disk.full = true;
    await diskSync();
  });
}

async function diskConnect() {
  let h;
  try {
    h = await window.showDirectoryPicker({ id: 'wox-data', mode: 'readwrite', startIn: 'documents' });
  } catch (e) { return; } // 취소
  disk.handle = h;
  await rawPut('settings', { id: 'disk', handle: h });
  toast('PC 폴더에 저장하는 중…', 60000);
  await diskStart(true);
  if (disk.ok) toast(`PC 폴더 "${h.name}"에 자동 저장을 시작했어요`, 3500);
}

async function diskDisconnect() {
  if (!(await confirmBox('PC 폴더 연결 해제', `"${disk.handle.name}" 폴더 자동 저장을 멈출까요? 폴더 안 파일은 지워지지 않아요.`, '해제'))) return;
  disk.handle = null;
  disk.ok = false;
  disk.lastIndex = null;
  await rawDel('settings', 'disk');
  renderDiskStatus();
}

function renderDiskStatus() {
  const el = $('#disk-status');
  if (!disk.handle) { el.hidden = true; return; }
  el.hidden = false;
  el.className = 'disk-status' + (disk.ok && !disk.error ? '' : ' warn');
  if (!disk.ok) {
    el.textContent = `💾 PC 폴더 "${disk.handle.name}" 다시 연결하려면 여기를 누르세요`;
  } else if (disk.error) {
    el.textContent = `⚠️ PC 폴더 저장 실패: ${disk.error} (누르면 다시 시도)`;
  } else {
    const t = disk.savedAt ? new Date(disk.savedAt) : null;
    el.textContent = `💾 PC 폴더 "${disk.handle.name}"에 자동 저장 중` +
      (t ? ` · ${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')} 저장됨` : '');
  }
}
$('#disk-status').onclick = () => {
  if (!disk.handle) return;
  if (!disk.ok || disk.error) { disk.error = ''; diskStart(true); }
};

async function diskInit() {
  if (!window.showDirectoryPicker) return;
  let rec = null;
  try { rec = await dbGet('settings', 'disk'); } catch (e) { return; }
  if (!rec || !rec.handle) return;
  disk.handle = rec.handle;
  await diskStart(false);
}

showScreen('library');
loadLibrary().then(diskInit);

