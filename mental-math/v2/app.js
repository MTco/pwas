"use strict";

const SETTINGS_KEY = "mental-math-sprint-settings-v5";
const SCORES_KEY = "mental-math-sprint-scores-v5";
const CACHE_BUST_VERSION = "6";

const OPERATIONS = [
  { id: "addition", label: "Addition", symbol: "+" },
  { id: "subtraction", label: "Subtraction", symbol: "−" },
  { id: "multiplication", label: "Multiplication", symbol: "×" },
  { id: "division", label: "Division", symbol: "÷" },
  { id: "fractions", label: "Fractions", symbol: "½" },
];

const DEFAULT_SETTINGS = Object.freeze({
  design: "paper",
  color: "system",
  difficulty: "medium",
  layout: "horizontal",
  operations: ["addition", "subtraction", "multiplication", "division"],
  minutes: 2,
  seconds: 0,
  initials: "",
});

const state = {
  ...DEFAULT_SETTINGS,
  phase: "setup",
  durationMs: 120000,
  remainingMs: 120000,
  correct: 0,
  attempted: 0,
  streak: 0,
  bestStreak: 0,
  mistakes: [],
  currentProblem: null,
  timerId: null,
  lastTick: 0,
  endedEarly: false,
  installPrompt: null,
};

const main = document.querySelector("#main");
const overlay = document.querySelector("#overlay");
const liveRegion = document.querySelector("#liveRegion");
const toast = document.querySelector("#toast");
const installButton = document.querySelector("#installButton");
const helpButton = document.querySelector("#helpButton");
const homeButton = document.querySelector("#homeButton");

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value);
  return element.innerHTML;
}

function readJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSettings() {
  const saved = readJson(SETTINGS_KEY, {});
  const validOperations = Array.isArray(saved.operations)
    ? saved.operations.filter((id) => OPERATIONS.some((operation) => operation.id === id))
    : [];

  state.design = ["paper", "tiles"].includes(saved.design) ? saved.design : DEFAULT_SETTINGS.design;
  state.color = ["system", "day", "night"].includes(saved.color) ? saved.color : DEFAULT_SETTINGS.color;
  state.difficulty = ["easy", "medium", "hard"].includes(saved.difficulty)
    ? saved.difficulty
    : DEFAULT_SETTINGS.difficulty;
  state.layout = ["horizontal", "vertical"].includes(saved.layout) ? saved.layout : DEFAULT_SETTINGS.layout;
  state.operations = validOperations.length ? validOperations : [...DEFAULT_SETTINGS.operations];
  state.minutes = clampInteger(saved.minutes, 0, 99, DEFAULT_SETTINGS.minutes);
  state.seconds = clampInteger(saved.seconds, 0, 59, DEFAULT_SETTINGS.seconds);
  state.initials = typeof saved.initials === "string"
    ? saved.initials.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3)
    : "";
  applyAppearance();
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        design: state.design,
        color: state.color,
        difficulty: state.difficulty,
        layout: state.layout,
        operations: state.operations,
        minutes: state.minutes,
        seconds: state.seconds,
        initials: state.initials,
      }),
    );
  } catch {
    showToast("Settings could not be saved on this device.");
  }
}

function getScores() {
  const scores = readJson(SCORES_KEY, []);
  return Array.isArray(scores) ? scores.slice(0, 3) : [];
}

function saveCompletedScore() {
  if (state.endedEarly || state.attempted === 0) return false;
  const record = {
    initials: state.initials,
    score: calculateScore(),
    correct: state.correct,
    attempted: state.attempted,
    accuracy: calculateAccuracy(),
    timestamp: new Date().toISOString(),
  };
  const scores = [...getScores(), record]
    .sort((a, b) => b.score - a.score || b.correct - a.correct)
    .slice(0, 3);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
    return scores.some(
      (item) => item.timestamp === record.timestamp && item.initials === record.initials,
    );
  } catch {
    showToast("This score could not be saved on this device.");
    return false;
  }
}

