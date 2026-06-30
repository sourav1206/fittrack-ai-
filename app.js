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
    geminiKey: '',
    aiCoach: { date: null, items: null, error: '' },
    workoutPlanProgress: {}, // dateKey -> { exerciseIndex: true }
    reminders: {
      waterEnable: false, waterMinutes: 60,
      mealsEnable: false,
      workoutEnable: false, workoutTime: '17:00',
      sleepEnable: false,
      weighInEnable: false,
      smartNudgeEnable: false, smartNudgeTime: '16:00',
      lastFired: {}, // key -> dateKey or weekKey already fired
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const defaults = defaultState();
    const merged = { ...defaults, ...parsed };
    // Shallow merge above replaces nested objects wholesale, so saved state from
    // before a field was added would silently lose that field. Deep-merge the
    // nested config objects so new sub-fields always get their default.
    merged.reminders = { ...defaults.reminders, ...(parsed.reminders || {}) };
    merged.aiCoach = { ...defaults.aiCoach, ...(parsed.aiCoach || {}) };
    return merged;
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
  loadAiCoachOnDashboard();
}

document.querySelectorAll('[data-view-btn]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.viewBtn));
});

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.viewBtn === name));
  if (name === 'progress') { renderWeightChart(); renderCalorieChart(); }
  if (name === 'dashboard') loadAiCoachOnDashboard();
}

document.getElementById('addEntryBtn').addEventListener('click', () => switchView('log'));
document.getElementById('profileBtn').addEventListener('click', () => switchView('settings'));

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
  renderAiCoachState();
}

/* ===================== AI FOOD COACH ===================== */
function remainingMacros() {
  const calcs = state.profile.calcs;
  const totals = todayTotals();
  return {
    calories: Math.max(calcs.calories - totals.cal, 0),
    protein: Math.max(calcs.protein - totals.protein, 0),
    carbs: Math.max(calcs.carbs - totals.carbs, 0),
    fat: Math.max(calcs.fat - totals.fat, 0),
  };
}

function buildCoachPrompt() {
  const p = state.profile;
  const rem = remainingMacros();
  return `I'm based in India and follow a ${p.diet} diet. My goal is ${p.goal}. For the rest of today I have roughly ${rem.calories} kcal, ${rem.protein}g protein, ${rem.carbs}g carbs, and ${rem.fat}g fat left in my targets. Suggest 4 to 5 distinct, specific Indian meal or snack ideas (home-style or commonly available in India — e.g. dal, sabzi, roti, rice, paneer, curd, idli, dosa, sprouts, eggs, chicken curry, etc. depending on my diet) that fit within these remaining macros, using realistic Indian portion sizes (each suggestion is standalone, not meant to be eaten together). For each, estimate its own calories and macros.`;
}

function safeParseJson(raw) {
  let text = (raw || '').trim();
  text = text.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(text);
  } catch (e) {
    try {
      return JSON.parse(text.replace(/,\s*([}\]])/g, '$1'));
    } catch (e2) {
      throw new Error('Got an unexpected response from Gemini — tap Refresh to try again.');
    }
  }
}

const MEAL_SUGGESTION_SCHEMA = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      name: { type: 'STRING' },
      calories: { type: 'NUMBER' },
      protein: { type: 'NUMBER' },
      carbs: { type: 'NUMBER' },
      fat: { type: 'NUMBER' },
    },
    required: ['name', 'calories', 'protein', 'carbs', 'fat'],
  },
};

function renderAiCoachBody(html) {
  document.getElementById('aiCoachBody').innerHTML = html;
}

