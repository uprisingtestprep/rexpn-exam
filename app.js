/* REXPN Exam Simulator — Application Logic */

const ACCESS_CODE  = "REXPN9000";
const EXAM_SECONDS = 14400;
const PASSING_PCT  = 72;
const STORAGE_KEY  = "rexpn_exam_state_v1";
const SIM_Q_COUNT  = 300;  // simulator always serves the full 300-question pool

let questions = [];
let state = {
  phase: "gate", answers: {}, flags: {},
  current: 1, timeLeft: EXAM_SECONDS,
  submitted: false, startTime: null,
};
let timerInterval = null;

// ── boot ──────────────────────────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  const allQ = (window.EXAM_QUESTIONS || []).slice();
  shuffleArray(allQ);
  questions = allQ.slice(0, SIM_Q_COUNT);
  restoreState();

  document.getElementById("access-gate").style.display = "flex";
  document.getElementById("app").style.display = "none";
  setupAccessGate();
});

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  // Prevent 3+ consecutive same correct answer
  for (let i = 2; i < arr.length; i++) {
    if (arr[i].correct === arr[i-1].correct && arr[i].correct === arr[i-2].correct) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[j].correct !== arr[i-1].correct) {
          [arr[i], arr[j]] = [arr[j], arr[i]];
          break;
        }
      }
    }
  }
}

// ── access gate ───────────────────────────────────────────────────────────────
function setupAccessGate() {
  const attempt = () => {
    const val = document.getElementById("access-code-input").value.trim().toUpperCase();
    if (val === ACCESS_CODE) {
      document.getElementById("access-gate").style.display = "none";
      startExam();
    } else {
      const err = document.getElementById("access-error");
      err.textContent = "Incorrect access code. Please try again.";
      document.getElementById("access-code-input").value = "";
      document.getElementById("access-code-input").focus();
    }
  };
  document.getElementById("access-btn").addEventListener("click", attempt);
  document.getElementById("access-code-input").addEventListener("keydown",
    e => { if (e.key === "Enter") attempt(); });
}

// ── exam start ────────────────────────────────────────────────────────────────
function startExam() {
  if (state.submitted) {
    localStorage.removeItem(STORAGE_KEY);
    state = { phase: "gate", answers: {}, flags: {}, current: 1, timeLeft: EXAM_SECONDS, submitted: false, startTime: null };
  }
  document.getElementById("app").style.display = "flex";
  if (!state.startTime) state.startTime = Date.now();
  renderQuestion();
  startTimer();
  buildGrid();
  document.getElementById("submit-btn").addEventListener("click", confirmSubmit);
  document.getElementById("flag-btn").addEventListener("click",   toggleFlag);
  document.getElementById("prev-btn").addEventListener("click",   () => navigate(-1));
  document.getElementById("next-btn").addEventListener("click",   () => navigate(1));
  document.getElementById("map-btn").addEventListener("click",    openMapModal);
  document.getElementById("map-close").addEventListener("click",  closeMapModal);
  document.getElementById("map-backdrop").addEventListener("click", closeMapModal);
  document.addEventListener("keydown", keyHandler);
}

// ── timer ─────────────────────────────────────────────────────────────────────
function startTimer() {
  updateTimerDisplay();
  timerInterval = setInterval(() => {
    if (state.submitted) return;
    state.timeLeft = Math.max(0, EXAM_SECONDS - Math.floor((Date.now() - state.startTime) / 1000));
    updateTimerDisplay();
    if (state.timeLeft === 0) submitExam();
    saveState();
  }, 1000);
}

