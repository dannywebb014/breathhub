// breathe.: guided breathing, with a pacer and your progress. Kept in
// localStorage ("breathhub.v1") and synced to Supabase (app_state "breathe").
// Runs inside lifeOS or on its own page (index.html), through /lifeos/embed.js.
// The code is the app as it was on its own page; `document` below is
// embed.js's stand-in, which looks inside this app's shadow root.

export async function mount(ctx) {
  const { root, host, supabase, asset } = ctx;
  const { fill, docFor } = await import("/lifeos/embed.js");
  await fill(root, { css: asset("./app.css"), html: asset("./app.html") });
  const document = docFor(ctx);

  /* =======================================================================
     breathe. — data
     ======================================================================= */

  const TECHNIQUES = {
    extended: {
      name: 'Extended exhale',
      rhythm: '4 in · 6 out',
      blurb: 'The simplest down-regulator. Exhale longer than you inhale and heart rate falls with it.',
      defaultMins: 5,
      phases: [
        {l:'Breathe in', d:4, a:'in'},
        {l:'Breathe out', d:6, a:'out'}
      ]
    },
    coherent: {
      name: 'Coherent breathing',
      rhythm: '5.5 in · 5.5 out',
      blurb: 'About 5.5 breaths a minute — near the resonance frequency where heart-rate oscillations peak.',
      defaultMins: 6,
      phases: [
        {l:'Breathe in', d:5.5, a:'in'},
        {l:'Breathe out', d:5.5, a:'out'}
      ]
    },
    cyclicSigh: {
      name: 'Cyclic sighing',
      rhythm: '2 in · 1 top-up · 6 out',
      blurb: 'Double inhale through the nose, then a long slow exhale. The best-evidenced five-minute practice here.',
      defaultMins: 5,
      phases: [
        {l:'Breathe in', d:2, a:'in', to:0.72, side:'through the nose'},
        {l:'Top up', d:1, a:'in', to:1, side:'a second short sniff'},
        {l:'Long exhale', d:6, a:'out', side:'slowly, through the mouth'}
      ]
    },
    box: {
      name: 'Box breathing',
      rhythm: '4 · 4 · 4 · 4',
      blurb: 'Equal inhale, hold, exhale, hold. Occupies attention, which is the point when you are under pressure.',
      defaultMins: 5,
      phases: [
        {l:'Breathe in', d:4, a:'in'},
        {l:'Hold', d:4, a:'hold'},
        {l:'Breathe out', d:4, a:'out'},
        {l:'Hold', d:4, a:'hold'}
      ]
    },
    fourSevenEight: {
      name: '4-7-8',
      rhythm: '4 in · 7 hold · 8 out',
      blurb: 'A long hold and a very long exhale. Four rounds before sleep is the usual dose.',
      defaultMins: 3,
      phases: [
        {l:'Breathe in', d:4, a:'in', side:'through the nose'},
        {l:'Hold', d:7, a:'hold'},
        {l:'Breathe out', d:8, a:'out', side:'through pursed lips'}
      ]
    },
    nadi: {
      name: 'Nadi shodhana',
      rhythm: '4 · 4 · 4 · 4, alternating',
      blurb: 'Alternate nostril breathing. Close one nostril with the thumb, the other with the ring finger.',
      defaultMins: 5,
      alternate: true,
      phases: [
        {l:'Breathe in', d:4, a:'in', side:'left nostril'},
        {l:'Hold', d:4, a:'hold', side:'both closed'},
        {l:'Breathe out', d:4, a:'out', side:'right nostril'},
        {l:'Breathe in', d:4, a:'in', side:'right nostril'},
        {l:'Hold', d:4, a:'hold', side:'both closed'},
        {l:'Breathe out', d:4, a:'out', side:'left nostril'}
      ]
    },
    humming: {
      name: 'Humming exhale',
      rhythm: '4 in · 8 hum',
      blurb: 'Bhramari. Hum the whole way out — it forces a long, even exhale and gives you something to hold on to.',
      defaultMins: 4,
      phases: [
        {l:'Breathe in', d:4, a:'in', side:'through the nose'},
        {l:'Hum out', d:8, a:'out', side:'low and steady'}
      ]
    },
    reduced: {
      name: 'Light air hunger',
      rhythm: '4 in · 6 out, shallow',
      blurb: 'Breathe slightly less than you want to, for a tolerable sense of wanting air. Never to strain.',
      defaultMins: 4,
      phases: [
        {l:'Small breath in', d:4, a:'in', to:0.45, side:'less than feels natural'},
        {l:'Relaxed out', d:6, a:'out', side:'let it fall, don\'t push'}
      ]
    },
    bolt: {
      name: 'BOLT measurement',
      rhythm: 'one held breath',
      blurb: 'Breath-hold time to the first definite urge to breathe. A comfort index, not a fitness test.',
      type: 'measure'
    },
    hvbr: {
      name: 'High-ventilation rounds',
      rhythm: '30 breaths · hold · 15s',
      blurb: 'Wim Hof style. Powerful, and the one technique here with a real risk profile. Read the warning.',
      type: 'rounds',
      gated: true,
      rounds: 3,
      breaths: 30
    }
  };

  /* =======================================================================
     state
     ======================================================================= */
  const KEY = 'breathhub.v1';
  let state = load();

  function load(){
    try{
      const raw = localStorage.getItem(KEY);
      if(raw) return Object.assign(defaults(), JSON.parse(raw));
    }catch(e){}
    return defaults();
  }
  function defaults(){
    return { days:{}, sessions:0, seconds:0, log:[], bolt:[], sound:true };
  }
  function save(){
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
    queuePush();
  }

  /* =======================================================================
     sync — app_state row 'breathe' in Supabase, through the shared lifeOS.
     client. Opening combines this device with Supabase (so practice on two
     devices adds up); after that every change is sent a moment later.
     ======================================================================= */
  let hub = null, pushTimer = null;
  function entryKeys(list){
    // Older entries have no timestamp: tell same-day repeats apart by their order.
    const seen = {};
    return (list||[]).map(e => {
      if(e && e.t) return [`${e.n||e.v}|${e.d}|${e.t}`, e];
      const base = `${e.n||e.v}|${e.d}`; seen[base] = (seen[base]||0) + 1;
      return [`${base}|#${seen[base]}`, e];
    });
  }
  const gbTime = (e) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(e.d||''); return (e.t || (m ? Date.UTC(+m[3], m[2]-1, +m[1]) : 0)); };
  function union(a, b){ return [...new Map([...entryKeys(a), ...entryKeys(b)]).values()].sort((x, y) => gbTime(x) - gbTime(y)); }
  function combine(local, remote){
    const out = Object.assign(defaults(), remote, { sound: local.sound });
    out.days = Object.assign({}, remote.days, local.days);
    out.log = union(remote.log, local.log);
    out.bolt = union(remote.bolt, local.bolt);
    const sessions = out.log.filter(e => !/^BOLT/.test(e.n||'')).length;
    out.sessions = Math.max(local.sessions||0, remote.sessions||0, sessions);
    out.seconds = Math.max(local.seconds||0, remote.seconds||0);
    return out;
  }
  async function push(){
    if(!hub) return;
    const { error } = await hub.supabase.from('app_state').upsert(
      { user_id: hub.session.user.id, app: 'breathe', data: state, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,app' });
    if(error) console.warn('breathe. not synced yet:', error.message);
  }
  function queuePush(){ if(!hub) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 800); }
  async function startSync(h){
    hub = h;
    const { data, error } = await hub.supabase.from('app_state').select('data').eq('user_id', hub.session.user.id).eq('app', 'breathe').maybeSingle();
    if(error){ console.warn('breathe. sync unavailable:', error.message); return; }
    if(data && data.data && Object.keys(data.data).length) state = combine(state, data.data);
    try{ localStorage.setItem(KEY, JSON.stringify(state)); }catch(e){}
    push();
    const on = document.querySelector('[role="tab"][aria-selected="true"]');
    show(on && on.id === 'tab-progress' ? 'progress' : 'techniques');
  }
  // Signed in already: lifeOS (or this app's own page) checked before starting.
  supabase.auth.getSession().then(({ data }) => { if (data?.session) startSync({ supabase, session: data.session }); });

  /* =======================================================================
     views
     ======================================================================= */
  function show(v){
    ['techniques','progress'].forEach(k=>{
      document.getElementById('view-'+k).classList.toggle('hide', k!==v);
      document.getElementById('tab-'+k).setAttribute('aria-selected', String(k===v));
    });
    if(v==='techniques') renderTechniques();
    if(v==='progress') renderProgress();
    host.scrollTo(0,0);
  }

  function renderTechniques(){
    const el = document.getElementById('view-techniques');
    el.innerHTML = `
      ${Object.entries(TECHNIQUES).map(([k,t])=>`
        <button class="tech" data-click="openTechnique('${k}')">
          <h3>${t.name}</h3>
          <div class="rhythm">${t.rhythm}</div>
          <p>${t.blurb}</p>
        </button>`).join('')}`;
  }

  function openTechnique(k){
    const t = TECHNIQUES[k];
    const el = document.getElementById('view-techniques');
    const mins = t.defaultMins || 5;
    let controls;
    if(t.type==='measure'){
      const last = state.bolt.length ? state.bolt[state.bolt.length-1].v+'s' : 'none yet';
      controls = `
        <div class="note">
          Breathe normally for a minute. Take a normal breath in and a normal breath out —
          not a big one. Pinch your nose and start. Stop at the <strong>first definite urge</strong>
          to breathe, not your maximum. Your next breath should be calm; if you gasp, you held too long.
        </div>
        <p style="color:var(--muted);font-size:14px">Last score: ${last}</p>
        <div class="row"><button class="btn" data-click="startBolt()">Start hold</button></div>`;
    } else if(t.type==='rounds'){
      controls = `
        <div class="note danger">
          <strong>Read before starting.</strong> Sit or lie down. Never in or near water, never driving.
          Do not combine with cold immersion. Skip if pregnant, if you have a seizure disorder or a
          family history of one, cardiovascular disease without clearance, or panic disorder or PTSD
          without support. Lightheadedness and tingling are expected; stop at any chest pain,
          visual disturbance or a feeling you are about to faint.
        </div>
        <div class="row">
          <label class="sel">Rounds
            <select id="dur"><option value="2">2</option><option value="3" selected>3</option><option value="4">4</option></select>
          </label>
          <button class="btn" data-click="startRounds('${k}')">I understand — start</button>
        </div>`;
    } else {
      controls = `
        <div class="row">
          <label class="sel">Length
            <select id="dur">
              ${[2,3,4,5,6,8,10,15].map(m=>`<option value="${m}" ${m===mins?'selected':''}>${m} min</option>`).join('')}
            </select>
          </label>
          <button class="btn" data-click="startTechnique('${k}', +document.getElementById('dur').value, null)">Start</button>
        </div>`;
    }
    el.innerHTML = `
      <button class="btn quiet" data-click="renderTechniques()">← All techniques</button>
      <div class="lesson">
        <h2>${t.name}</h2>
        <p class="eyebrow" style="margin:-8px 0 12px">${t.rhythm}</p>
        <p>${t.blurb}</p>
        ${controls}
      </div>`;
    host.scrollTo(0,0);
  }

  function renderProgress(){
    const el = document.getElementById('view-progress');
    const mins = Math.round(state.seconds/60);
    const recent = state.log.slice(-12).reverse();
    el.innerHTML = `
      <div class="stats">
        <div class="stat"><b>${streak()}</b><span>day streak</span></div>
        <div class="stat"><b>${state.sessions}</b><span>sessions</span></div>
        <div class="stat"><b>${mins}</b><span>minutes</span></div>
      </div>
      ${state.bolt.length ? `<div class="note">BOLT scores: ${state.bolt.slice(-6).map(b=>b.v+'s').join(' · ')}</div>` : ''}
      <div class="log">
        ${recent.length ? recent.map(r=>`<div><span>${esc(r.n)}</span><span>${esc(r.d)}</span></div>`).join('')
          : '<div><span>Nothing logged yet. Start with Day 1.</span></div>'}
      </div>
      <div class="row">
        <button class="btn ghost" data-click="toggleSound()">Cue sound: ${state.sound?'on':'off'}</button>
        <button class="btn quiet" data-click="resetAll()">Reset all data</button>
      </div>
      <h2 class="subhead">Your data</h2>
      <div class="data-card">
        <div><h3>Full backup → JSON</h3><p>Everything in one file, so you can move devices.</p></div>
        <button class="btn" data-click="downloadBackup()">Download</button>
      </div>
      <div class="data-card">
        <div><h3>Restore from backup</h3><p>Load a JSON file you exported earlier. Replaces current data.</p></div>
        <button class="btn ghost" data-click="document.getElementById('restoreFile').click()">Choose file</button>
      </div>`;
  }

  function esc(v){
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /* ---------- backup / restore ---------- */
  let toastTimer = null;
  function toast(msg){
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(()=>t.classList.remove('show'), 1900);
  }

  function downloadBackup(){
    const text = JSON.stringify({app:'breathe', exported:new Date().toISOString(), data:state}, null, 2);
    try{
      const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
      const a = document.createElement('a');
      a.href = url; a.download = 'breathe-backup.json';
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 200);
      toast('Downloaded breathe-backup.json');
    }catch(e){ toast('Download failed on this device'); }
  }

  function restoreBackup(input){
    const f = input.files && input.files[0];
    input.value = '';
    if(!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let d;
      try{
        const parsed = JSON.parse(rd.result);
        d = parsed && parsed.data ? parsed.data : parsed;
        if(!d || typeof d !== 'object' || !Array.isArray(d.log) || typeof d.sessions !== 'number') throw 0;
      }catch(e){ return toast('That file could not be read'); }
      if(!confirm('Replace your progress with this backup? This replaces it on every device.')) return;
      const next = Object.assign(defaults(), d);
      if(!Array.isArray(next.bolt)) next.bolt = [];
      if(!next.days || typeof next.days !== 'object') next.days = {};
      state = next; save(); renderProgress();
      toast('Backup restored');
    };
    rd.readAsText(f);
  }

  function isoDay(d){ return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); }
  function streak(){
    let n = 0;
    const d = new Date();
    if(!state.days[isoDay(d)]) d.setDate(d.getDate()-1);   // today not done yet is fine
    while(state.days[isoDay(d)]){ n++; d.setDate(d.getDate()-1); }
    return n;
  }

  function toggleSound(){ state.sound = !state.sound; save(); renderProgress(); }
  function resetAll(){
    if(confirm('Delete all progress? This clears it on every device.')){ state = defaults(); save(); renderProgress(); }
  }

  /* =======================================================================
     pacer engine
     ======================================================================= */
  const R = 104, C = 2*Math.PI*R;
  let session = null, raf = null, wakeLock = null, audioCtx = null;

  const $ = id => document.getElementById(id);

  function ease(p){ return p<0.5 ? 2*p*p : 1-Math.pow(-2*p+2,2)/2; }

  function buildSegments(phases){
    const total = phases.reduce((s,p)=>s+p.d,0);
    let acc = 0;
    $('segs').innerHTML = phases.map((p,i)=>{
      const len = (p.d/total)*C;
      const gap = phases.length>1 ? 3 : 0;
      const c = `<circle class="seg" data-i="${i}" cx="130" cy="130" r="${R}"
        stroke="var(--accent)"
        stroke-dasharray="${Math.max(len-gap,1)} ${C}"
        stroke-dashoffset="${-acc}"></circle>`;
      acc += len;
      return c;
    }).join('');
    return total;
  }

  function tone(freq){
    if(!state.sound) return;
    try{
      audioCtx = audioCtx || new (window.AudioContext||window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type='sine'; o.frequency.value=freq;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.07, audioCtx.currentTime+0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime+0.5);
      o.connect(g).connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime+0.55);
    }catch(e){}
  }
  function buzz(ms){ if(navigator.vibrate) try{ navigator.vibrate(ms); }catch(e){} }

  async function lockScreen(){
    try{ if('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
  }
  function unlockScreen(){ try{ wakeLock && wakeLock.release(); }catch(e){} wakeLock=null; }

  function openPacer(name){
    $('pacerName').textContent = name;
    $('pacer').classList.add('on');
    $('pacerPrompt').textContent = '';
    lockScreen();
  }

  function startTechnique(key, mins, dayIndex){
    const t = TECHNIQUES[key];
    if(t.type==='measure') return startBolt();
    if(t.type==='rounds')  return startRounds(key, dayIndex);

    const total = buildSegments(t.phases);
    session = {
      key, name:t.name, phases:t.phases, cycleLen:total,
      targetSecs: mins*60, elapsed:0, t0:performance.now(),
      level:0, startLevel:0, phaseIdx:-1, phaseT0:0, dayIndex, paused:false, pausedAt:0
    };
    openPacer(t.name);
    $('pacerAction').textContent = 'Pause';
    $('pacerAction').onclick = togglePause;
    raf = requestAnimationFrame(tick);
  }

  function togglePause(){
    if(!session) return;
    session.paused = !session.paused;
    $('pacerAction').textContent = session.paused ? 'Resume' : 'Pause';
    if(session.paused){ cancelAnimationFrame(raf); session.pausedAt = performance.now(); }
    else { const delta = performance.now()-session.pausedAt; session.t0 += delta; session.phaseT0 += delta; raf = requestAnimationFrame(tick); }
  }

  function tick(now){
    if(!session || session.paused) return;
    const s = session;
    s.elapsed = (now - s.t0)/1000;

    const inCycle = s.elapsed % s.cycleLen;
    let acc = 0, idx = 0;
    for(let i=0;i<s.phases.length;i++){
      if(inCycle < acc + s.phases[i].d){ idx = i; break; }
      acc += s.phases[i].d;
    }
    const p = s.phases[idx];
    const tIn = inCycle - acc;

    if(idx !== s.phaseIdx){
      s.startLevel = s.level;
      s.phaseIdx = idx;
      $('phaseLabel').textContent = p.l;
      $('phaseSide').textContent = p.side || '';
      [...document.querySelectorAll('.seg')].forEach(c=>c.classList.toggle('live', +c.dataset.i===idx));
      if(p.a==='in'){ tone(528); buzz(28); }
      else if(p.a==='out'){ tone(396); buzz([18,60,18]); }
      else { tone(440); buzz(12); }
    }

    const target = p.to !== undefined ? p.to : (p.a==='in' ? 1 : p.a==='out' ? 0 : s.startLevel);
    s.level = s.startLevel + (target - s.startLevel) * ease(Math.min(tIn/p.d,1));

    const r = 26 + s.level*74;
    $('disc').setAttribute('r', r);
    $('discLine').setAttribute('r', r);
    $('markerG').setAttribute('transform', `rotate(${(inCycle/s.cycleLen)*360} 130 130)`);
    $('phaseCount').textContent = Math.ceil(p.d - tIn);

    const left = Math.max(0, s.targetSecs - s.elapsed);
    $('pacerMeta').textContent = `${fmt(left)} left · cycle ${Math.floor(s.elapsed/s.cycleLen)+1}`;

    if(s.elapsed >= s.targetSecs){ return endSession(true); }
    raf = requestAnimationFrame(tick);
  }

  function fmt(sec){
    const m = Math.floor(sec/60), s = Math.floor(sec%60);
    return `${m}:${String(s).padStart(2,'0')}`;
  }

  /* ---------- BOLT ---------- */
  function startBolt(){
    let t0 = null, id = null;
    buildSegments([{l:'Hold',d:1,a:'hold'}]);
    openPacer('BOLT measurement');
    $('phaseLabel').textContent = 'Hold';
    $('phaseSide').textContent = 'stop at the first urge';
    $('phaseCount').textContent = '0';
    $('disc').setAttribute('r', 40); $('discLine').setAttribute('r', 40);
    $('pacerMeta').textContent = 'Exhale normally, pinch your nose, then tap Start.';
    $('pacerAction').textContent = 'Start';
    $('pacerAction').onclick = () => {
      if(t0===null){
        t0 = performance.now();
        $('pacerAction').textContent = 'Stop';
        id = setInterval(()=>{
          const v = (performance.now()-t0)/1000;
          $('phaseCount').textContent = Math.floor(v);
          $('disc').setAttribute('r', Math.min(100, 40+v*1.4));
          $('discLine').setAttribute('r', Math.min(100, 40+v*1.4));
        }, 100);
      } else {
        clearInterval(id);
        const v = Math.round((performance.now()-t0)/1000);
        state.bolt.push({v, d:new Date().toLocaleDateString('en-GB'), t:Date.now()});
        state.log.push({n:`BOLT — ${v}s`, d:new Date().toLocaleDateString('en-GB'), t:Date.now()});
        save();
        closePacer();
        alert(`BOLT: ${v} seconds.\n\nUnder 20s suggests a fast, light breathing pattern at rest. Around 40s is the usual target. Treat it as a comfort index rather than a fitness score.`);
        show('progress');
      }
    };
  }

  /* ---------- high-ventilation rounds ---------- */
  function startRounds(key, dayIndex){
    const t = TECHNIQUES[key];
    const totalRounds = +(document.getElementById('dur')?.value || t.rounds);
    const breaths = t.breaths;
    let round = 1, phase = 'breaths', n = 0, t0 = performance.now(), holdT0 = 0, id = null;

    buildSegments([{l:'in',d:0.9,a:'in'},{l:'out',d:0.7,a:'out'}]);
    openPacer(t.name);
    $('pacerAction').textContent = 'Stop';
    $('pacerAction').onclick = () => endSession(false);

    const startSecs = 0;
    function frame(now){
      if(phase==='breaths'){
        const cycle = 1.6, el = (now-t0)/1000;
        n = Math.floor(el/cycle)+1;
        if(n > breaths){ phase='holdEmpty'; holdT0 = now; tone(330); buzz([60,40,60]); }
        else {
          const p = (el % cycle)/cycle;
          const lvl = p < 0.5625 ? ease(p/0.5625) : 1-ease((p-0.5625)/0.4375);
          const r = 26 + lvl*74;
          $('disc').setAttribute('r', r); $('discLine').setAttribute('r', r);
          $('markerG').setAttribute('transform', `rotate(${p*360} 130 130)`);
          $('phaseLabel').textContent = p<0.5625 ? 'In' : 'Out';
          $('phaseCount').textContent = Math.min(n, breaths);
          $('phaseSide').textContent = `of ${breaths}`;
          $('pacerPrompt').textContent = 'Full breath in, let it fall out. Don\'t force the exhale.';
        }
      }
      else if(phase==='holdEmpty'){
        const el = (now-holdT0)/1000;
        $('phaseLabel').textContent = 'Hold — empty';
        $('phaseCount').textContent = Math.floor(el);
        $('phaseSide').textContent = 'seconds';
        $('disc').setAttribute('r', 30); $('discLine').setAttribute('r', 30);
        $('pacerPrompt').textContent = 'Relax. When you feel a strong urge to breathe, tap Breathe in.';
        $('pacerAction').textContent = 'Breathe in';
        $('pacerAction').onclick = () => { phase='holdFull'; holdT0 = performance.now(); tone(528); };
      }
      else if(phase==='holdFull'){
        const el = (now-holdT0)/1000, left = Math.max(0, 15-el);
        $('phaseLabel').textContent = 'Hold — full';
        $('phaseCount').textContent = Math.ceil(left);
        $('phaseSide').textContent = 'seconds';
        $('disc').setAttribute('r', 100); $('discLine').setAttribute('r', 100);
        $('pacerPrompt').textContent = 'Big breath in, hold fifteen seconds, then release.';
        $('pacerAction').textContent = 'Stop';
        $('pacerAction').onclick = () => endSession(false);
        if(left<=0){
          round++;
          if(round>totalRounds){
            session = {name:t.name, elapsed:(now-t0)/1000, dayIndex, key};
            return endSession(true);
          }
          phase='breaths'; t0 = now; tone(440);
        }
      }
      $('pacerMeta').textContent = `Round ${Math.min(round,totalRounds)} of ${totalRounds}`;
      raf = requestAnimationFrame(frame);
    }
    session = {name:t.name, elapsed:0, dayIndex, key, custom:true, t0:performance.now()};
    raf = requestAnimationFrame(frame);
  }

  /* ---------- end ---------- */
  function endSession(completed){
    cancelAnimationFrame(raf);
    if(session){
      const secs = Math.round(session.elapsed || (performance.now()-session.t0)/1000);
      if(secs > 20){
        state.sessions++;
        state.seconds += secs;
        state.log.push({n:`${session.name} — ${Math.round(secs/60)} min`, d:new Date().toLocaleDateString('en-GB'), t:Date.now()});
        if(completed) state.days[isoDay(new Date())] = true;
        save();
      }
    }
    closePacer();
    show('progress');
    session = null;
  }
  function closePacer(){
    $('pacer').classList.remove('on');
    $('pacerPrompt').textContent = '';
    unlockScreen();
  }

  document.addEventListener('keydown', e=>{
    if(e.key==='Escape' && $('pacer').classList.contains('on')){ e.preventDefault(); endSession(false); }   // used: lifeOS stays on breathe.
    if(e.key===' ' && session && !session.custom && $('pacer').classList.contains('on')){ e.preventDefault(); togglePause(); }
  });
  document.addEventListener('visibilitychange', ()=>{
    if(document.hidden && session && !session.paused && !session.custom) togglePause();
  });

  show('techniques');

  // The markup's data-click / data-change say what to run, as onclick= did
  // on the app's own page; `this` is the element.
  const actions = { show, restoreBackup, endSession, openTechnique, startBolt, startRounds, startTechnique, renderTechniques, toggleSound, resetAll, downloadBackup, document };
  const run = (el, expr) => new Function("app", "el", `with (app) { ${expr.replace(/\bthis\b/g, "el")} }`)(actions, el);
  root.addEventListener("click", (e) => { const el = e.target.closest("[data-click]"); if (el) run(el, el.dataset.click); });
  root.addEventListener("change", (e) => { const el = e.target.closest("[data-change]"); if (el) run(el, el.dataset.change); });

  return { unmount: () => document.off() };
}
