const $ = (id) => document.getElementById(id);

const state = {
  sessionId: null,
  data: null,
  selected: null,
  orientation: "w",
  playerTypes: { w: "engine", b: "engine" },
  promotion: "q",
  defaults: [],
  poll: null
};

const els = {
  board: $("board"),
  statusLine: $("statusLine"),
  turnPill: $("turnPill"),
  themeToggle: $("themeToggle"),
  fenText: $("fenText"),
  copyFen: $("copyFen"),
  whiteHuman: $("whiteHuman"),
  whiteEngine: $("whiteEngine"),
  blackHuman: $("blackHuman"),
  blackEngine: $("blackEngine"),
  gameSetup: $("gameSetup"),
  gameActive: $("gameActive"),
  activeWhiteRole: $("activeWhiteRole"),
  activeBlackRole: $("activeBlackRole"),
  gameSetupBack: $("gameSetupBack"),
  startFen: $("startFen"),
  whiteDepth: $("whiteDepth"),
  whiteMinTime: $("whiteMinTime"),
  whiteMaxTime: $("whiteMaxTime"),
  blackDepth: $("blackDepth"),
  blackMinTime: $("blackMinTime"),
  blackMaxTime: $("blackMaxTime"),
  whitePreset: $("whitePreset"),
  blackPreset: $("blackPreset"),
  whitePath: $("whitePath"),
  blackPath: $("blackPath"),
  whiteBrowse: $("whiteBrowse"),
  blackBrowse: $("blackBrowse"),
  whiteSavePreset: $("whiteSavePreset"),
  blackSavePreset: $("blackSavePreset"),
  whiteRemovePreset: $("whiteRemovePreset"),
  blackRemovePreset: $("blackRemovePreset"),
  engineToggle: $("engineToggle"),
  engineDetails: $("engineDetails"),
  engineSettingsPanel: $("engineSettingsPanel"),
  engineOutputPanel: $("engineOutputPanel"),
  movesPanel: $("movesPanel"),
  whiteEngineSummary: $("whiteEngineSummary"),
  blackEngineSummary: $("blackEngineSummary"),
  newGame: $("newGame"),
  startStop: $("startStop"),
  flipBoard: $("flipBoard"),
  activeFlipBoard: $("activeFlipBoard"),
  promotionPanel: $("promotionPanel"),
  promotionSelect: $("promotionSelect"),
  moveList: $("moveList"),
  copyMoves: $("copyMoves"),
  engineLog: $("engineLog")
};

const PIECE_IMAGES = {
  P: "/pieces/white_pawn.png",
  N: "/pieces/white_knight.png",
  B: "/pieces/white_bishop.png",
  R: "/pieces/white_rook.png",
  Q: "/pieces/white_queen.png",
  K: "/pieces/white_king.png",
  p: "/pieces/black_pawn.png",
  n: "/pieces/black_knight.png",
  b: "/pieces/black_bishop.png",
  r: "/pieces/black_rook.png",
  q: "/pieces/black_queen.png",
  k: "/pieces/black_king.png"
};

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  });
}

function squareName(row, col) {
  const files = "abcdefgh";
  if (state.orientation === "w") return files[col] + String(8 - row);
  return files[7 - col] + String(row + 1);
}

function boardIndexForSquare(square) {
  const idx = ChessCore.squareToIndex(square);
  if (idx < 0) return -1;
  return idx;
}

function pieceForSquare(square) {
  if (!state.data) return "";
  return state.data.board[boardIndexForSquare(square)] || "";
}

function legalFrom(square) {
  return state.data?.legalMoves.filter((move) => move.from === square) || [];
}

function legalTo(from, to) {
  return state.data?.legalMoves.find((move) => {
    if (move.from !== from || move.to !== to) return false;
    if (!move.promotion) return true;
    return move.promotion === state.promotion;
  });
}

function isHumanTurn() {
  if (!state.data) return false;
  const turn = state.data.turn;
  const player = turn === "w" ? state.data.config.white : state.data.config.black;
  return player.type === "human" && !state.data.status.over;
}