function updateTimerDisplay() {
  const h = Math.floor(state.timeLeft / 3600);
  const m = Math.floor((state.timeLeft % 3600) / 60);
  const s = state.timeLeft % 60;
  document.getElementById("timer-display").textContent =
    h > 0 ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`
           : `${m}:${String(s).padStart(2,"0")}`;
}

// ── render ─────────────────────────────────────────────────────────────────────
// Question types: "mcq" (default, single-select A-D), "sata" (multi-select
// checkboxes over 5-7 lettered options, 2+ correct), "fill_in_blank" (numeric
// text input, no lettered options at all). An "image" field can appear on any
// of the three types and is handled the same way regardless of q.type.
function qType(q) {
  return q?.type || "mcq";
}

function optionLetters(q) {
  return Object.keys(q.options || {}).sort();
}

function renderQuestion() {
  const q = questions[state.current - 1];
  if (!q) return;
  document.getElementById("q-counter").textContent = `Question ${state.current} of ${questions.length}`;
  document.getElementById("q-domain").textContent  = q.domain || "";
  document.getElementById("question-text").textContent = q.question;
  const imgWrap = document.getElementById("q-image-wrap");
  if (q.image) {
    imgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    imgWrap.style.display = "block";
  } else {
    imgWrap.innerHTML = "";
    imgWrap.style.display = "none";
  }
  const fi = document.getElementById("q-flag-indicator");
  fi.style.display = state.flags[state.current] ? "inline-block" : "none";

  document.getElementById("explanation-box").style.display = "none";

  const ol = document.getElementById("options-list");
  ol.innerHTML = "";
  const type = qType(q);

  if (type === "sata") {
    const note = document.createElement("div");
    note.className = "sata-instruction";
    note.textContent = "Select all that apply (2 or more)";
    ol.appendChild(note);
    const chosen = Array.isArray(state.answers[state.current]) ? state.answers[state.current] : [];
    optionLetters(q).forEach(letter => {
      const text = q.options[letter];
      const div = document.createElement("div");
      const isChecked = chosen.includes(letter);
      div.className = "option option-checkbox" + (isChecked ? " selected" : "");
      div.innerHTML = `<span class="opt-checkbox">${isChecked ? "☑" : "☐"}</span><span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      div.addEventListener("click", () => toggleSataAnswer(state.current, letter));
      ol.appendChild(div);
    });
  } else if (type === "fill_in_blank") {
    const wrap = document.createElement("div");
    wrap.className = "fib-wrap";
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "fib-input";
    input.placeholder = "Enter your answer";
    input.value = typeof state.answers[state.current] === "string" ? state.answers[state.current] : "";
    input.addEventListener("input", () => setFillInBlankAnswer(state.current, input.value));
    wrap.appendChild(input);
    if (q.unit) {
      const unit = document.createElement("span");
      unit.className = "fib-unit";
      unit.textContent = q.unit;
      wrap.appendChild(unit);
    }
    ol.appendChild(wrap);
  } else {
    const chosen = state.answers[state.current];
    ["A","B","C","D"].forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      div.className = "option" + (chosen === letter ? " selected" : "");
      div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      div.addEventListener("click", () => selectAnswer(state.current, letter));
      ol.appendChild(div);
    });
  }

  // Scroll question panel to top on navigation
  const panel = document.querySelector(".question-panel");
  if (panel) panel.scrollTop = 0;

  updateProgress();
  updateGrid();
}

function selectAnswer(qNum, letter) {
  if (state.submitted) return;
  state.answers[qNum] = letter;
  renderQuestion();
  saveState();
}

function toggleSataAnswer(qNum, letter) {
  if (state.submitted) return;
  const current = Array.isArray(state.answers[qNum]) ? state.answers[qNum].slice() : [];
  const idx = current.indexOf(letter);
  if (idx === -1) current.push(letter); else current.splice(idx, 1);
  current.sort();
  if (current.length === 0) {
    delete state.answers[qNum];
  } else {
    state.answers[qNum] = current;
  }
  renderQuestion();
  saveState();
}

function setFillInBlankAnswer(qNum, value) {
  if (state.submitted) return;
  if (value === "") {
    delete state.answers[qNum];
  } else {
    state.answers[qNum] = value;
  }
  // Don't call renderQuestion() here -- it would rebuild the input and steal
  // focus/cursor position on every keystroke. Update progress/grid only.
  updateProgress();
  updateGrid();
  saveState();
}

function navigate(dir) {
  const next = state.current + dir;
  if (next >= 1 && next <= questions.length) {
    state.current = next;
    renderQuestion();
  }
}

function toggleFlag() {
  state.flags[state.current] = !state.flags[state.current];
  renderQuestion();
  saveState();
}

// An answer only counts as "given" once it's non-empty for its type. state.answers
// entries are deleted (not left as empty string/array) whenever a user clears
// their input, so a plain existence check is sufficient and correct for all
// three question types (string letter, array of letters, typed text).
function isAnswered(num) {
  const a = state.answers[num];
  if (Array.isArray(a)) return a.length > 0;
  return a !== undefined && a !== null && a !== "";
}

function answeredCount() {
  let n = 0;
  for (let i = 1; i <= questions.length; i++) if (isAnswered(i)) n++;
  return n;
}

function updateProgress() {
  const pct = answeredCount() / questions.length * 100;
  document.getElementById("progress-bar").style.width = pct + "%";
}

// ── question map modal ────────────────────────────────────────────────────────
function openMapModal() {
  updateGrid();
  document.getElementById("map-modal").style.display = "flex";
}

function closeMapModal() {
  document.getElementById("map-modal").style.display = "none";
}

// ── grid ──────────────────────────────────────────────────────────────────────
function buildGrid() {
  const grid = document.getElementById("q-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.createElement("button");
    btn.className = "grid-btn";
    btn.id = `gb-${i}`;
    btn.textContent = i;
    btn.addEventListener("click", () => {
      state.current = i;
      closeMapModal();
      renderQuestion();
    });
    grid.appendChild(btn);
  }
}