function clampInteger(value, min, max, fallback = min) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function applyAppearance() {
  document.documentElement.dataset.design = state.design;
  document.documentElement.dataset.color = state.color;
  document.querySelector("#app").dataset.design = state.design;
  document.querySelector("#app").dataset.color = state.color;
  const themeColor = state.design === "tiles" ? "#6d5dfc" : "#f4efe3";
  document.querySelector('meta[name="theme-color"]').setAttribute("content", themeColor);
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function choose(values) {
  return values[randomInteger(0, values.length - 1)];
}

function greatestCommonDivisor(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function rational(numerator, denominator = 1) {
  const sign = denominator < 0 ? -1 : 1;
  const divisor = greatestCommonDivisor(numerator, denominator);
  return {
    numerator: (numerator / divisor) * sign,
    denominator: Math.abs(denominator / divisor),
  };
}

function rationalText(value) {
  return value.denominator === 1
    ? String(value.numerator)
    : `${value.numerator}/${value.denominator}`;
}

function rationalValue(value) {
  return value.numerator / value.denominator;
}

function makeProblem() {
  const operation = choose(state.operations);
  const ranges = {
    easy: { min: 1, max: 12, factor: 10, denominator: 6 },
    medium: { min: 10, max: 99, factor: 12, denominator: 12 },
    hard: { min: 100, max: 999, factor: 25, denominator: 20 },
  };
  const range = ranges[state.difficulty];
  let left;
  let right;
  let symbol;
  let answer;

  if (operation === "addition") {
    left = randomInteger(range.min, range.max);
    right = randomInteger(range.min, range.max);
    symbol = "+";
    answer = rational(left + right);
  } else if (operation === "subtraction") {
    left = randomInteger(range.min, range.max);
    right = randomInteger(range.min, range.max);
    if (state.difficulty !== "hard" && right > left) [left, right] = [right, left];
    symbol = "−";
    answer = rational(left - right);
  } else if (operation === "multiplication") {
    left = randomInteger(2, range.factor);
    right = randomInteger(2, range.factor);
    symbol = "×";
    answer = rational(left * right);
  } else if (operation === "division") {
    right = randomInteger(2, range.factor);
    const quotient = randomInteger(2, range.factor);
    left = right * quotient;
    symbol = "÷";
    answer = rational(quotient);
  } else {
    const denominatorA = randomInteger(2, range.denominator);
    const denominatorB = state.difficulty === "easy"
      ? denominatorA
      : randomInteger(2, range.denominator);
    let numeratorA = randomInteger(1, denominatorA - 1);
    let numeratorB = randomInteger(1, denominatorB - 1);
    symbol = choose(["+", "−"]);

    if (
      symbol === "−"
      && state.difficulty !== "hard"
      && numeratorA / denominatorA < numeratorB / denominatorB
    ) {
      [numeratorA, numeratorB] = [numeratorB, numeratorA];
      [left, right] = [
        { numerator: numeratorA, denominator: denominatorB },
        { numerator: numeratorB, denominator: denominatorA },
      ];
    } else {
      left = { numerator: numeratorA, denominator: denominatorA };
      right = { numerator: numeratorB, denominator: denominatorB };
    }

    if (!left || !right) {
      left = { numerator: numeratorA, denominator: denominatorA };
      right = { numerator: numeratorB, denominator: denominatorB };
    }

    answer = symbol === "+"
      ? rational(
          left.numerator * right.denominator + right.numerator * left.denominator,
          left.denominator * right.denominator,
        )
      : rational(
          left.numerator * right.denominator - right.numerator * left.denominator,
          left.denominator * right.denominator,
        );
  }

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    operation,
    left,
    right,
    symbol,
    answer,
  };
}

function renderOperand(value) {
  if (typeof value !== "object") return `<span>${escapeHtml(value)}</span>`;
  return `<span class="fraction" aria-label="${value.numerator} over ${value.denominator}">
    <span>${value.numerator}</span><span>${value.denominator}</span>
  </span>`;
}

function problemText(problem) {
  const left = typeof problem.left === "object"
    ? `${problem.left.numerator}/${problem.left.denominator}`
    : String(problem.left);
  const right = typeof problem.right === "object"
    ? `${problem.right.numerator}/${problem.right.denominator}`
    : String(problem.right);
  return `${left} ${problem.symbol} ${right}`;
}

function parseAnswer(raw) {
  const input = raw.trim().replace(/\s+/g, " ");
  if (!input) return null;

  const mixed = input.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (!denominator) return null;
    const sign = whole < 0 ? -1 : 1;
    return whole + sign * (numerator / denominator);
  }

  if (input.includes("/")) {
    const parts = input.split("/");
    if (parts.length !== 2) return null;
    const numerator = Number(parts[0]);
    const denominator = Number(parts[1]);
    return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
      ? numerator / denominator
      : null;
  }

  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function formatClock(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function calculateAccuracy() {
  return state.attempted ? Math.round((state.correct / state.attempted) * 100) : 0;
}

function calculateScore() {
  return state.correct * 100 + state.bestStreak * 10 + calculateAccuracy();
}

function formatDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Saved locally";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function optionCard(name, value, label, selected, type = "radio", symbol = "") {
  return `<label class="option-card">
    <input type="${type}" name="${name}" value="${value}" ${selected ? "checked" : ""}>
    ${symbol ? `<span class="option-symbol" aria-hidden="true">${symbol}</span>` : ""}
    <span>${label}</span>
    <span class="check" aria-hidden="true">✓</span>
  </label>`;
}

function renderSetup() {
  stopTimer();
  state.phase = "setup";
  const scores = getScores();
  main.innerHTML = `
    <section class="setup-view" aria-labelledby="pageTitle">
      <section class="intro-panel hidden" style="display:none;">
        <h1 id="pageTitle">Think faster.<br><em>Stay accurate.</em></h1>
        <p class="intro-copy">Random equations, immediate progression, and a focused review when time is up.</p>
        <div class="privacy-pill">
          <span aria-hidden="true">●</span>
          <span><strong>Private and offline.</strong> No account, login, API, tracking, or upload.</span>
        </div>
      </section>

      <section class="setup-card" aria-label="Sprint configuration">
        <div class="setup-card-header hidden">
          <div>
            <p class="step-label">Set your sprint</p>
            <h2>Ready when you are</h2>
          </div>
          <span class="setup-number" aria-hidden="true">01</span>
        </div>

        <div class="settings-group duration-group">
          <div class="group-label">
            <span>Duration</span>
            <small>10 seconds minimum</small>
          </div>
          <div class="duration-control">
            <label>
              <input id="minutesInput" type="number" inputmode="numeric" min="0" max="99" value="${state.minutes}">
              <span>Minutes</span>
            </label>
            <span aria-hidden="true">:</span>
            <label>
              <input id="secondsInput" type="number" inputmode="numeric" min="0" max="59" value="${state.seconds}">
              <span>Seconds</span>
            </label>
          </div>
          <p class="field-error" id="durationError" hidden>Choose a duration of at least 10 seconds.</p>
        </div>

        <div class="settings-group">
          <div class="group-label"><span>Difficulty</span></div>
          <div class="option-row three">
            ${["easy", "medium", "hard"].map((value) =>
              optionCard("difficulty", value, value[0].toUpperCase() + value.slice(1), state.difficulty === value),
            ).join("")}
          </div>
        </div>

        <div class="settings-group">
          <div class="group-label">
            <span>Operations</span>
            <small>Select one or more</small>
          </div>
          <div class="operation-grid">
            ${OPERATIONS.map((operation) =>
              optionCard(
                "operation",
                operation.id,
                operation.label,
                state.operations.includes(operation.id),
                "checkbox",
                operation.symbol,
              ),
            ).join("")}
          </div>
        </div>

        <div class="settings-split">
          <div class="settings-group">
            <div class="group-label"><span>Equation layout</span></div>
            <div class="option-row">
              ${optionCard("layout", "horizontal", "Side by side", state.layout === "horizontal")}
              ${optionCard("layout", "vertical", "Stacked", state.layout === "vertical")}
            </div>
          </div>
          <div class="settings-group">
            <div class="group-label"><span>Player initials</span></div>
            <label class="initials-control">
              <input id="initialsInput" maxlength="3" autocomplete="off" autocapitalize="characters" value="${escapeHtml(state.initials)}" placeholder="ABC">
              <span>1–3 letters or numbers</span>
            </label>
            <p class="field-error" id="initialsError" hidden>Enter 1–3 initials.</p>
          </div>
        </div>

        <details class="appearance-settings">
          <summary>Appearance</summary>
          <div class="appearance-grid">
            <fieldset>
              <legend>Visual style</legend>
              <label class="theme-card paper-preview">
                <input type="radio" name="design" value="paper" ${state.design === "paper" ? "checked" : ""}>
                <span class="theme-preview"><span>Aa</span><i></i><i></i></span>
                <span><strong>Paper & Ink</strong><small>Quiet and precise</small></span>
                <span class="check">✓</span>
              </label>
              <label class="theme-card tiles-preview">
                <input type="radio" name="design" value="tiles" ${state.design === "tiles" ? "checked" : ""}>
                <span class="theme-preview"><span>±</span><i></i><i></i></span>
                <span><strong>Spatial Tiles</strong><small>Bright and playful</small></span>
                <span class="check">✓</span>
              </label>
            </fieldset>
            <fieldset>
              <legend>Color scheme</legend>
              <div class="option-row three compact">
                ${optionCard("color", "system", "System", state.color === "system")}
                ${optionCard("color", "day", "Day", state.color === "day")}
                ${optionCard("color", "night", "Night", state.color === "night")}
              </div>
            </fieldset>
          </div>
        </details>

        <div class="start-row">
          <button class="primary-button" id="startButton" type="button">
            <span aria-hidden="true">▶</span> Start sprint
          </button>
          <button class="quiet-button" id="clearButton" type="button">Reset / clear local data</button>
        </div>
      </section>

      <section class="scoreboard" aria-labelledby="scoreboardTitle">
        <div class="section-heading">
          <div>
            <p class="step-label">Local records</p>
            <h2 id="scoreboardTitle">Top three</h2>
          </div>
          <span class="trophy" aria-hidden="true">★</span>
        </div>
        <ol class="score-list">
          ${[0, 1, 2].map((index) => {
            const score = scores[index];
            return `<li>
              <span class="rank">${index + 1}</span>
              <strong>${score ? escapeHtml(score.initials) : "—"}</strong>
              <span class="score-value">${score ? Number(score.score).toLocaleString() : "—"}</span>
              <time>${score ? escapeHtml(formatDate(score.timestamp)) : "No score yet"}</time>
            </li>`;
          }).join("")}
        </ol>
      </section>
    </section>`;

  bindSetupEvents();
  main.focus({ preventScroll: true });
}

function bindSetupEvents() {
  const minutesInput = document.querySelector("#minutesInput");
  const secondsInput = document.querySelector("#secondsInput");
  const initialsInput = document.querySelector("#initialsInput");

  minutesInput.addEventListener("input", () => {
    state.minutes = clampInteger(minutesInput.value, 0, 99);
    saveSettings();
  });
  secondsInput.addEventListener("input", () => {
    state.seconds = clampInteger(secondsInput.value, 0, 59);
    saveSettings();
  });
  initialsInput.addEventListener("input", () => {
    state.initials = initialsInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    initialsInput.value = state.initials;
    saveSettings();
  });

  document.querySelectorAll('input[name="difficulty"], input[name="layout"]').forEach((input) => {
    input.addEventListener("change", () => {
      state[input.name] = input.value;
      saveSettings();
    });
  });

  document.querySelectorAll('input[name="design"], input[name="color"]').forEach((input) => {
    input.addEventListener("change", () => {
      state[input.name] = input.value;
      applyAppearance();
      saveSettings();
    });
  });

  document.querySelectorAll('input[name="operation"]').forEach((input) => {
    input.addEventListener("change", () => {
      const selected = [...document.querySelectorAll('input[name="operation"]:checked')]
        .map((element) => element.value);
      if (!selected.length) {
        input.checked = true;
        announce("Keep at least one operation selected.");
        showToast("Choose at least one operation.");
        return;
      }
      state.operations = selected;
      saveSettings();
    });
  });

  document.querySelector("#startButton").addEventListener("click", startSession);
  document.querySelector("#clearButton").addEventListener("click", confirmClearAll);
}

function startSession() {
  const durationSeconds = state.minutes * 60 + state.seconds;
  const durationError = document.querySelector("#durationError");
  const initialsError = document.querySelector("#initialsError");
  const validDuration = durationSeconds >= 10;
  const validInitials = /^[A-Z0-9]{1,3}$/.test(state.initials);
  durationError.hidden = validDuration;
  initialsError.hidden = validInitials;

  if (!validDuration) {
    document.querySelector("#minutesInput").focus();
    return;
  }
  if (!validInitials) {
    document.querySelector("#initialsInput").focus();
    return;
  }

  state.phase = "playing";
  state.durationMs = durationSeconds * 1000;
  state.remainingMs = state.durationMs;
  state.correct = 0;
  state.attempted = 0;
  state.streak = 0;
  state.bestStreak = 0;
  state.mistakes = [];
  state.endedEarly = false;
  state.currentProblem = makeProblem();
  saveSettings();
  renderPlay();
  startTimer();
}

function startTimer() {
  stopTimer();
  state.lastTick = performance.now();
  state.timerId = window.setInterval(tickTimer, 100);
}

function stopTimer() {
  if (state.timerId !== null) {
    window.clearInterval(state.timerId);
    state.timerId = null;
  }
}

function tickTimer() {
  if (state.phase !== "playing") return;
  const now = performance.now();
  state.remainingMs = Math.max(0, state.remainingMs - (now - state.lastTick));
  state.lastTick = now;
  const clock = document.querySelector("#clock");
  if (clock) clock.textContent = formatClock(state.remainingMs);
  if (state.remainingMs <= 0) finishSession(false);
}

function renderPlay() {
  const problem = state.currentProblem;
  const accuracy = calculateAccuracy();
  main.innerHTML = `
    <section class="play-view" aria-labelledby="problemLabel">
      <div class="play-stats" aria-label="Current sprint statistics">
        <div class="time-stat"><span>Time</span><strong id="clock">${formatClock(state.remainingMs)}</strong></div>
        <div><span>Score</span><strong>${calculateScore().toLocaleString()}</strong></div>
        <div><span>Correct</span><strong>${state.correct}</strong></div>
        <div><span>Accuracy</span><strong>${accuracy}%</strong></div>
      </div>

      <section class="problem-panel">
        <div class="problem-heading hidden">
          <div>
            <p class="step-label">Question ${state.attempted + 1}</p>
            <h1 id="problemLabel">Solve, enter, keep moving.</h1>
          </div>
          <span class="streak-badge">Streak <strong>${state.streak}</strong></span>
        </div>

        <div class="equation equation-${state.layout}" aria-label="${escapeHtml(problemText(problem))}">
          <span class="operand operand-top">${renderOperand(problem.left)}</span>
          <span class="operator" aria-hidden="true">${problem.symbol}</span>
          <span class="operand operand-bottom">${renderOperand(problem.right)}</span>
          <span class="equals" aria-hidden="true">=</span>
        </div>

        <form class="answer-form" id="answerForm">
          <label for="answerInput">Your answer</label>
          <div>
            <input id="answerInput" inputmode="decimal" enterkeyhint="done" autocomplete="off" placeholder="${problem.operation === "fractions" ? "e.g. 3/4 or 0.75" : "Type answer"}">
            <button class="primary-button" type="submit">Enter <span aria-hidden="true">↵</span></button>
          </div>
          <p>${problem.operation === "fractions"
            ? "Fractions, mixed numbers, and decimals are accepted."
            : ""}</p>
        </form>
      </section>

      <div class="session-actions">
        <button class="secondary-button" id="pauseButton" type="button">Ⅱ <span>Pause</span></button>
        <button class="danger-button" id="endButton" type="button">■ <span>Quit / End</span></button>
      </div>
    </section>`;

  document.querySelector("#answerForm").addEventListener("submit", submitAnswer);
  document.querySelector("#pauseButton").addEventListener("click", pauseSession);
  document.querySelector("#endButton").addEventListener("click", confirmEndSession);
  document.querySelector("#answerInput").focus();
}

function submitAnswer(event) {
  event.preventDefault();
  if (state.phase !== "playing") return;

  const answerInput = document.querySelector("#answerInput");
  const rawAnswer = answerInput.value.trim();
  if (!rawAnswer) {
    showToast("Enter an answer first.");
    answerInput.focus();
    return;
  }

  const parsedAnswer = parseAnswer(rawAnswer);
  const expectedAnswer = rationalValue(state.currentProblem.answer);
  const correct = parsedAnswer !== null && Math.abs(parsedAnswer - expectedAnswer) < 1e-9;
  state.attempted += 1;

  if (correct) {
    state.correct += 1;
    state.streak += 1;
    state.bestStreak = Math.max(state.bestStreak, state.streak);
    announce("Correct. Next equation.");
  } else {
    state.mistakes.push({
      equation: problemText(state.currentProblem),
      given: rawAnswer,
      correct: rationalText(state.currentProblem.answer),
    });
    state.streak = 0;
    announce(`Incorrect. Correct answer: ${rationalText(state.currentProblem.answer)}. Next equation.`);
  }

  state.currentProblem = makeProblem();
  renderPlay();
}

function pauseSession() {
  if (state.phase !== "playing") return;
  tickTimer();
  if (state.phase !== "playing") return;
  state.phase = "paused";
  stopTimer();
  overlay.innerHTML = `
    <div class="modal-backdrop">
      <section class="pause-card" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">
        <span class="pause-icon" aria-hidden="true">Ⅱ</span>
        <p class="step-label">Timer stopped</p>
        <h2 id="pauseTitle">Sprint paused</h2>
        <p>Your current equation and progress are safe on this device.</p>
        <button class="primary-button" id="resumeButton" type="button">Resume sprint</button>
        <button class="quiet-button" id="pauseEndButton" type="button">End session</button>
      </section>
    </div>`;
  document.querySelector("#resumeButton").addEventListener("click", resumeSession);
  document.querySelector("#pauseEndButton").addEventListener("click", () => finishSession(true));
  document.querySelector("#resumeButton").focus();
}

function resumeSession() {
  if (state.phase !== "paused") return;
  overlay.innerHTML = "";
  state.phase = "playing";
  startTimer();
  document.querySelector("#answerInput")?.focus();
  announce("Sprint resumed.");
}

function confirmEndSession() {
  showConfirm(
    "End this sprint?",
    "Your current result and missed equations will still be available for review, but an early result will not enter the top scores.",
    "End sprint",
    () => finishSession(true),
  );
}

function finishSession(endedEarly) {
  if (!["playing", "paused"].includes(state.phase)) return;
  if (state.phase === "playing") {
    const now = performance.now();
    state.remainingMs = Math.max(0, state.remainingMs - (now - state.lastTick));
    state.lastTick = now;
  }
  state.phase = "results";
  stopTimer();
  state.endedEarly = endedEarly;
  overlay.innerHTML = "";
  const madeTopThree = saveCompletedScore();
  renderResults(madeTopThree);
}

function renderResults(madeTopThree) {
  const accuracy = calculateAccuracy();
  const score = calculateScore();
  liveRegion.textContent = "";
  main.innerHTML = `
    <section class="results-view" aria-labelledby="resultsTitle">
      <section class="results-hero">
        <div>
          <p class="kicker">${state.endedEarly ? "Sprint ended" : "Time is up"}</p>
          <h1 id="resultsTitle">${score.toLocaleString()} <span>points</span></h1>
          <p>${state.endedEarly
            ? "Your result was not added to the top scores."
            : madeTopThree
              ? "New top-three result — saved automatically on this device."
              : "Result saved locally. Keep moving faster to reach the top three."}</p>
        </div>
        <div class="result-badge" aria-hidden="true">${accuracy}%<small>accuracy</small></div>
      </section>

      <section class="result-metrics" aria-label="Session results">
        <div><span>Correct</span><strong>${state.correct}</strong></div>
        <div><span>Attempted</span><strong>${state.attempted}</strong></div>
        <div><span>Best streak</span><strong>${state.bestStreak}</strong></div>
        <div><span>Mistakes</span><strong>${state.mistakes.length}</strong></div>
      </section>

      <section class="review-card">
        <div class="section-heading">
          <div>
            <p class="step-label">Optional review</p>
            <h2>Incorrect answers</h2>
          </div>
          <span>${state.mistakes.length}</span>
        </div>
        ${state.mistakes.length
          ? `<div class="review-table-wrap">
              <table>
                <thead><tr><th>Equation</th><th>Your answer</th><th>Correct answer</th></tr></thead>
                <tbody>${state.mistakes.map((mistake) => `
                  <tr>
                    <td>${escapeHtml(mistake.equation)}</td>
                    <td>${escapeHtml(mistake.given)}</td>
                    <td>${escapeHtml(mistake.correct)}</td>
                  </tr>`).join("")}</tbody>
              </table>
            </div>`
          : `<div class="perfect-result"><span aria-hidden="true">✓</span><p><strong>Clean sprint.</strong><br>Nothing to review.</p></div>`}
      </section>

      <div class="result-actions">
        <button class="primary-button" id="againButton" type="button">New sprint</button>
        <button class="secondary-button" id="sameButton" type="button">Repeat settings</button>
        <button class="quiet-button" id="resultClearButton" type="button">Reset / clear local data</button>
      </div>
    </section>`;

  document.querySelector("#againButton").addEventListener("click", renderSetup);
  document.querySelector("#sameButton").addEventListener("click", startSession);
  document.querySelector("#resultClearButton").addEventListener("click", confirmClearAll);
  main.focus({ preventScroll: true });
}

function showConfirm(title, message, actionLabel, onConfirm) {
  overlay.innerHTML = `
    <div class="modal-backdrop">
      <section class="confirm-card" role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
        <p class="step-label">Please confirm</p>
        <h2 id="confirmTitle">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div>
          <button class="danger-button" id="confirmAction" type="button">${escapeHtml(actionLabel)}</button>
          <button class="secondary-button" id="cancelAction" type="button">Cancel</button>
        </div>
      </section>
    </div>`;
  const close = () => {
    overlay.innerHTML = "";
  };
  document.querySelector("#confirmAction").addEventListener("click", () => {
    close();
    onConfirm();
  });
  document.querySelector("#cancelAction").addEventListener("click", close);
  document.querySelector("#cancelAction").focus();
}

function confirmClearAll() {
  showConfirm(
    "Clear saved data?",
    "This removes local settings and all top scores from this device. It cannot be undone.",
    "Clear everything",
    () => {
      try {
        localStorage.removeItem(SETTINGS_KEY);
        localStorage.removeItem(SCORES_KEY);
      } catch {
        // The in-memory reset remains useful when storage is unavailable.
      }
      Object.assign(state, {
        ...DEFAULT_SETTINGS,
        operations: [...DEFAULT_SETTINGS.operations],
        phase: "setup",
      });
      applyAppearance();
      renderSetup();
      showToast("Local settings and scores cleared.");
    },
  );
}

function showHelp() {
  if (state.phase !== "playing") return;
  tickTimer();
  if (state.phase !== "playing") return;
  state.phase = "paused";
  stopTimer();
  overlay.innerHTML = `
    <div class="modal-backdrop">
      <section class="help-card" role="dialog" aria-modal="true" aria-labelledby="helpTitle">
        <button class="modal-close" id="closeHelp" type="button" aria-label="Close help">×</button>
        <p class="step-label">How it works</p>
        <h2 id="helpTitle">Fast first. Accurate second.</h2>
        <ol>
          <li><span>1</span><p><strong>Set the sprint.</strong> Choose time, difficulty, operations, and layout.</p></li>
          <li><span>2</span><p><strong>Keep moving.</strong> Every submitted answer immediately opens a new random equation.</p></li>
          <li><span>3</span><p><strong>Review afterward.</strong> Incorrect answers appear with the correct solutions.</p></li>
        </ol>
        <div class="offline-note">
          <strong>Private by design</strong>
          <p>No login, account, external API, analytics, upload, or cloud database. Settings and scores stay in this browser.</p>
        </div>
        <h3>Install for offline use</h3>
        <p>Use your browser’s “Install app” or “Add to Home Screen” command. Once the app has loaded successfully, it remains available offline.</p>
        <button class="primary-button" id="doneHelp" type="button">Got it</button>
      </section>
    </div>`;
  const close = () => {
    overlay.innerHTML = "";
    resumeSession();
  };
  document.querySelector("#closeHelp").addEventListener("click", close);
  document.querySelector("#doneHelp").addEventListener("click", close);
  document.querySelector("#doneHelp").focus();
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timeoutId);
  showToast.timeoutId = window.setTimeout(() => {
    toast.hidden = true;
  }, 2800);
}