function renderBoard() {
  els.board.innerHTML = "";
  const last = state.data?.moveHistory.at(-1)?.uci || "";
  const lastFrom = last.slice(0, 2);
  const lastTo = last.slice(2, 4);
  const destinations = state.selected ? legalFrom(state.selected) : [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const square = squareName(r, c);
      const piece = pieceForSquare(square);
      const button = document.createElement("button");
      button.className = `square ${(r + c) % 2 === 0 ? "light" : "dark"}`;
      button.dataset.square = square;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", square);
      if (piece) {
        const img = document.createElement("img");
        img.className = "piece-img";
        img.src = PIECE_IMAGES[piece];
        img.alt = "";
        img.draggable = false;
        button.appendChild(img);
      }
      if (state.selected === square) button.classList.add("selected");
      if (square === lastFrom || square === lastTo) button.classList.add("last");
      const targetMove = destinations.find((move) => move.to === square);
      if (targetMove) button.classList.add(targetMove.capture ? "capture" : "legal");
      button.addEventListener("click", () => onSquare(square));
      els.board.appendChild(button);
    }
  }
}

async function onSquare(square) {
  if (!state.data || !isHumanTurn()) return;
  const piece = pieceForSquare(square);
  const pieceColor = piece && piece === piece.toUpperCase() ? "w" : "b";
  if (state.selected) {
    const move = legalTo(state.selected, square);
    if (move) {
      await submitMove(move);
      return;
    }
  }
  if (piece && pieceColor === state.data.turn && legalFrom(square).length) {
    state.selected = square;
  } else {
    state.selected = null;
  }
  renderBoard();
}

async function submitMove(move) {
  try {
    state.selected = null;
    const data = await api(`/api/session/${state.sessionId}/move`, {
      method: "POST",
      body: JSON.stringify({
        from: move.from,
        to: move.to,
        promotion: move.promotion || ""
      })
    });
    updateState(data);
  } catch (err) {
    showError(err.message);
  }
}

function updateState(data) {
  state.data = data;
  els.fenText.textContent = data.fen || "-";
  const turnName = data.turn === "w" ? "White" : "Black";
  let status = `${turnName} to move`;
  if (data.thinking) status = `${data.thinking === "w" ? "White" : "Black"} engine thinking`;
  if (data.status?.reason === "check") status += " in check";
  if (data.status?.over) {
    status = data.status.winner
      ? `${data.status.winner === "w" ? "White" : "Black"} wins by ${data.status.reason}`
      : `Draw by ${data.status.reason}`;
  }
  if (data.error) status = `Error: ${data.error}`;
  els.statusLine.textContent = status;
  els.turnPill.textContent = data.running ? (data.thinking ? "Thinking" : "Running") : "Stopped";
  els.startStop.textContent = data.status?.over ? "New Game" : data.running ? "Pause" : "Resume";
  renderGamePanel();
  renderMoves();
  renderLog();
  renderBoard();
}

function renderGamePanel() {
  const active = !!state.sessionId;
  els.gameSetup.hidden = active;
  els.gameActive.hidden = !active;
  els.engineSettingsPanel.hidden = active;
  els.movesPanel.hidden = !active;
  els.engineOutputPanel.hidden = !active;
  els.promotionPanel.hidden = !shouldShowPromotionPanel(active);
  if (!active) return;

  els.activeWhiteRole.textContent = playerRoleText(state.data.config.white);
  els.activeBlackRole.textContent = playerRoleText(state.data.config.black);
  els.gameSetupBack.hidden = !!state.data?.running && !state.data?.status?.over;
}

function shouldShowPromotionPanel(active) {
  if (!active || !state.data?.running || state.data.status?.over) return false;
  const { white, black } = state.data.config || {};
  return white?.type === "human" || black?.type === "human";
}

function playerRoleText(player) {
  if (!player) return "-";
  if (player.type === "human") return "Human";
  const preset = state.defaults.find((engine) => engine.path === player.path);
  return preset ? preset.name : engineNameFromPath(player.path);
}