function renderMealSuggestionsTable(items) {
  if (!Array.isArray(items) || !items.length) {
    renderAiCoachBody('<p class="muted small">No suggestions returned. Try refreshing.</p>');
    return;
  }
  const rows = items
    .map(
      (m) => `
      <tr>
        <td>${escapeHtml(m.name || '')}</td>
        <td>${Math.round(m.calories || 0)}</td>
        <td>${Math.round(m.protein || 0)}g</td>
        <td>${Math.round(m.carbs || 0)}g</td>
        <td>${Math.round(m.fat || 0)}g</td>
        <td><button class="mini-btn log-suggestion-btn" data-i="${items.indexOf(m)}">+ Log</button></td>
      </tr>`
    )
    .join('');
  renderAiCoachBody(`
    <table class="meal-suggest-table">
      <thead><tr><th>Idea</th><th>Kcal</th><th>P</th><th>C</th><th>F</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `);
  document.querySelectorAll('.log-suggestion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = items[Number(btn.dataset.i)];
      if (!item) return;
      getDay().meals.push({
        name: item.name,
        mealType: 'Suggested',
        cal: Math.round(item.calories || 0),
        protein: Math.round(item.protein || 0),
        carbs: Math.round(item.carbs || 0),
        fat: Math.round(item.fat || 0),
        time: new Date().toTimeString().slice(0, 5),
      });
      saveState();
      renderAll();
      toast(`Logged ${item.name}`);
    });
  });
}

function renderAiCoachState() {
  if (!state.geminiKey) {
    renderAiCoachBody('<p class="muted small">Add your Gemini API key in Settings to get personalized meal ideas.</p>');
    return;
  }
  const cached = state.aiCoach;
  if (cached.error && cached.date === todayKey()) {
    renderAiCoachBody(`<p class="ai-coach-error small">${escapeHtml(cached.error)}</p>`);
    return;
  }
  if (cached.items && cached.items.length && cached.date === todayKey()) {
    renderMealSuggestionsTable(cached.items);
    return;
  }
  renderAiCoachBody('<p class="muted small">No suggestions yet today. Tap Refresh to get some.</p>');
}

async function fetchAiCoachSuggestion() {
  if (!state.geminiKey) {
    renderAiCoachState();
    return;
  }
  renderAiCoachBody('<p class="muted small">Thinking of something good for you…</p>');
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildCoachPrompt() }] }],
        generationConfig: {
          maxOutputTokens: 2048,
          responseMimeType: 'application/json',
          responseSchema: MEAL_SUGGESTION_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) {}
      throw new Error(res.status === 400 || res.status === 403 ? 'Invalid API key — check it in Settings.' : (detail || `Request failed (${res.status}).`));
    }
    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('Response was cut off — tap Refresh to try again.');
    }
    const raw = (candidate?.content?.parts || []).map((p) => p.text || '').join('');
    const items = raw ? safeParseJson(raw) : [];
    state.aiCoach = { date: todayKey(), items, error: '' };
    saveState();
    renderAiCoachState();
  } catch (err) {
    state.aiCoach = { date: todayKey(), items: null, error: err.message || 'Could not reach the AI coach. Check your connection and API key.' };
    saveState();
    renderAiCoachState();
  }
}

function loadAiCoachOnDashboard() {
  if (!state.geminiKey) {
    renderAiCoachState();
    return;
  }
  if (state.aiCoach.date === todayKey() && ((state.aiCoach.items && state.aiCoach.items.length) || state.aiCoach.error)) {
    renderAiCoachState();
    return;
  }
  fetchAiCoachSuggestion();
}

document.getElementById('aiCoachRefreshBtn').addEventListener('click', fetchAiCoachSuggestion);

document.getElementById('saveKeyBtn').addEventListener('click', () => {
  const val = document.getElementById('geminiKeyInput').value.trim();
  state.geminiKey = val;
  state.aiCoach = { date: null, items: null, error: '' };
  saveState();
  document.getElementById('geminiKeyInput').value = '';
  renderGeminiKeyStatus();
  toast(val ? 'API key saved.' : 'API key cleared.');
  if (val) loadAiCoachOnDashboard();
  else renderAiCoachState();
});

function renderGeminiKeyStatus() {
  document.getElementById('geminiKeyStatus').textContent = state.geminiKey ? 'Key saved on this device.' : 'No key saved.';
}

