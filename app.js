// Minimal offline-first German learning app with SRS, quiz, and TTS
const state = {
  level: localStorage.getItem('level') || 'a1',
  due: [],
  currentCard: null,
  showBack: false,
  quizIndex: 0,
  listenIndex: 0,
  todayKey: new Date().toISOString().slice(0,10),
  done: JSON.parse(localStorage.getItem('done') || '{}') // { [date]: {flash:true, quiz:true, listen:true} }
};

const progress = JSON.parse(localStorage.getItem('progress') || '{}'); // per card scheduling
const decks = {}; // loaded data

const elem = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  elem('date').textContent = '— ' + new Date().toLocaleDateString();
  await loadLevel(state.level);
  initPWA();
  updateUI();
});

async function loadLevel(level){
  const res = await fetch(`data/${level}.json`);
  decks[level] = await res.json();
  state.due = computeDue(level);
  elem('levelSelect').value = level;
  updateUnitInfo();
}

function changeLevel(v){
  state.level = v;
  localStorage.setItem('level', v);
  loadLevel(v);
}

function computeDue(level){
  const deck = decks[level].flashcards;
  const today = Date.now();
  const due = [];
  for (const card of deck){
    const key = `${level}:${card.id}`;
    const s = progress[key] || {box:1, due:0, ease:2.5};
    if (s.due <= today) due.push(card);
  }
  shuffle(due);
  return due.slice(0, Math.min(30, due.length)); // cap daily
}

function startFlash(){
  elem('flash').style.display = 'block';
  elem('quiz').style.display = 'none';
  elem('listen').style.display = 'none';
  nextFlash();
}

function nextFlash(){
  if (state.due.length === 0){
    markDone('flash');
    elem('flashFront').textContent = '🎉 All due cards reviewed!';
    updateBars();
    return;
  }
  state.currentCard = state.due.shift();
  state.showBack = false;
  renderFlash();
}

function renderFlash(){
  const c = state.currentCard;
  elem('flashFront').innerHTML = state.showBack
    ? `<div><b>${c.de}</b><div class="muted">${c.en}</div><div class="tiny">${c.note||''}</div></div>`
    : c.de;
  elem('flashFront').onclick = () => { state.showBack = !state.showBack; renderFlash(); };
  elem('flashMeta').textContent = `${state.due.length} left today`;
}

function grade(g){ // 1..4
  const level = state.level;
  const c = state.currentCard;
  const key = `${level}:${c.id}`;
  const s = progress[key] || {box:1, due:0, ease:2.5};
  // Leitner-like with SM-2 style ease tweaks
  const intervals = [0, 1, 3, 7, 14, 30, 60]; // days by box
  if (g <= 1){ s.box = Math.max(1, s.box - 1); s.ease = Math.max(1.3, s.ease - 0.2); }
  else if (g === 2){ s.box = Math.max(1, s.box); s.ease = Math.max(1.3, s.ease - 0.05); }
  else if (g === 3){ s.box = Math.min(intervals.length-1, s.box + 1); s.ease = Math.min(3.0, s.ease + 0.05); }
  else { s.box = Math.min(intervals.length-1, s.box + 2); s.ease = Math.min(3.2, s.ease + 0.1); }
  const days = Math.ceil(intervals[s.box] * s.ease);
  const next = Date.now() + days*24*60*60*1000;
  s.due = next;
  progress[key] = s;
  localStorage.setItem('progress', JSON.stringify(progress));
  nextFlash();
}

function startQuiz(){
  elem('flash').style.display = 'none';
  elem('quiz').style.display = 'block';
  elem('listen').style.display = 'none';
  state.quizIndex = 0;
  renderQuiz();
}

function renderQuiz(){
  const q = decks[state.level].quiz[state.quizIndex];
  if (!q){ markDone('quiz'); elem('quizQ').textContent = '🎉 Quiz finished!'; return; }
  elem('quizQ').innerHTML = `<div><b>${q.promptDE}</b><div class='muted'>(${q.hintEN})</div></div>`;
  elem('quizA').value = '';
  elem('quizFeedback').textContent = '';
}