function renderMoves() {
  els.moveList.innerHTML = "";
  const history = state.data?.moveHistory || [];
  for (let i = 0; i < history.length; i += 2) {
    const row = document.createElement("div");
    row.className = "move-row";

    const whiteNumber = document.createElement("span");
    whiteNumber.className = "move-number";
    whiteNumber.textContent = `${i + 1}.`;

    const white = document.createElement("span");
    white.className = "move-uci";
    white.textContent = history[i]?.uci || "";

    const blackNumber = document.createElement("span");
    blackNumber.className = "move-number";
    blackNumber.textContent = history[i + 1] ? `${i + 2}.` : "";

    const black = document.createElement("span");
    black.className = "move-uci";
    black.textContent = history[i + 1]?.uci || "";

    row.append(whiteNumber, white, blackNumber, black);
    els.moveList.appendChild(row);
  }
  followLatestMove();
}

function followLatestMove() {
  const scrollToBottom = () => {
    els.moveList.scrollTop = els.moveList.scrollHeight;
  };
  requestAnimationFrame(() => {
    scrollToBottom();
    setTimeout(scrollToBottom, 0);
  });
}

function formatMovesForClipboard() {
  const history = state.data?.moveHistory || [];
  const lines = [];
  for (let i = 0; i < history.length; i += 2) {
    const white = history[i] ? `${i + 1}. ${history[i].uci}` : "";
    const black = history[i + 1] ? `${i + 2}. ${history[i + 1].uci}` : "";
    lines.push([white, black].filter(Boolean).join("  "));
  }
  return lines.join("\n");
}

async function copyText(text, button, fallbackLabel) {
  const value = String(text || "").trim();
  if (!value || value === "-") {
    showCopyState(button, "Empty", fallbackLabel);
    return;
  }
  try {
    fallbackCopy(value);
    showCopyState(button, "Copied", fallbackLabel);
    return;
  } catch (fallbackErr) {
    // Try the async Clipboard API next; some browsers disallow execCommand.
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
    } else {
      throw new Error("Clipboard API unavailable");
    }
    showCopyState(button, "Copied", fallbackLabel);
  } catch (err) {
    showCopyState(button, "Failed", fallbackLabel);
  }
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.width = "1px";
  textarea.style.height = "1px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Copy failed");
}

function showCopyState(button, label, fallbackLabel) {
  const isIconButton = button.classList.contains("icon-button");
  if (isIconButton) {
    button.dataset.state = label.toLowerCase();
    button.setAttribute("aria-label", label);
    button.title = label;
  } else {
    button.textContent = label;
  }
  clearTimeout(button.copyTimer);
  button.copyTimer = setTimeout(() => {
    if (isIconButton) {
      button.dataset.state = "";
      button.setAttribute("aria-label", fallbackLabel);
      button.title = fallbackLabel;
    } else {
      button.textContent = fallbackLabel;
    }
  }, 1100);
}

function renderLog() {
  const history = state.data?.moveHistory || [];
  const whiteMove = latestEngineMove(history, "w");
  const blackMove = latestEngineMove(history, "b");
  const lines = [];

  appendEngineOutput(lines, "w", whiteMove);
  appendEngineOutput(lines, "b", blackMove);

  if (lines.length) {
    els.engineLog.textContent = lines.join("\n");
    return;
  }

  if (state.data?.thinking) {
    els.engineLog.textContent = `${state.data.thinking === "w" ? "White" : "Black"} engine thinking...`;
    return;
  }

  els.engineLog.textContent = "No engine move yet";
}

function latestEngineMove(history, color) {
  return [...history].reverse().find((move) => move.color === color && move.stats);
}

function appendEngineOutput(lines, colorCode, move) {
  const color = colorCode === "w" ? "White" : "Black";
  const player = colorCode === "w" ? state.data?.config?.white : state.data?.config?.black;
  if (player?.type !== "engine") return;

  if (move) {
    lines.push(`${formatEngineOutputLabel(color, player, move.engine)} ${move.uci}`);
    lines.push(formatEngineStats(move.stats));
    return;
  }

  if (state.data?.thinking === colorCode) {
    lines.push(`${formatEngineOutputLabel(color, player)} thinking...`);
    lines.push("time - | depth -");
  }
}