/* ===================== PHOTO FOOD SCAN ===================== */
const FOOD_SCAN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    mealType: { type: 'STRING', enum: ['Breakfast', 'Morning Snack', 'Lunch', 'Evening Snack', 'Dinner', 'Pre-workout', 'Post-workout'] },
    calories: { type: 'NUMBER' },
    protein: { type: 'NUMBER' },
    carbs: { type: 'NUMBER' },
    fat: { type: 'NUMBER' },
  },
  required: ['name', 'calories', 'protein', 'carbs', 'fat'],
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.getElementById('scanPhotoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const statusEl = document.getElementById('scanPhotoStatus');
  if (!state.geminiKey) {
    statusEl.textContent = 'Add your Gemini API key in Settings first.';
    return;
  }
  statusEl.textContent = 'Analyzing photo…';
  try {
    const base64 = await fileToBase64(file);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
            { text: 'Identify the food in this photo and estimate its total calories and macros (protein, carbs, fat in grams) for the portion shown. Also guess which meal type this most likely is.' },
          ],
        }],
        generationConfig: {
          maxOutputTokens: 1024,
          responseMimeType: 'application/json',
          responseSchema: FOOD_SCAN_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (err) {}
      throw new Error(res.status === 400 || res.status === 403 ? 'Invalid API key — check it in Settings.' : (detail || `Request failed (${res.status}).`));
    }
    const data = await res.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') {
      throw new Error('Response was cut off — try again.');
    }
    const raw = (candidate?.content?.parts || []).map((p) => p.text || '').join('');
    const result = raw ? safeParseJson(raw) : {};
    fillFoodForm(result);
    statusEl.textContent = 'Filled in below — review and tap "Log meal".';
  } catch (err) {
    statusEl.textContent = err.message || 'Could not analyze that photo. Try again.';
  }
});

/* ===================== VOICE MEAL LOGGING ===================== */
async function estimateFoodFromText(description) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `I'm in India. Estimate the calories and macros for this food description, using typical Indian portion sizes: "${description}". Also guess which meal type this most likely is.` }] }],
      generationConfig: {
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
        responseSchema: FOOD_SCAN_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (err) {}
    throw new Error(res.status === 400 || res.status === 403 ? 'Invalid API key — check it in Settings.' : (detail || `Request failed (${res.status}).`));
  }
  const data = await res.json();
  const candidate = data.candidates?.[0];
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new Error('Response was cut off — try again.');
  }
  const raw = (candidate?.content?.parts || []).map((p) => p.text || '').join('');
  return raw ? safeParseJson(raw) : {};
}

function fillFoodForm(result) {
  document.getElementById('logFoodName').value = result.name || '';
  document.getElementById('logCal').value = Math.round(result.calories || 0) || '';
  document.getElementById('logProtein').value = Math.round(result.protein || 0) || '';
  document.getElementById('logCarbs').value = Math.round(result.carbs || 0) || '';
  document.getElementById('logFat').value = Math.round(result.fat || 0) || '';
  if (result.mealType) document.getElementById('logMealType').value = result.mealType;
}

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

document.getElementById('voiceLogBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('voiceLogStatus');
  if (!state.geminiKey) {
    statusEl.textContent = 'Add your Gemini API key in Settings first.';
    return;
  }
  if (!SpeechRecognitionCtor) {
    statusEl.textContent = 'Voice input is not supported in this browser. Try Chrome on Android or desktop.';
    return;
  }
  const recognition = new SpeechRecognitionCtor();
  recognition.lang = 'en-IN';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  statusEl.textContent = 'Listening… speak now.';
  recognition.start();

  recognition.onresult = async (e) => {
    const transcript = e.results[0][0].transcript;
    statusEl.textContent = `Heard: "${transcript}" — analyzing…`;
    try {
      const result = await estimateFoodFromText(transcript);
      fillFoodForm(result);
      statusEl.textContent = 'Filled in below — review and tap "Log meal".';
    } catch (err) {
      statusEl.textContent = err.message || 'Could not analyze that. Try again.';
    }
  };
  recognition.onerror = (e) => {
    statusEl.textContent = e.error === 'not-allowed' ? 'Microphone permission denied.' : `Voice input error: ${e.error}`;
  };
  recognition.onend = () => {
    if (statusEl.textContent === 'Listening… speak now.') statusEl.textContent = 'No speech detected. Try again.';
  };
});