function updateGrid() {
  for (let i = 1; i <= questions.length; i++) {
    const btn = document.getElementById(`gb-${i}`);
    if (!btn) continue;
    btn.className = "grid-btn" +
      (isAnswered(i)     ? " answered" : "") +
      (state.flags[i]    ? " flagged"  : "") +
      (state.current===i ? " active"   : "");
  }
}

// ── submit ────────────────────────────────────────────────────────────────────
function confirmSubmit() {
  const unanswered = questions.length - answeredCount();
  if (unanswered > 0) {
    alert(`You must answer all ${questions.length} questions before submitting.\n\n${unanswered} question${unanswered > 1 ? "s" : ""} still unanswered.\n\nTap "Question Map" to find unanswered questions.`);
    return;
  }
  if (confirm("Submit your exam now?")) submitExam();
}

function submitExam() {
  clearInterval(timerInterval);
  state.submitted = true;
  saveState();
  showResults();
}

// ── scoring ───────────────────────────────────────────────────────────────────
// Normalizes a typed fill-in-blank answer and the keyed correct_value: if both
// parse as floats, compare numerically (so "45", "45.0", "45.00" all match);
// otherwise fall back to a case-insensitive exact string match.
function fillInBlankIsCorrect(userVal, correctVal) {
  if (typeof userVal !== "string" || userVal.trim() === "") return false;
  const u = userVal.trim();
  const c = String(correctVal).trim();
  const uf = parseFloat(u), cf = parseFloat(c);
  const uIsNum = u !== "" && !isNaN(uf) && isFinite(uf) && /^-?\d*\.?\d+$/.test(u);
  const cIsNum = c !== "" && !isNaN(cf) && isFinite(cf) && /^-?\d*\.?\d+$/.test(c);
  if (uIsNum && cIsNum) return uf === cf;
  return u.toLowerCase() === c.toLowerCase();
}

// A SATA answer is correct only if the user's selected set is EXACTLY the
// keyed set -- no partial credit.
function sataIsCorrect(userArr, correctArr) {
  if (!Array.isArray(userArr) || !Array.isArray(correctArr)) return false;
  if (userArr.length !== correctArr.length) return false;
  const a = [...userArr].sort(), b = [...correctArr].sort();
  return a.every((v, i) => v === b[i]);
}

function isQuestionCorrect(q, userAns) {
  const type = qType(q);
  if (type === "sata") return sataIsCorrect(userAns, q.correct);
  if (type === "fill_in_blank") return fillInBlankIsCorrect(userAns, q.correct_value);
  return userAns === q.correct;
}