function formatEngineOutputLabel(color, player, fallback) {
  const name = playerRoleText(player);
  if (name && name !== "Custom engine") return `${color} ${name}`;
  return formatEngineLabel(color, fallback);
}

function formatEngineLabel(color, label) {
  const engineLabel = label || "engine";
  return engineLabel.toLowerCase().startsWith(color.toLowerCase())
    ? engineLabel
    : `${color} ${engineLabel}`;
}

function formatEngineStats(stats) {
  if (!stats) return "time - | depth -";
  const fields = [];
  fields.push(`time ${formatMs(stats.elapsedMs)}`);
  fields.push(`depth ${formatValue(stats.depth)}`);
  if (stats.nodes !== null && stats.nodes !== undefined) fields.push(`nodes ${formatCompact(stats.nodes)}`);
  if (stats.score && Number.isFinite(stats.score.value)) fields.push(`score ${formatScore(stats.score)}`);
  if (stats.pv?.length) fields.push(`pv ${stats.pv.slice(0, 4).join(" ")}`);
  return fields.join(" | ");
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)}ms` : "-";
}

function formatValue(value) {
  return value === null || value === undefined ? "-" : String(value);
}

function formatCompact(value) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  return String(value);
}

function formatScore(score) {
  if (score.type === "mate") return `mate ${score.value}`;
  if (score.type === "cp") return `${score.value}cp`;
  return `${score.type} ${score.value}`;
}

function previewStartPosition() {
  const chess = new ChessCore.Chess();
  state.data = {
    ...chess.snapshot(),
    running: false,
    thinking: null,
    error: "",
    config: {
      white: { type: "human", label: "White" },
      black: { type: "human", label: "Black" }
    },
    moveHistory: [],
    log: [],
    lastEngine: null
  };
  renderBoard();
  els.fenText.textContent = state.data.fen;
}

function showError(message) {
  els.statusLine.textContent = `Error: ${message}`;
}

function preferredTheme() {
  try {
    const saved = localStorage.getItem("uciChessTheme");
    if (saved === "dark" || saved === "light") return saved;
  } catch (_) {
    // Storage can be blocked in private browser contexts.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  els.themeToggle.setAttribute("aria-pressed", String(dark));
  els.themeToggle.setAttribute("aria-label", dark ? "Switch to light mode" : "Switch to dark mode");
  els.themeToggle.title = dark ? "Light mode" : "Dark mode";
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("uciChessTheme", next);
  } catch (_) {
    // Ignore storage failures; the toggle still works for this session.
  }
}

function setPlayerType(color, type) {
  state.playerTypes[color] = type === "human" ? "human" : "engine";
  const humanButton = color === "w" ? els.whiteHuman : els.blackHuman;
  const engineButton = color === "w" ? els.whiteEngine : els.blackEngine;
  humanButton.classList.toggle("active", state.playerTypes[color] === "human");
  engineButton.classList.toggle("active", state.playerTypes[color] === "engine");
}

function fillPresets() {
  const options = [`<option value="">Custom path</option>`].concat(
    state.defaults.map((engine, idx) => `<option value="${idx}">${engine.name}</option>`)
  ).join("");
  els.whitePreset.innerHTML = options;
  els.blackPreset.innerHTML = options;
  if (state.defaults[0]) {
    els.whitePreset.value = "0";
    els.whitePath.value = state.defaults[0].path;
  }
  if (state.defaults[1]) {
    els.blackPreset.value = "1";
    els.blackPath.value = state.defaults[1].path;
  } else if (state.defaults[0]) {
    els.blackPreset.value = "0";
    els.blackPath.value = state.defaults[0].path;
  }
  updateEngineSummary();
}

async function reloadPresets() {
  const data = await api("/api/default-engines");
  state.defaults = data.engines || [];
  fillPresets();
  return state.defaults;
}

function onPreset(select, input) {
  const idx = select.value;
  input.value = idx !== "" && state.defaults[idx] ? state.defaults[idx].path : "";
  updateEngineSummary();
}

async function browseEnginePath(input, select) {
  try {
    const data = await api("/api/pick-engine", { method: "POST", body: "{}" });
    if (!data.path) return;
    input.value = data.path;
    select.value = "";
    updateEngineSummary();
  } catch (err) {
    showError(err.message);
  }
}

async function saveEnginePreset(input, select) {
  const enginePath = input.value.trim();
  if (!enginePath) {
    showError("Enter an engine path before saving a preset.");
    return;
  }
  const suggested = engineNameFromPath(enginePath);
  const name = window.prompt("Preset name", suggested);
  if (!name || !name.trim()) return;
  try {
    const data = await api("/api/engine-presets", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), path: enginePath })
    });
    state.defaults = data.engines || [];
    fillPresets();
    const index = state.defaults.findIndex((engine) => engine.name === name.trim() && engine.path === enginePath);
    if (index >= 0) {
      select.value = String(index);
      input.value = enginePath;
    }
    updateEngineSummary();
  } catch (err) {
    showError(err.message);
  }
}

async function removeEnginePreset(select, input) {
  const idx = select.value;
  if (idx === "" || !state.defaults[idx]) return;
  const preset = state.defaults[idx];
  if (!window.confirm(`Remove preset "${preset.name}"?`)) return;
  try {
    const data = await api(`/api/engine-presets/${idx}`, { method: "DELETE" });
    state.defaults = data.engines || [];
    fillPresets();
    select.value = "";
    input.value = "";
    updateEngineSummary();
  } catch (err) {
    showError(err.message);
  }
}

function engineSummary(select, input) {
  const idx = select.value;
  if (idx !== "" && state.defaults[idx]) return state.defaults[idx].name;
  return engineNameFromPath(input.value.trim());
}

function engineNameFromPath(path) {
  if (!path) return "Custom engine";
  return path.split("/").filter(Boolean).at(-1) || path;
}

function updateEngineSummary() {
  els.whiteEngineSummary.textContent = engineSummary(els.whitePreset, els.whitePath);
  els.blackEngineSummary.textContent = engineSummary(els.blackPreset, els.blackPath);
}

function toggleEngineDetails() {
  const expanded = els.engineToggle.getAttribute("aria-expanded") === "true";
  const next = !expanded;
  els.engineToggle.setAttribute("aria-expanded", String(next));
  els.engineToggle.textContent = next ? "▴" : "▾";
  els.engineToggle.title = next ? "Hide engine settings" : "Show engine settings";
  els.engineDetails.hidden = !next;
}

function sessionConfig() {
  const whiteType = state.playerTypes.w;
  const blackType = state.playerTypes.b;
  return {
    white: {
      type: whiteType,
      path: els.whitePath.value.trim(),
      label: whiteType === "human" ? "White human" : "White engine",
      depth: Number(els.whiteDepth.value || 5),
      minMoveTime: Number(els.whiteMinTime.value || 0),
      maxMoveTime: Number(els.whiteMaxTime.value || 0)
    },
    black: {
      type: blackType,
      path: els.blackPath.value.trim(),
      label: blackType === "human" ? "Black human" : "Black engine",
      depth: Number(els.blackDepth.value || 5),
      minMoveTime: Number(els.blackMinTime.value || 0),
      maxMoveTime: Number(els.blackMaxTime.value || 0)
    },
    startFen: els.startFen.value.trim(),
    autoStart: true
  };
}

async function newGame() {
  try {
    if (state.sessionId) {
      await api(`/api/session/${state.sessionId}/control`, {
        method: "POST",
        body: JSON.stringify({ action: "quit" })
      }).catch(() => {});
    }
    const data = await api("/api/session", {
      method: "POST",
      body: JSON.stringify(sessionConfig())
    });
    state.sessionId = data.id;
    state.selected = null;
    updateState(data);
    startPolling();
  } catch (err) {
    showError(err.message);
  }
}

function startPolling() {
  if (state.poll) clearInterval(state.poll);
  state.poll = setInterval(async () => {
    if (!state.sessionId) return;
    try {
      const data = await api(`/api/session/${state.sessionId}`);
      updateState(data);
    } catch (err) {
      showError(err.message);
    }
  }, 700);
}

async function toggleStartStop() {
  if (!state.sessionId || !state.data) return;
  if (state.data.status?.over) {
    await newGame();
    return;
  }
  const action = state.data.running ? "stop" : "start";
  try {
    const data = await api(`/api/session/${state.sessionId}/control`, {
      method: "POST",
      body: JSON.stringify({ action })
    });
    updateState(data);
  } catch (err) {
    showError(err.message);
  }
}

function showGameSetup() {
  if (state.data?.running && !state.data?.status?.over) return;
  state.sessionId = null;
  state.selected = null;
  if (state.poll) {
    clearInterval(state.poll);
    state.poll = null;
  }
  previewStartPosition();
  els.engineSettingsPanel.hidden = false;
  els.movesPanel.hidden = true;
  els.engineOutputPanel.hidden = true;
  renderGamePanel();
  renderLog();
  renderMoves();
  els.statusLine.textContent = "Choose a mode and start a game.";
}

function flipBoard() {
  state.orientation = state.orientation === "w" ? "b" : "w";
  renderBoard();
}

function bindEvents() {
  els.whiteHuman.addEventListener("click", () => setPlayerType("w", "human"));
  els.whiteEngine.addEventListener("click", () => setPlayerType("w", "engine"));
  els.blackHuman.addEventListener("click", () => setPlayerType("b", "human"));
  els.blackEngine.addEventListener("click", () => setPlayerType("b", "engine"));
  els.themeToggle.addEventListener("click", toggleTheme);
  els.whitePreset.addEventListener("change", () => onPreset(els.whitePreset, els.whitePath));
  els.blackPreset.addEventListener("change", () => onPreset(els.blackPreset, els.blackPath));
  els.whiteBrowse.addEventListener("click", () => browseEnginePath(els.whitePath, els.whitePreset));
  els.blackBrowse.addEventListener("click", () => browseEnginePath(els.blackPath, els.blackPreset));
  els.whiteSavePreset.addEventListener("click", () => saveEnginePreset(els.whitePath, els.whitePreset));
  els.blackSavePreset.addEventListener("click", () => saveEnginePreset(els.blackPath, els.blackPreset));
  els.whiteRemovePreset.addEventListener("click", () => removeEnginePreset(els.whitePreset, els.whitePath));
  els.blackRemovePreset.addEventListener("click", () => removeEnginePreset(els.blackPreset, els.blackPath));
  els.whitePath.addEventListener("input", updateEngineSummary);
  els.blackPath.addEventListener("input", updateEngineSummary);
  els.engineToggle.addEventListener("click", toggleEngineDetails);
  els.newGame.addEventListener("click", newGame);
  els.startStop.addEventListener("click", toggleStartStop);
  els.gameSetupBack.addEventListener("click", showGameSetup);
  els.flipBoard.addEventListener("click", flipBoard);
  els.activeFlipBoard.addEventListener("click", flipBoard);
  els.copyFen.addEventListener("click", () => copyText(els.fenText.textContent, els.copyFen, "Copy FEN"));
  els.copyMoves.addEventListener("click", () => copyText(formatMovesForClipboard(), els.copyMoves, "Copy moves"));
  els.promotionSelect.querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.promotion = button.dataset.promotion;
      els.promotionSelect.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
      renderBoard();
    });
  });
}

async function init() {
  applyTheme(preferredTheme());
  bindEvents();
  setPlayerType("w", "engine");
  setPlayerType("b", "engine");
  previewStartPosition();
  renderGamePanel();
  try {
    await reloadPresets();
    els.statusLine.textContent = state.defaults.length
      ? "Choose a mode and start a game."
      : "Enter a UCI engine path to start.";
  } catch (err) {
    showError(err.message);
  }
}

init();