/* ===================== INDIAN QUICK ADD ===================== */
const INDIAN_QUICK_ADD = [
  { name: 'Roti (1 medium)', cal: 80, protein: 3, carbs: 18, fat: 0.4 },
  { name: 'Plain Rice (1 cup cooked)', cal: 205, protein: 4, carbs: 45, fat: 0.4 },
  { name: 'Dal Tadka (1 bowl)', cal: 180, protein: 9, carbs: 20, fat: 7 },
  { name: 'Rajma (1 bowl)', cal: 220, protein: 12, carbs: 35, fat: 3 },
  { name: 'Chole (1 bowl)', cal: 270, protein: 12, carbs: 38, fat: 8 },
  { name: 'Paneer Sabzi (1 cup)', cal: 280, protein: 14, carbs: 10, fat: 20 },
  { name: 'Paneer Tikka (6 pieces)', cal: 280, protein: 18, carbs: 6, fat: 20 },
  { name: 'Mixed Veg Sabzi (1 cup)', cal: 140, protein: 4, carbs: 16, fat: 7 },
  { name: 'Idli (2 pieces)', cal: 120, protein: 4, carbs: 24, fat: 0.5 },
  { name: 'Masala Dosa (1)', cal: 220, protein: 5, carbs: 35, fat: 7 },
  { name: 'Plain Dosa (1)', cal: 168, protein: 4, carbs: 28, fat: 4 },
  { name: 'Sambar (1 bowl)', cal: 120, protein: 6, carbs: 18, fat: 3 },
  { name: 'Poha (1 plate)', cal: 250, protein: 5, carbs: 45, fat: 6 },
  { name: 'Upma (1 plate)', cal: 240, protein: 6, carbs: 40, fat: 6 },
  { name: 'Paratha, plain (1)', cal: 150, protein: 4, carbs: 22, fat: 5 },
  { name: 'Curd (1 cup)', cal: 150, protein: 8, carbs: 11, fat: 8 },
  { name: 'Buttermilk / Chaas (1 glass)', cal: 40, protein: 2, carbs: 4, fat: 1 },
  { name: 'Sprouts Salad (1 cup)', cal: 150, protein: 9, carbs: 25, fat: 1 },
  { name: 'Boiled Eggs (2)', cal: 155, protein: 13, carbs: 1, fat: 11 },
  { name: 'Egg Curry (2 eggs)', cal: 240, protein: 14, carbs: 6, fat: 18 },
  { name: 'Chicken Curry (1 cup)', cal: 280, protein: 25, carbs: 8, fat: 17 },
  { name: 'Butter Chicken (1 cup)', cal: 350, protein: 22, carbs: 10, fat: 24 },
  { name: 'Tandoori Chicken (2 pieces)', cal: 250, protein: 32, carbs: 2, fat: 12 },
  { name: 'Chicken Biryani (1 plate)', cal: 480, protein: 28, carbs: 55, fat: 16 },
  { name: 'Veg Biryani (1 plate)', cal: 350, protein: 8, carbs: 60, fat: 9 },
  { name: 'Banana (1 medium)', cal: 105, protein: 1.3, carbs: 27, fat: 0.4 },
  { name: 'Almonds (10 pieces)', cal: 70, protein: 2.6, carbs: 2.5, fat: 6 },
];

