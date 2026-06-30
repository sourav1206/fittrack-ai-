/* ===================== STATE ===================== */
const STORAGE_KEY = 'fittrack_ai_state_v1';
const todayKey = () => new Date().toISOString().slice(0, 10);

let state = loadState();

function defaultState() {
  return {
    profile: null,
    theme: 'dark',
    favorites: [],
    habits: [
      { id: 'h1', name: 'Workout', history: {} },
      { id: 'h2', name: 'Hit protein goal', history: {} },
      { id: 'h3', name: '8 glasses of water', history: {} },
    ],
    weightHistory: [],
    days: {}, // dateKey -> { meals:[], workouts:[], waterGlasses:0 }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return { ...defaultState(), ...parsed };
  } catch (e) {
    return defaultState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getDay(key = todayKey()) {
  if (!state.days[key]) {
    state.days[key] = { meals: [], workouts: [], waterGlasses: 0 };
  }
  return state.days[key];
}

/* ===================== CALCULATIONS ===================== */
function calculateProfile(p) {
  const heightM = p.height / 100;
  const bmi = p.weight / (heightM * heightM);

  let bmr;
  if (p.gender === 'male') {
    bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + 5;
  } else if (p.gender === 'female') {
    bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age - 161;
  } else {
    bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age - 78;
  }

  const tdee = bmr * parseFloat(p.activity);

  let calories = tdee;
  let proteinPerKg = 1.6;
  if (p.goal === 'weight-loss' || p.goal === 'fat-loss') {
    calories = tdee - 500;
    proteinPerKg = 1.9;
  } else if (p.goal === 'muscle-gain') {
    calories = tdee + 300;
    proteinPerKg = 2.0;
  } else if (p.goal === 'recomposition') {
    calories = tdee - 150;
    proteinPerKg = 2.0;
  } else if (p.goal === 'maintain') {
    calories = tdee;
    proteinPerKg = 1.6;
  } else {
    calories = tdee;
    proteinPerKg = 1.6;
  }
  calories = Math.max(1200, Math.round(calories));

  const protein = Math.round(p.weight * proteinPerKg);
  const fat = Math.round((calories * 0.25) / 9);
  const proteinCals = protein * 4;
  const fatCals = fat * 9;
  const carbs = Math.max(0, Math.round((calories - proteinCals - fatCals) / 4));
  const fiber = Math.round((calories / 1000) * 14);
  const sugarLimit = Math.round((calories * 0.1) / 4);
  const sodiumLimit = 2300;
  const waterMl = Math.round(p.weight * 35);
  const waterGlasses = Math.max(6, Math.round(waterMl / 250));

  const idealMin = Math.round(18.5 * heightM * heightM * 10) / 10;
  const idealMax = Math.round(24.9 * heightM * heightM * 10) / 10;

  return {
    bmi: Math.round(bmi * 10) / 10,
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    calories, protein, carbs, fat, fiber, sugarLimit, sodiumLimit,
    waterMl, waterGlasses,
    idealMin, idealMax,
  };
}

function bmiLabel(bmi) {
  if (bmi < 18.5) return 'Underweight';
  if (bmi < 25) return 'Healthy range';
  if (bmi < 30) return 'Overweight';
  return 'Higher range';
}

/* ===================== ONBOARDING ===================== */
let obStep = 0;
const obSteps = document.querySelectorAll('.ob-step');

function showObStep(i) {
  obSteps.forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === i));
  document.getElementById('obProgressBar').style.width = `${((i + 1) / obSteps.length) * 100}%`;
  obStep = i;
}

document.querySelectorAll('[data-next]').forEach((btn) =>
  btn.addEventListener('click', () => showObStep(Math.min(obStep + 1, obSteps.length - 1)))
);
document.querySelectorAll('[data-back]').forEach((btn) =>
  btn.addEventListener('click', () => showObStep(Math.max(obStep - 1, 0)))
);

document.getElementById('obGoal').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  document.querySelectorAll('#obGoal .chip').forEach((c) => c.classList.remove('selected'));
  chip.classList.add('selected');
  chip.dataset.selected = 'true';
});

document.getElementById('skipToApp').addEventListener('click', () => {
  if (state.profile) {
    enterApp();
  } else {
    toast("No saved plan found on this device yet — let's set one up.");
  }
});