// ── results ───────────────────────────────────────────────────────────────────
function showResults() {
  document.getElementById("app").style.display = "none";
  document.getElementById("results-screen").style.display = "flex";

  let correct = 0;
  const domainStats = {};
  questions.forEach((q, idx) => {
    const num = idx + 1;
    const userAns = state.answers[num];
    const isRight = isQuestionCorrect(q, userAns);
    if (isRight) correct++;
    const dom = q.domain || "Other";
    if (!domainStats[dom]) domainStats[dom] = { correct: 0, total: 0 };
    domainStats[dom].total++;
    if (isRight) domainStats[dom].correct++;
  });

  const pct  = Math.round(correct / questions.length * 100);
  const passed = pct >= PASSING_PCT;
  document.getElementById("res-status").textContent = passed ? "PASS" : "FAIL";
  document.getElementById("res-status").style.color = passed ? "#059669" : "#DC2626";
  document.getElementById("res-score").textContent  = `${correct} / ${questions.length} (${pct}%)`;

  const domDiv = document.getElementById("res-domains");
  domDiv.innerHTML = "";
  Object.entries(domainStats).forEach(([dom, s]) => {
    const dp = Math.round(s.correct / s.total * 100);
    domDiv.innerHTML += `<div class="res-domain-row">
      <span class="res-domain-name">${dom}</span>
      <div class="res-domain-bar-wrap"><div class="res-domain-bar" style="width:${dp}%;background:#1B3A6B"></div></div>
      <span class="res-domain-pct">${dp}%</span>
    </div>`;
  });

  document.getElementById("res-review-btn").addEventListener("click", () => {
    state.submitted = true;
    document.getElementById("results-screen").style.display = "none";
    document.getElementById("app").style.display = "flex";
    renderReview();
  });
  document.getElementById("res-restart-btn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function renderReview() {
  const ol = document.getElementById("options-list");
  const q  = questions[state.current - 1];
  if (!q) return;
  document.getElementById("q-counter").textContent = `Review — Question ${state.current} of ${questions.length}`;
  document.getElementById("question-text").textContent = q.question;
  const revImgWrap = document.getElementById("q-image-wrap");
  if (q.image) {
    revImgWrap.innerHTML = `<img src="${q.image}" alt="" class="q-image">`;
    revImgWrap.style.display = "block";
  } else {
    revImgWrap.innerHTML = "";
    revImgWrap.style.display = "none";
  }
  ol.innerHTML = "";
  const userAns = state.answers[state.current];
  const type = qType(q);

  if (type === "sata") {
    const correctSet = Array.isArray(q.correct) ? q.correct : [];
    const userSet = Array.isArray(userAns) ? userAns : [];
    optionLetters(q).forEach(letter => {
      const text = q.options[letter];
      const div = document.createElement("div");
      let cls = "option option-checkbox";
      const wasSelected = userSet.includes(letter);
      const isCorrectLetter = correctSet.includes(letter);
      if (isCorrectLetter && wasSelected)      cls += " correct";
      else if (isCorrectLetter && !wasSelected) cls += " missed";     // correct but user didn't pick it
      else if (!isCorrectLetter && wasSelected) cls += " incorrect";  // picked but shouldn't have
      div.className = cls;
      const mark = wasSelected ? "☑" : "☐";
      div.innerHTML = `<span class="opt-checkbox">${mark}</span><span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      ol.appendChild(div);
    });
  } else if (type === "fill_in_blank") {
    const wrap = document.createElement("div");
    wrap.className = "fib-review";
    const isRight = fillInBlankIsCorrect(userAns, q.correct_value);
    const yourLine = document.createElement("div");
    yourLine.className = "fib-review-line " + (isRight ? "correct" : "incorrect");
    yourLine.textContent = `Your answer: ${userAns !== undefined && userAns !== "" ? userAns : "(no answer)"}${q.unit ? " " + q.unit : ""}`;
    const correctLine = document.createElement("div");
    correctLine.className = "fib-review-line correct";
    correctLine.textContent = `Correct answer: ${q.correct_value}${q.unit ? " " + q.unit : ""}`;
    wrap.appendChild(yourLine);
    wrap.appendChild(correctLine);
    ol.appendChild(wrap);
  } else {
    ["A","B","C","D"].forEach(letter => {
      const text = q.options?.[letter];
      if (!text) return;
      const div = document.createElement("div");
      let cls = "option";
      if (letter === q.correct)      cls += " correct";
      else if (letter === userAns)   cls += " incorrect";
      div.className = cls;
      div.innerHTML = `<span class="opt-letter">${letter}</span><span class="opt-text">${text}</span>`;
      ol.appendChild(div);
    });
  }

  const box  = document.getElementById("explanation-box");
  const expl = document.getElementById("explanation-text");
  if (q.explanation) {
    expl.textContent = q.explanation;
    box.style.display = "block";
  } else {
    box.style.display = "none";
  }

  document.getElementById("prev-btn").onclick = () => { navigate(-1); renderReview(); };
  document.getElementById("next-btn").onclick = () => { navigate(1);  renderReview(); };
}

// ── persistence ───────────────────────────────────────────────────────────────
function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
}
function restoreState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { const s = JSON.parse(saved); Object.assign(state, s); }
  } catch(e) {}
}

// ── keyboard ──────────────────────────────────────────────────────────────────
const SATA_LETTERS = ["A","B","C","D","E","F","G"];

function keyHandler(e) {
  // While the fill-in-blank text field is focused, arrow keys must move the
  // text cursor, not navigate between questions.
  if (document.activeElement && document.activeElement.classList.contains("fib-input")) {
    if (e.key === "Escape") closeMapModal();
    return;
  }
  const q = questions[state.current - 1];
  const type = qType(q);
  if (e.ctrlKey || e.metaKey) { /* fall through to nav/escape only */ }
  else if (type === "sata") {
    // Number-row 1-7 or letter keys A-G both toggle the corresponding checkbox.
    let letter = null;
    if (/^[1-7]$/.test(e.key)) letter = SATA_LETTERS[parseInt(e.key, 10) - 1];
    else if (SATA_LETTERS.includes(e.key.toUpperCase())) letter = e.key.toUpperCase();
    if (letter && q?.options?.[letter]) toggleSataAnswer(state.current, letter);
  } else if (type === "fill_in_blank") {
    // No letter shortcuts for a text input -- typing must reach the field itself.
  } else {
    const letter = e.key.toUpperCase();
    if (["A","B","C","D"].includes(letter) && q?.options?.[letter]) {
      selectAnswer(state.current, letter);
    }
  }
  if (e.key === "ArrowRight" && state.current < questions.length) navigate(1);
  if (e.key === "ArrowLeft"  && state.current > 1)                navigate(-1);
  if (e.key === "Escape") closeMapModal();
}