function renderQuickAddList(filter = '') {
  const list = document.getElementById('quickAddList');
  const q = filter.trim().toLowerCase();
  const items = INDIAN_QUICK_ADD.filter((f) => !q || f.name.toLowerCase().includes(q));
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<li class="empty-state">No matches.</li>';
    return;
  }
  items.forEach((f) => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(f.name)}</span><span class="t-val">${f.cal} kcal</span>`;
    li.addEventListener('click', () => {
      getDay().meals.push({
        name: f.name,
        mealType: document.getElementById('logMealType').value,
        cal: f.cal,
        protein: f.protein,
        carbs: f.carbs,
        fat: f.fat,
        time: new Date().toTimeString().slice(0, 5),
      });
      saveState();
      renderAll();
      toast(`Logged ${f.name}`);
    });
    list.appendChild(li);
  });
}

document.getElementById('quickAddSearch').addEventListener('input', (e) => renderQuickAddList(e.target.value));

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

/* ===================== WORKOUT PLAN ===================== */
const WORKOUT_SPLIT_GYM = {
  0: { label: 'Rest Day', exercises: [] },
  1: { label: 'Push Day · Chest, Shoulders, Triceps', exercises: ['Barbell Bench Press', 'Overhead Press', 'Incline Dumbbell Press', 'Lateral Raises', 'Triceps Pushdown'] },
  2: { label: 'Pull Day · Back, Biceps', exercises: ['Deadlift', 'Lat Pulldown', 'Barbell Row', 'Face Pulls', 'Barbell Curl'] },
  3: { label: 'Leg Day', exercises: ['Back Squat', 'Leg Press', 'Romanian Deadlift', 'Walking Lunges', 'Calf Raises'] },
  4: { label: 'Upper Body', exercises: ['Incline Bench Press', 'Pull-Ups', 'Dumbbell Shoulder Press', 'Seated Cable Row', 'Hammer Curl'] },
  5: { label: 'Lower Body + Core', exercises: ['Front Squat', 'Hip Thrust', 'Leg Curl', 'Plank', 'Hanging Leg Raise'] },
  6: { label: 'Full Body', exercises: ['Goblet Squat', 'Push-Ups', 'Dumbbell Row', 'Kettlebell Swing', 'Farmer Carry'] },
};
const WORKOUT_SPLIT_HOME = {
  0: { label: 'Rest Day', exercises: [] },
  1: { label: 'Push Day · Bodyweight', exercises: ['Push-Ups', 'Pike Push-Ups', 'Diamond Push-Ups', 'Chair Triceps Dips', 'Plank to Push-Up'] },
  2: { label: 'Pull Day · Bodyweight', exercises: ['Doorframe Rows', 'Superman Hold', 'Towel Curl Pulls', 'Reverse Snow Angels', 'Isometric Curl Hold'] },
  3: { label: 'Leg Day · Bodyweight', exercises: ['Bodyweight Squats', 'Walking Lunges', 'Glute Bridge', 'Step-Ups', 'Calf Raises'] },
  4: { label: 'Upper Body · Bodyweight', exercises: ['Push-Ups', 'Pike Push-Ups', 'Doorframe Rows', 'Plank Shoulder Taps', 'Chair Triceps Dips'] },
  5: { label: 'Lower Body + Core', exercises: ['Jump Squats', 'Single-Leg Glute Bridge', 'Wall Sit', 'Plank', 'Bicycle Crunches'] },
  6: { label: 'Full Body · Bodyweight', exercises: ['Burpees', 'Push-Ups', 'Bodyweight Squats', 'Mountain Climbers', 'Plank'] },
};

function setsRepsForExperience(experience, goal) {
  if (experience === 'advanced') return goal === 'muscle-gain' ? '5 × 6-8' : '4-5 × 8-10';
  if (experience === 'intermediate') return '4 × 8-10';
  return '3 × 10-12';
}

function computeWorkoutPlan() {
  const p = state.profile;
  const day = new Date().getDay();
  const split = (p.workoutStyle === 'home' ? WORKOUT_SPLIT_HOME : WORKOUT_SPLIT_GYM)[day];
  const setsReps = setsRepsForExperience(p.experience, p.goal);
  return { label: split.label, exercises: split.exercises.map((name) => ({ name, setsReps })) };
}

function renderWorkoutPlan() {
  const plan = computeWorkoutPlan();
  const key = todayKey();
  const progress = state.workoutPlanProgress[key] || (state.workoutPlanProgress[key] = {});
  document.getElementById('workoutPlanTitle').textContent = `🏋️ ${plan.label}`;
  const list = document.getElementById('workoutPlanList');
  list.innerHTML = '';

  if (!plan.exercises.length) {
    document.getElementById('workoutPlanCount').textContent = '';
    list.innerHTML = '<li class="empty-state">Rest day — recovery is part of the plan. Maybe a light walk or stretch.</li>';
    return;
  }

  plan.exercises.forEach((ex, i) => {
    const done = !!progress[i];
    const li = document.createElement('li');
    li.className = 'plan-item';
    li.innerHTML = `
      <div class="habit-left">
        <button class="habit-check ${done ? 'done' : ''}" data-i="${i}">${done ? '✓' : ''}</button>
        <span class="plan-name ${done ? 'plan-done' : ''}">${escapeHtml(ex.name)}</span>
      </div>
      <span class="plan-setsreps">${ex.setsReps}</span>
    `;
    li.querySelector('.habit-check').addEventListener('click', () => {
      progress[i] = !progress[i];
      saveState();
      renderWorkoutPlan();
    });
    list.appendChild(li);
  });

  const doneCount = plan.exercises.filter((_, i) => progress[i]).length;
  document.getElementById('workoutPlanCount').textContent = `${doneCount}/${plan.exercises.length}`;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function renderWeeklySplit() {
  const p = state.profile;
  const split = p.workoutStyle === 'home' ? WORKOUT_SPLIT_HOME : WORKOUT_SPLIT_GYM;
  const today = new Date().getDay();
  const list = document.getElementById('weeklySplitList');
  list.innerHTML = '';
  for (let i = 0; i < 7; i++) {
    const day = split[i];
    const li = document.createElement('li');
    li.className = `week-split-item${i === today ? ' week-split-today' : ''}`;
    li.innerHTML = `<span class="week-split-day">${WEEKDAY_NAMES[i]}${i === today ? ' · today' : ''}</span><span class="week-split-label">${escapeHtml(day.label)}</span>`;
    list.appendChild(li);
  }
}

/* ===================== WORKOUT LOG ===================== */
function computePRs() {
  const best = {};
  Object.entries(state.days).forEach(([date, day]) => {
    day.workouts.forEach((w) => {
      if (!w.exercise || !w.weight) return;
      const key = w.exercise.trim().toLowerCase();
      if (!best[key] || w.weight > best[key].weight) {
        best[key] = { weight: w.weight, reps: w.reps, date, displayName: w.exercise };
      }
    });
  });
  return Object.values(best).sort((a, b) => b.weight - a.weight);
}

function renderPRs() {
  const prs = computePRs();
  const list = document.getElementById('prList');
  list.innerHTML = '';
  if (!prs.length) {
    list.innerHTML = '<li class="empty-state">Log a weighted set to start tracking PRs.</li>';
    return;
  }
  prs.forEach((pr) => {
    const li = document.createElement('li');
    li.innerHTML = `<div class="t-meta"><b>${escapeHtml(pr.displayName)}</b><span>${pr.date}</span></div><div class="t-val">${pr.weight}kg × ${pr.reps}</div>`;
    list.appendChild(li);
  });
}

document.getElementById('logWorkoutBtn').addEventListener('click', () => {
  const exercise = document.getElementById('woExercise').value.trim();
  if (!exercise) {
    toast('Add an exercise name.');
    return;
  }
  const weight = Number(document.getElementById('woWeight').value) || 0;
  const prevBest = computePRs().find((pr) => pr.displayName.trim().toLowerCase() === exercise.toLowerCase());
  const entry = {
    exercise,
    sets: Number(document.getElementById('woSets').value) || 0,
    reps: Number(document.getElementById('woReps').value) || 0,
    weight,
    duration: Number(document.getElementById('woDuration').value) || 0,
    calories: Number(document.getElementById('woCalories').value) || 0,
    time: new Date().toTimeString().slice(0, 5),
    date: todayKey(),
  };
  getDay().workouts.push(entry);
  saveState();
  ['woExercise', 'woSets', 'woReps', 'woWeight', 'woDuration', 'woCalories'].forEach((id) => (document.getElementById(id).value = ''));
  renderAll();
  const isNewPr = weight > 0 && (!prevBest || weight > prevBest.weight);
  toast(isNewPr ? `🏆 New PR! ${exercise} @ ${weight}kg` : `Logged ${exercise}`);
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

/* ===================== ACHIEVEMENTS ===================== */
function computeAchievements() {
  const p = state.profile;
  const days = Object.values(state.days);
  const anyWorkout = days.some((d) => d.workouts.length > 0);
  const streak = computeStreak();
  const proteinGoalHit = days.some((d) => {
    const protein = d.meals.reduce((sum, m) => sum + (m.protein || 0), 0);
    return protein >= p.calcs.protein;
  });
  const hydrationDays = days.filter((d) => d.waterGlasses >= p.calcs.waterGlasses).length;
  const earlyBird = days.some((d) => d.meals.some((m) => m.time && m.time < '08:00'));
  const weights = [...state.weightHistory].sort((a, b) => a.date.localeCompare(b.date));
  const fiveKgMilestone = weights.length > 1 && weights.some((w) => Math.abs(w.weight - weights[0].weight) >= 5);

  return [
    { id: 'firstWorkout', icon: '🏋️', name: 'First Workout', unlocked: anyWorkout },
    { id: 'streak7', icon: '🔥', name: '7-Day Streak', unlocked: streak >= 7 },
    { id: 'streak14', icon: '🔥', name: '14-Day Streak', unlocked: streak >= 14 },
    { id: 'streak30', icon: '🔥', name: '30-Day Streak', unlocked: streak >= 30 },
    { id: 'proteinGoal', icon: '🥩', name: 'Protein Goal Hit', unlocked: proteinGoalHit },
    { id: 'hydration', icon: '💧', name: 'Hydration Champion', unlocked: hydrationDays >= 7 },
    { id: 'earlyBird', icon: '🌅', name: 'Early Bird', unlocked: earlyBird },
    { id: 'milestone5kg', icon: '⚖️', name: '5kg Milestone', unlocked: fiveKgMilestone },
  ];
}

function renderAchievements() {
  const badges = computeAchievements();
  const grid = document.getElementById('achievementGrid');
  grid.innerHTML = badges
    .map(
      (b) => `
      <div class="badge ${b.unlocked ? 'unlocked' : ''}">
        <span class="badge-icon">${b.icon}</span>
        <span class="badge-name">${b.name}</span>
      </div>`
    )
    .join('');
  const count = badges.filter((b) => b.unlocked).length;
  document.getElementById('achievementCount').textContent = `${count}/${badges.length}`;
}

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
  renderWeightChart();
  renderCalorieChart();
  toast('Weight logged.');
});

function renderCalorieChart() {
  const svg = document.getElementById('calorieChart');
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const day = state.days[key];
    const cal = day ? day.meals.reduce((sum, m) => sum + (m.cal || 0), 0) : 0;
    days.push({ key, cal });
  }
  const target = state.profile.calcs.calories;
  const w = 320, h = 140, pad = 10;
  const maxVal = Math.max(target, ...days.map((d) => d.cal)) * 1.1 || 1;
  const stepX = (w - pad * 2) / (days.length - 1);
  const yFor = (val) => h - pad - (val / maxVal) * (h - pad * 2);
  const pts = days.map((d, i) => [pad + i * stepX, yFor(d.cal)]);
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const dots = pts
    .map((p, i) => (days[i].cal > 0 ? `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" fill="#FF5A36"/>` : ''))
    .join('');
  const targetY = yFor(target).toFixed(1);
  svg.innerHTML = `
    <line x1="${pad}" y1="${targetY}" x2="${w - pad}" y2="${targetY}" stroke="#2DD4BF" stroke-width="1.5" stroke-dasharray="4 3"/>
    <path d="${path}" fill="none" stroke="#FF5A36" stroke-width="2.5"/>${dots}
  `;
}

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