document.getElementById('finishOnboarding').addEventListener('click', () => {
  const goalChip = document.querySelector('#obGoal .chip.selected');
  const profile = {
    name: document.getElementById('obName').value.trim() || 'there',
    age: Number(document.getElementById('obAge').value) || 25,
    gender: document.getElementById('obGender').value,
    height: Number(document.getElementById('obHeight').value) || 170,
    weight: Number(document.getElementById('obWeight').value) || 70,
    targetWeight: Number(document.getElementById('obTargetWeight').value) || null,
    targetDate: document.getElementById('obTargetDate').value || null,
    goal: goalChip ? goalChip.dataset.value : 'maintain',
    activity: document.getElementById('obActivity').value,
    diet: document.getElementById('obDiet').value,
    workoutStyle: document.getElementById('obWorkoutStyle').value,
    experience: document.getElementById('obExperience').value,
    wake: document.getElementById('obWake').value,
    sleep: document.getElementById('obSleep').value,
    waterGoalOverride: Number(document.getElementById('obWater').value) || null,
    sleepHours: Number(document.getElementById('obSleepHours').value) || 7,
    allergies: document.getElementById('obAllergies').value.trim(),
  };
  profile.calcs = calculateProfile(profile);
  if (profile.waterGoalOverride) profile.calcs.waterGlasses = profile.waterGoalOverride;

  state.profile = profile;
  state.weightHistory.push({ date: todayKey(), weight: profile.weight });
  saveState();
  enterApp();
});

/* ===================== APP NAV ===================== */
function enterApp() {
  document.getElementById('onboarding').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  applyTheme(state.theme);
  renderAll();
}

document.querySelectorAll('[data-view-btn]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.viewBtn));
});

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.viewBtn === name));
  if (name === 'progress') renderWeightChart();
}

document.getElementById('addEntryBtn').addEventListener('click', () => switchView('log'));

