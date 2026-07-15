/* ============================================================
   NotesVault — shared logic
   Storage model (localStorage, demo-grade, fully client-side):
     nv_session   -> {name,email,provider}
     nv_notes     -> [{id,title,content,priority,tags,reminder,status,image,createdAt,updatedAt}]
     nv_recycle   -> [{...note, deletedAt}]
     nv_theme     -> 'light' | 'dark' | 'system'
     nv_voice     -> {on, rate, pitch}
   ============================================================ */

const NV = (() => {
  const K = { session:'nv_session', notes:'nv_notes', recycle:'nv_recycle', theme:'nv_theme', voice:'nv_voice', users:'nv_users' };

  const read  = (k, fallback) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch(e){ return fallback; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  // ---------- accounts (real local register/login checks) ----------
  function getUsers(){ return read(K.users, []); }
  function setUsers(u){ write(K.users, u); }

  function registerUser(email, password, name){
    email = (email||'').trim().toLowerCase();
    const users = getUsers();
    if (users.some(u => u.email === email)){
      return { ok:false, reason:'exists' };
    }
    users.push({ email, password, name: name || email.split('@')[0] });
    setUsers(users);
    return { ok:true };
  }

  function loginUser(email, password){
    email = (email||'').trim().toLowerCase();
    const users = getUsers();
    const user = users.find(u => u.email === email);
    if (!user) return { ok:false, reason:'notfound' };
    if (user.password !== password) return { ok:false, reason:'wrongpass' };
    return { ok:true, user };
  }

  // registerOrLogin: used by the Google/GitHub-style panel — if the email
  // is new, it registers it; if it exists, it checks the password matches.
  function registerOrLogin(email, password, provider){
    email = (email||'').trim().toLowerCase();
    const users = getUsers();
    const existing = users.find(u => u.email === email);
    if (!existing){
      registerUser(email, password);
      return { ok:true, isNew:true, name: email.split('@')[0] };
    }
    if (existing.password !== password) return { ok:false, reason:'wrongpass' };
    return { ok:true, isNew:false, name: existing.name };
  }

  // ---------- session ----------
  function getSession(){ return read(K.session, null); }
  function setSession(s){ write(K.session, s); }
  function logout(){ localStorage.removeItem(K.session); window.location.href = 'index.html'; }
  function requireSession(){
    if (!getSession()){ window.location.href = 'index.html'; return null; }
    return getSession();
  }

  // ---------- notes ----------
  function getNotes(){ return read(K.notes, []); }
  function setNotes(n){ write(K.notes, n); }
  function getRecycle(){ return read(K.recycle, []); }
  function setRecycle(n){ write(K.recycle, n); }

  function upsertNote(note){
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === note.id);
    note.updatedAt = new Date().toISOString();
    if (idx >= 0) notes[idx] = note; else { note.createdAt = note.createdAt || note.updatedAt; notes.unshift(note); }
    setNotes(notes);
    return note;
  }

  function deleteNote(id){
    const notes = getNotes();
    const idx = notes.findIndex(n => n.id === id);
    if (idx < 0) return null;
    const [removed] = notes.splice(idx,1);
    setNotes(notes);
    const recycle = getRecycle();
    removed.deletedAt = new Date().toISOString();
    recycle.unshift(removed);
    setRecycle(recycle);
    return removed;
  }

  function restoreNote(id){
    const recycle = getRecycle();
    const idx = recycle.findIndex(n => n.id === id);
    if (idx < 0) return null;
    const [restored] = recycle.splice(idx,1);
    delete restored.deletedAt;
    setRecycle(recycle);
    const notes = getNotes();
    notes.unshift(restored);
    setNotes(notes);
    return restored;
  }

  function purgeNote(id){
    const recycle = getRecycle().filter(n => n.id !== id);
    setRecycle(recycle);
  }

  function uid(){ return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

  // ---------- theme ----------
  function applyTheme(pref){
    pref = pref || read(K.theme, 'system');
    let effective = pref;
    if (pref === 'system'){
      effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.setAttribute('data-theme', effective);
    document.body.setAttribute('data-theme', effective);
  }
  function setTheme(pref){ write(K.theme, pref); applyTheme(pref); }
  function getThemePref(){ return read(K.theme, 'system'); }

  // ---------- voice ----------
  function getVoicePref(){ return read(K.voice, { on:true, rate:1, pitch:1 }); }
  function setVoicePref(v){ write(K.voice, v); }
  function speak(text, opts){
    if (!('speechSynthesis' in window) || !text) return;
    const v = opts || getVoicePref();
    if (!v.on) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = v.rate || 1; u.pitch = v.pitch || 1;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }

  // ---------- toast ----------
  function ensureToastWrap(){
    let wrap = document.querySelector('.toast-wrap');
    if (!wrap){ wrap = document.createElement('div'); wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
    return wrap;
  }
  function toast(msg, type, actionLabel, actionFn){
    const wrap = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML = `<span class="dot"></span><span class="msg"></span>`;
    el.querySelector('.msg').textContent = msg;
    if (actionLabel && actionFn){
      const btn = document.createElement('button');
      btn.textContent = actionLabel;
      btn.onclick = () => { actionFn(); dismiss(); };
      el.appendChild(btn);
    }
    function dismiss(){
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
    }
    wrap.appendChild(el);
    setTimeout(dismiss, 5000);
  }

  function stripHtmlToText(html){
    const d = document.createElement('div');
    d.innerHTML = html;
    d.querySelectorAll('tr').forEach(tr => tr.appendChild(document.createTextNode('\n')));
    d.querySelectorAll('td,th').forEach(td => td.appendChild(document.createTextNode('\t')));
    d.querySelectorAll('p,div,li,br').forEach(el => el.insertAdjacentText('afterend', '\n'));
    return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ---------- local folder save (File System Access API, with download fallback) ----------
  let dirHandle = null;
  const supportsFS = 'showDirectoryPicker' in window;

  async function chooseFolder(){
    if (!supportsFS){ toast('Folder picking needs a Chromium browser — files will download instead.', 'info'); return null; }
    try {
      dirHandle = await window.showDirectoryPicker();
      toast('Folder linked: notes will save there from now on.', 'success');
      return dirHandle;
    } catch(e){ return null; }
  }

  async function saveNoteToDisk(note){
    const filename = (note.title || 'untitled').replace(/[\\/:*?"<>|]/g,'-').slice(0,60) + '.txt';
    const plainContent = stripHtmlToText(note.content || '');
    const body = `${note.title || 'Untitled'}\n${'—'.repeat(20)}\nStatus: ${note.status||''}   Priority: ${note.priority||''}\nTags: ${note.tags||''}\nReminder: ${note.reminder||''}\n\n${plainContent}\n`;
    if (supportsFS){
      try {
        if (!dirHandle) dirHandle = await chooseFolder();
        if (!dirHandle) return downloadFallback(filename, body);
        const fileHandle = await dirHandle.getFileHandle(filename, { create:true });
        const writable = await fileHandle.createWritable();
        await writable.write(body);
        await writable.close();
        toast(`Saved "${filename}" to your chosen folder.`, 'success');
        return true;
      } catch(e){ return downloadFallback(filename, body); }
    }
    return downloadFallback(filename, body);
  }

  function downloadFallback(filename, body){
    const blob = new Blob([body], { type:'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    toast(`Downloaded "${filename}" to your Downloads folder.`, 'success');
    return true;
  }

  return {
    getSession, setSession, logout, requireSession,
    getUsers, registerUser, loginUser, registerOrLogin,
    getNotes, setNotes, getRecycle, setRecycle,
    upsertNote, deleteNote, restoreNote, purgeNote, uid,
    applyTheme, setTheme, getThemePref,
    getVoicePref, setVoicePref, speak,
    toast, chooseFolder, saveNoteToDisk, supportsFS
  };
})();

// apply theme immediately on every page load (before paint flicker)
NV.applyTheme();