/* ===================== REMINDERS ===================== */
function renderReminderForm() {
  const r = state.reminders;
  document.getElementById('remWaterEnable').checked = r.waterEnable;
  document.getElementById('remWaterMinutes').value = r.waterMinutes;
  document.getElementById('remMealsEnable').checked = r.mealsEnable;
  document.getElementById('remWorkoutEnable').checked = r.workoutEnable;
  document.getElementById('remWorkoutTime').value = r.workoutTime;
  document.getElementById('remSleepEnable').checked = r.sleepEnable;
  document.getElementById('remSleepTimeNote').textContent = state.profile && state.profile.sleep
    ? `uses bedtime from profile (${state.profile.sleep})`
    : 'uses bedtime from profile';
  document.getElementById('remWeighInEnable').checked = r.weighInEnable;
  document.getElementById('remSmartNudgeEnable').checked = r.smartNudgeEnable;
  document.getElementById('remSmartNudgeTime').value = r.smartNudgeTime;
}

document.getElementById('enableNotifBtn').addEventListener('click', () => {
  if (!('Notification' in window)) {
    toast('Notifications are not supported in this browser.');
    return;
  }
  Notification.requestPermission().then((perm) => {
    toast(perm === 'granted' ? 'Notifications enabled.' : 'Notification permission was not granted.');
  });
});