/* ===================== DASHBOARD RENDER ===================== */
function todayTotals() {
  const day = getDay();
  return day.meals.reduce(
    (acc, m) => ({
      cal: acc.cal + (m.cal || 0),
      protein: acc.protein + (m.protein || 0),
      carbs: acc.carbs + (m.carbs || 0),
      fat: acc.fat + (m.fat || 0),
    }),
    { cal: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

function renderGauge() {
  const calcs = state.profile.calcs;
  const totals = todayTotals();
  const remaining = Math.max(calcs.calories - totals.cal, 0);
  document.getElementById('caloriesRemaining').textContent = remaining;

  const proteinCal = totals.protein * 4;
  const carbsCal = totals.carbs * 4;
  const fatCal = totals.fat * 9;
  const target = Math.max(calcs.calories, 1);
  const circumference = 2 * Math.PI * 92;

  const pLen = Math.min((proteinCal / target) * circumference, circumference);
  const cLen = Math.min((carbsCal / target) * circumference, circumference - pLen);
  const fLen = Math.min((fatCal / target) * circumference, circumference - pLen - cLen);

  const pEl = document.getElementById('gaugeProtein');
  const cEl = document.getElementById('gaugeCarbs');
  const fEl = document.getElementById('gaugeFat');
  pEl.style.strokeDasharray = `${pLen} ${circumference}`;
  pEl.style.strokeDashoffset = `0`;
  cEl.style.strokeDasharray = `${cLen} ${circumference}`;
  cEl.style.strokeDashoffset = `${-pLen}`;
  fEl.style.strokeDasharray = `${fLen} ${circumference}`;
  fEl.style.strokeDashoffset = `${-(pLen + cLen)}`;

  document.getElementById('legProtein').textContent = `${Math.round(totals.protein)}/${calcs.protein}g`;
  document.getElementById('legCarbs').textContent = `${Math.round(totals.carbs)}/${calcs.carbs}g`;
  document.getElementById('legFat').textContent = `${Math.round(totals.fat)}/${calcs.fat}g`;
}

function renderStats() {
  const p = state.profile;
  document.getElementById('statWeight').textContent = `${p.weight} kg`;
  if (p.targetWeight) {
    const diff = Math.round((p.weight - p.targetWeight) * 10) / 10;
    document.getElementById('statWeightDelta').textContent =
      diff === 0 ? 'at goal 🎉' : `${Math.abs(diff)}kg ${diff > 0 ? 'to lose' : 'to gain'}`;
  }
  const day = getDay();
  document.getElementById('statWater').textContent = `${day.waterGlasses}/${p.calcs.waterGlasses}`;
  document.getElementById('statStreak').textContent = `${computeStreak()}🔥`;
}

function computeStreak() {
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    const day = state.days[key];
    const active = day && (day.meals.length || day.workouts.length || day.waterGlasses > 0);
    if (active) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

function renderHealthScore() {
  const p = state.profile;
  const day = getDay();
  const totals = todayTotals();
  let score = 0;
  if (totals.cal > 0 && totals.cal <= p.calcs.calories * 1.1) score += 30;
  if (totals.protein >= p.calcs.protein * 0.8) score += 25;
  if (day.waterGlasses >= p.calcs.waterGlasses) score += 20;
  if (day.workouts.length > 0) score += 25;
  score = Math.min(100, score);
  document.getElementById('healthScoreVal').textContent = score;
  document.getElementById('healthScoreBar').style.width = `${score}%`;
  const notes = [];
  if (totals.protein < p.calcs.protein * 0.8) notes.push('log more protein');
  if (day.waterGlasses < p.calcs.waterGlasses) notes.push('drink more water');
  if (day.workouts.length === 0) notes.push('fit in a workout');
  document.getElementById('healthScoreNote').textContent = notes.length
    ? `Try to ${notes.join(', ')} to lift today's score.`
    : "You're on track across the board today.";
}

function renderTimeline() {
  const day = getDay();
  const items = [
    ...day.meals.map((m) => ({ ...m, kind: 'meal' })),
    ...day.workouts.map((w) => ({ ...w, kind: 'workout' })),
  ].sort((a, b) => a.time.localeCompare(b.time));

  const list = document.getElementById('timelineList');
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<li class="empty-state">Nothing logged yet today. Tap "+ Add" to log a meal, water, or workout.</li>';
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    if (item.kind === 'meal') {
      li.innerHTML = `<div class="t-meta"><b>${escapeHtml(item.name)}</b><span>${item.mealType} · ${item.time}</span></div><div class="t-val">${item.cal} kcal</div>`;
    } else {
      li.innerHTML = `<div class="t-meta"><b>${escapeHtml(item.exercise)}</b><span>Workout · ${item.time}</span></div><div class="t-val">${item.calories || 0} kcal</div>`;
    }
    list.appendChild(li);
  });
}

function renderGreeting() {
  document.getElementById('greetName').textContent = `Hey ${state.profile.name} 👋`;
  document.getElementById('avatarInitial').textContent = state.profile.name.charAt(0).toUpperCase();
  document.getElementById('greetDate').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
}

function renderDashboard() {
  renderGreeting();
  renderGauge();
  renderStats();
  renderHealthScore();
  renderTimeline();
}

/* ===================== FOOD LOG ===================== */
document.getElementById('logFoodBtn').addEventListener('click', () => {
  const name = document.getElementById('logFoodName').value.trim();
  const cal = Number(document.getElementById('logCal').value) || 0;
  if (!name || !cal) {
    toast('Add a food name and calories at least.');
    return;
  }
  const entry = {
    name,
    mealType: document.getElementById('logMealType').value,
    cal,
    protein: Number(document.getElementById('logProtein').value) || 0,
    carbs: Number(document.getElementById('logCarbs').value) || 0,
    fat: Number(document.getElementById('logFat').value) || 0,
    time: new Date().toTimeString().slice(0, 5),
  };
  getDay().meals.push(entry);
  if (document.getElementById('logSaveFav').checked) {
    state.favorites.push({ ...entry });
  }
  saveState();
  ['logFoodName', 'logCal', 'logProtein', 'logCarbs', 'logFat'].forEach((id) => (document.getElementById(id).value = ''));
  document.getElementById('logSaveFav').checked = false;
  renderAll();
  toast(`Logged ${name} · ${cal} kcal`);
});

function renderFavorites() {
  const list = document.getElementById('favList');
  list.innerHTML = '';
  if (!state.favorites.length) {
    list.innerHTML = '<li class="empty-state">No favorites saved yet.</li>';
    return;
  }
  state.favorites.forEach((f) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(f.name)}</span><span class="t-val">${f.cal} kcal</span>`;
    li.addEventListener('click', () => {
      getDay().meals.push({ ...f, time: new Date().toTimeString().slice(0, 5) });
      saveState();
      renderAll();
      toast(`Logged ${f.name} from favorites`);
    });
    list.appendChild(li);
  });
}

function renderMealLog() {
  const day = getDay();
  const list = document.getElementById('mealLogList');
  list.innerHTML = '';
  if (!day.meals.length) {
    list.innerHTML = '<li class="empty-state">No meals logged today.</li>';
    return;
  }
  day.meals.forEach((m, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="t-meta"><b>${escapeHtml(m.name)}</b><span>${m.mealType} · ${m.time}</span></div><div class="t-val">${m.cal} kcal</div><button class="del-btn" data-i="${i}">✕</button>`;
    li.querySelector('.del-btn').addEventListener('click', () => {
      day.meals.splice(i, 1);
      saveState();
      renderAll();
    });
    list.appendChild(li);
  });
}