function normalize(s){ return s.toLowerCase().trim().replace(/\s+/g,' '); }

function checkQuiz(){
  const q = decks[state.level].quiz[state.quizIndex];
  const a = normalize(elem('quizA').value);
  const ok = q.answers.some(ans => normalize(ans) === a);
  elem('quizFeedback').innerHTML = ok ? '✅ Richtig!' : `❌ Lösung: <b>${q.answers[0]}</b>`;
}

function nextQuiz(){
  state.quizIndex++;
  renderQuiz();
}

function startListen(){
  elem('flash').style.display = 'none';
  elem('quiz').style.display = 'none';
  elem('listen').style.display = 'block';
  state.listenIndex = 0;
  renderListen();
}

function renderListen(){
  const sents = decks[state.level].listen;
  const s = sents[state.listenIndex];
  if (!s){ markDone('listen'); elem('listenLine').textContent = '🎉 Listening finished!'; return; }
  elem('listenLine').innerHTML = `<div><b>${s.de}</b><div class='muted'>${s.en}</div></div>`;
}

function playTTS(){
  const sents = decks[state.level].listen;
  const s = sents[state.listenIndex];
  if (!('speechSynthesis' in window)) return alert('Speech Synthesis not supported on this device.');
  const u = new SpeechSynthesisUtterance(s.de);
  u.lang = 'de-DE';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

function nextListen(){
  state.listenIndex++;
  renderListen();
}

function updateBars(){
  const done = state.done?.[state.todayKey] || {};
  elem('p1').style.width = done.flash ? '100%' : '20%';
  elem('p2').style.width = done.quiz ? '100%' : '20%';
  elem('p3').style.width = done.listen ? '100%' : '20%';
}

function markDone(kind){
  const day = state.todayKey;
  state.done = JSON.parse(localStorage.getItem('done') || '{}');
  state.done[day] = Object.assign({}, state.done[day] || {}, {[kind]: true});
  localStorage.setItem('done', JSON.stringify(state.done));
  bumpStreakIfFirstTimeToday();
  updateBars();
}

function bumpStreakIfFirstTimeToday(){
  const streakKey = 'streak';
  const lastKey = 'lastDay';
  const today = state.todayKey;
  const last = localStorage.getItem(lastKey);
  let streak = parseInt(localStorage.getItem(streakKey) || '0', 10);
  if (last !== today){
    // if yesterday was last, keep streak; otherwise reset
    const y = new Date(); y.setDate(y.getDate()-1);
    const yesterday = y.toISOString().slice(0,10);
    streak = (last === yesterday) ? streak + 1 : 1;
    localStorage.setItem(streakKey, String(streak));
    localStorage.setItem(lastKey, today);
  }
  elem('streak').textContent = String(streak);
}

function resetToday(){
  const d = state.todayKey;
  state.done = JSON.parse(localStorage.getItem('done') || '{}');
  delete state.done[d];
  localStorage.setItem('done', JSON.stringify(state.done));
  state.due = computeDue(state.level);
  updateBars();
}

function exportData(){
  const data = {
    progress, done: state.done, level: state.level
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'deutsch-daily-progress.json'; a.click();
  URL.revokeObjectURL(url);
}

function importData(e){
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      localStorage.setItem('progress', JSON.stringify(data.progress||{}));
      localStorage.setItem('done', JSON.stringify(data.done||{}));
      if (data.level){ localStorage.setItem('level', data.level); state.level = data.level; }
      alert('Imported!');
      loadLevel(state.level);
    } catch(err){ alert('Import failed'); }
  };
  reader.readAsText(file);
}

function updateUI(){
  elem('streak').textContent = localStorage.getItem('streak') || '0';
  updateBars();
}

// helpers
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

function updateUnitInfo(){
  const d = decks[state.level];
  const total = d.flashcards.length;
  const due = computeDue(state.level).length;
  elem('unitInfo').innerHTML = `Track: <b>${d.meta.title}</b><br>
  Vocab cards: ${total} • Due today: ${due}<br>
  Includes: ${d.meta.includes.join(', ')}`;
}

// PWA
function initPWA(){
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.register('./sw.js');
  }
}