document.getElementById('saveReminderBtn').addEventListener('click', () => {
  state.reminders.waterEnable = document.getElementById('remWaterEnable').checked;
  state.reminders.waterMinutes = Math.max(5, Number(document.getElementById('remWaterMinutes').value) || 60);
  state.reminders.mealsEnable = document.getElementById('remMealsEnable').checked;
  state.reminders.workoutEnable = document.getElementById('remWorkoutEnable').checked;
  state.reminders.workoutTime = document.getElementById('remWorkoutTime').value || '17:00';
  state.reminders.sleepEnable = document.getElementById('remSleepEnable').checked;
  state.reminders.weighInEnable = document.getElementById('remWeighInEnable').checked;
  state.reminders.smartNudgeEnable = document.getElementById('remSmartNudgeEnable').checked;
  state.reminders.smartNudgeTime = document.getElementById('remSmartNudgeTime').value || '16:00';
  saveState();
  toast('Reminder settings saved.');
});

function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch (e) {}
}

function weekKey(d) {
  const date = new Date(d);
  const onejan = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date - onejan) / 86400000 + onejan.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${week}`;
}

async function fireSmartNudge() {
  try {
    const p = state.profile;
    const rem = remainingMacros();
    const day = getDay();
    const prompt = `I'm in India. Today so far: ${rem.calories} kcal and ${rem.protein}g protein still remaining out of my targets, ${day.waterGlasses}/${p.calcs.waterGlasses} glasses of water, and ${day.workouts.length ? 'a workout already logged' : 'no workout logged yet'}. Write exactly one short, specific, encouraging sentence (under 25 words, plain text, no markdown) nudging me on whichever of these needs the most attention right now.`;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(state.geminiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || []).map((p2) => p2.text || '').join('').trim();
    if (text) notify('FitTrack nudge 🤖', text);
  } catch (e) {
    // background nudge — fail silently, no UI to surface the error to
  }
}

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!state.profile) return;
  const r = state.reminders;
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const dKey = todayKey();
  const lastFired = r.lastFired || (r.lastFired = {});
  let dirty = false;

  if (r.waterEnable) {
    const last = lastFired.water || 0;
    if (Date.now() - last >= r.waterMinutes * 60000) {
      notify('Time for some water 💧', 'Log a glass to stay on track with your hydration goal.');
      lastFired.water = Date.now();
      dirty = true;
    }
  }

  if (r.mealsEnable) {
    [['breakfast', '08:00'], ['lunch', '13:00'], ['dinner', '20:00']].forEach(([name, time]) => {
      const fireKey = `meal_${name}`;
      if (hhmm >= time && lastFired[fireKey] !== dKey) {
        notify(`${name[0].toUpperCase() + name.slice(1)} reminder 🍽️`, `Don't forget to log your ${name}.`);
        lastFired[fireKey] = dKey;
        dirty = true;
      }
    });
  }

  if (r.workoutEnable && hhmm >= r.workoutTime && lastFired.workout !== dKey) {
    notify('Workout time 🏋️', "Today's a good day to get a session in.");
    lastFired.workout = dKey;
    dirty = true;
  }

  if (r.sleepEnable && state.profile.sleep && hhmm >= state.profile.sleep && lastFired.sleep !== dKey) {
    notify('Wind down 🌙', "It's close to your bedtime — start wrapping up.");
    lastFired.sleep = dKey;
    dirty = true;
  }

  if (r.weighInEnable && now.getDay() === 1 && hhmm >= '08:00' && lastFired.weighIn !== weekKey(now)) {
    notify('Weekly weigh-in ⚖️', 'Log your weight to keep your progress chart up to date.');
    lastFired.weighIn = weekKey(now);
    dirty = true;
  }

  if (r.smartNudgeEnable && state.geminiKey && hhmm >= r.smartNudgeTime && lastFired.smartNudge !== dKey) {
    lastFired.smartNudge = dKey; // set before the async call so a slow/failed fetch can't refire every tick
    dirty = true;
    fireSmartNudge();
  }

  if (dirty) saveState();
}

setInterval(checkReminders, 30000);

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
  renderQuickAddList(document.getElementById('quickAddSearch').value);
  renderMealLog();
  renderWorkoutLog();
  renderPRs();
  renderHabits();
  renderAchievements();
  renderWorkoutPlan();
  renderWeeklySplit();
  renderCalcNumbers();
  renderGeminiKeyStatus();
  renderReminderForm();
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