/* ===================== WORKOUT LOG ===================== */
document.getElementById('logWorkoutBtn').addEventListener('click', () => {
  const exercise = document.getElementById('woExercise').value.trim();
  if (!exercise) {
    toast('Add an exercise name.');
    return;
  }
  const entry = {
    exercise,
    sets: Number(document.getElementById('woSets').value) || 0,
    reps: Number(document.getElementById('woReps').value) || 0,
    weight: Number(document.getElementById('woWeight').value) || 0,
    duration: Number(document.getElementById('woDuration').value) || 0,
    calories: Number(document.getElementById('woCalories').value) || 0,
    time: new Date().toTimeString().slice(0, 5),
    date: todayKey(),
  };
  getDay().workouts.push(entry);
  saveState();
  ['woExercise', 'woSets', 'woReps', 'woWeight', 'woDuration', 'woCalories'].forEach((id) => (document.getElementById(id).value = ''));
  renderAll();
  toast(`Logged ${exercise}`);
});

function renderWorkoutLog() {
  const day = getDay();
  const list = document.getElementById('workoutLogList');
  list.innerHTML = '';
  if (!day.workouts.length) {
    list.innerHTML = '<li class="empty-state">No workouts logged today.</li>';
  } else {
    day.workouts.forEach((w, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="t-meta"><b>${escapeHtml(w.exercise)}</b><span>${w.sets}×${w.reps} @ ${w.weight}kg · ${w.time}</span></div><div class="t-val">${w.calories || 0} kcal</div><button class="del-btn" data-i="${i}">✕</button>`;
      li.querySelector('.del-btn').addEventListener('click', () => {
        day.workouts.splice(i, 1);
        saveState();
        renderAll();
      });
      list.appendChild(li);
    });
  }

  const histList = document.getElementById('workoutHistoryList');
  histList.innerHTML = '';
  const allWorkouts = [];
  Object.entries(state.days).forEach(([date, d]) => d.workouts.forEach((w) => allWorkouts.push({ ...w, date })));
  allWorkouts.sort((a, b) => b.date.localeCompare(a.date));
  if (!allWorkouts.length) {
    histList.innerHTML = '<li class="empty-state">Your workout history will build up here.</li>';
  } else {
    allWorkouts.slice(0, 15).forEach((w) => {
      const li = document.createElement('li');
      li.innerHTML = `<div class="t-meta"><b>${escapeHtml(w.exercise)}</b><span>${w.date}</span></div><div class="t-val">${w.sets}×${w.reps} @ ${w.weight}kg</div>`;
      histList.appendChild(li);
    });
  }
}

/* ===================== WATER ===================== */
document.getElementById('addWaterBtn').addEventListener('click', () => {
  getDay().waterGlasses += 1;
  saveState();
  renderAll();
});

/* ===================== HABITS ===================== */
function renderHabits() {
  const list = document.getElementById('habitList');
  list.innerHTML = '';
  const key = todayKey();
  state.habits.forEach((h) => {
    const done = !!h.history[key];
    const streak = computeHabitStreak(h);
    const li = document.createElement('li');
    li.innerHTML = `
      <div class="habit-left">
        <button class="habit-check ${done ? 'done' : ''}" data-id="${h.id}">${done ? '✓' : ''}</button>
        <span class="habit-name">${escapeHtml(h.name)}</span>
      </div>
      <span class="habit-streak">${streak} day streak</span>
    `;
    li.querySelector('.habit-check').addEventListener('click', () => {
      h.history[key] = !h.history[key];
      saveState();
      renderHabits();
      renderDashboard();
    });
    list.appendChild(li);
  });
}

function computeHabitStreak(h) {
  let streak = 0;
  let d = new Date();
  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (h.history[key]) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

document.getElementById('addHabitBtn').addEventListener('click', () => {
  const input = document.getElementById('newHabitInput');
  const name = input.value.trim();
  if (!name) return;
  state.habits.push({ id: 'h' + Date.now(), name, history: {} });
  input.value = '';
  saveState();
  renderHabits();
});

/* ===================== PROGRESS / WEIGHT ===================== */
document.getElementById('logWeightBtn').addEventListener('click', () => {
  const weight = Number(document.getElementById('progWeight').value);
  if (!weight) {
    toast('Enter a weight to log.');
    return;
  }
  const waist = Number(document.getElementById('progWaist').value) || null;
  state.weightHistory.push({ date: todayKey(), weight, waist });
  state.profile.weight = weight;
  state.profile.calcs = calculateProfile(state.profile);
  saveState();
  document.getElementById('progWeight').value = '';
  document.getElementById('progWaist').value = '';
  renderAll();
  toast('Weight logged.');
});

function renderWeightChart() {
  const svg = document.getElementById('weightChart');
  const data = [...state.weightHistory].sort((a, b) => a.date.localeCompare(b.date));
  const note = document.getElementById('weightTrendNote');
  if (data.length < 2) {
    svg.innerHTML = '';
    note.textContent = 'Log a couple of entries to see your trend.';
    return;
  }
  const weights = data.map((d) => d.weight);
  const min = Math.min(...weights) - 1;
  const max = Math.max(...weights) + 1;
  const w = 320, h = 140, pad = 10;
  const stepX = (w - pad * 2) / (data.length - 1);
  const pts = data.map((d, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((d.weight - min) / (max - min || 1)) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const dots = pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#FF5A36"/>`).join('');
  svg.innerHTML = `<path d="${path}" fill="none" stroke="#FF5A36" stroke-width="2.5"/>${dots}`;

  const change = Math.round((weights[weights.length - 1] - weights[0]) * 10) / 10;
  note.textContent = `${change > 0 ? '+' : ''}${change}kg since first log`;

  const histList = document.getElementById('weightHistoryList');
  histList.innerHTML = '';
  [...data].reverse().forEach((d) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="t-meta"><b>${d.weight} kg</b><span>${d.date}</span></div>${d.waist ? `<div class="t-val">waist ${d.waist}cm</div>` : ''}`;
    histList.appendChild(li);
  });
}

/* ===================== SETTINGS ===================== */
function renderCalcNumbers() {
  const c = state.profile.calcs;
  const grid = document.getElementById('calcNumbersGrid');
  const items = [
    ['BMI', `${c.bmi} · ${bmiLabel(c.bmi)}`],
    ['Ideal weight', `${c.idealMin}–${c.idealMax} kg`],
    ['BMR', `${c.bmr} kcal`],
    ['TDEE', `${c.tdee} kcal`],
    ['Daily calories', `${c.calories} kcal`],
    ['Protein target', `${c.protein} g`],
    ['Carb target', `${c.carbs} g`],
    ['Fat target', `${c.fat} g`],
    ['Fiber target', `${c.fiber} g`],
    ['Water target', `${c.waterGlasses} glasses`],
  ];
  grid.innerHTML = items
    .map(([l, v]) => `<div class="num-item"><div class="nv">${v}</div><div class="nl">${l}</div></div>`)
    .join('');
}

document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(state.theme === 'dark' ? 'light' : 'dark');
  saveState();
});
document.getElementById('themeSeg').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  applyTheme(btn.dataset.theme);
  saveState();
});
function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  document.querySelectorAll('#themeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.theme === theme));
}

document.getElementById('exportDataBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fittrack-backup-${todayKey()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importDataInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      state = { ...defaultState(), ...imported };
      saveState();
      location.reload();
    } catch (err) {
      toast('That file could not be read as a backup.');
    }
  };
  reader.readAsText(file);
});

document.getElementById('resetAppBtn').addEventListener('click', () => {
  if (confirm('This deletes your profile and all logs from this device. Continue?')) {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  }
});

/* ===================== UTIL ===================== */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

function renderAll() {
  renderDashboard();
  renderFavorites();
  renderMealLog();
  renderWorkoutLog();
  renderHabits();
  renderCalcNumbers();
}

/* ===================== INIT ===================== */
(function init() {
  if (state.profile) {
    enterApp();
  } else {
    document.getElementById('onboarding').classList.remove('hidden');
    showObStep(0);
  }
  applyTheme(state.theme || 'dark');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
})();