function announce(message) {
  liveRegion.textContent = "";
  window.setTimeout(() => {
    liveRegion.textContent = message;
  }, 20);
}

function handleHome() {
  if (state.phase === "playing" || state.phase === "paused") {
    showConfirm(
      "Return to setup?",
      "This ends the current sprint. You can still review the result.",
      "End and return",
      () => finishSession(true),
    );
    return;
  }
  renderSetup();
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  installButton.classList.add("install-ready");
});

window.addEventListener("appinstalled", () => {
  state.installPrompt = null;
  installButton.classList.remove("install-ready");
  showToast("Mental Math Sprint installed.");
});

installButton.addEventListener("click", async () => {
  if (!state.installPrompt) {
    showHelp();
    return;
  }
  state.installPrompt.prompt();
  await state.installPrompt.userChoice;
  state.installPrompt = null;
  installButton.classList.remove("install-ready");
});

helpButton.addEventListener("click", showHelp);
homeButton.addEventListener("click", handleHome);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && overlay.innerHTML) {
    if (state.phase !== "paused") overlay.innerHTML = "";
  }
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`./sw.js?v=${CACHE_BUST_VERSION}`).catch(() => {
      // showToast("Offline installation is unavailable in this browser.");
    });
  });
}

loadSettings();
renderSetup();
