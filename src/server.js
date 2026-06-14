const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { URL } = require("url");
const { Chess, START_FEN } = require("./chess");
const { UciEngine } = require("./uci-engine");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const ENGINE_CONFIG = path.join(ROOT, "config", "engines.json");
const PORT = Number(process.env.PORT || 5174);
const HOST = process.env.HOST || "127.0.0.1";
const DEFAULT_ENGINE_PRESETS = [{ name: "Stockfish", path: "./stockfish/uci.exe" }];

const sessions = new Map();

function expandPath(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text === "~") return process.env.HOME || text;
  if (text.startsWith("~/")) return path.join(process.env.HOME || "", text.slice(2));
  return text;
}

function resolveEnginePath(value) {
  const expanded = expandPath(value);
  if (!expanded || path.isAbsolute(expanded)) return expanded;
  return path.resolve(ROOT, expanded);
}

function normalizeEnginePresets(entries) {
  return entries
    .map((engine) => ({
      name: String(engine.name || "").trim(),
      path: String(engine.path || "").trim()
    }))
    .filter((engine) => engine.name && engine.path);
}

function saveEnginePresets(engines) {
  fs.mkdirSync(path.dirname(ENGINE_CONFIG), { recursive: true });
  fs.writeFileSync(ENGINE_CONFIG, JSON.stringify({ engines: normalizeEnginePresets(engines) }, null, 2) + "\n");
}

function loadEnginePresets() {
  try {
    const raw = fs.readFileSync(ENGINE_CONFIG, "utf8");
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : parsed.engines || [];
    return normalizeEnginePresets(entries);
  } catch (err) {
    if (err.code === "ENOENT") {
      saveEnginePresets(DEFAULT_ENGINE_PRESETS);
      return DEFAULT_ENGINE_PRESETS.slice();
    }
    console.warn(`Could not load engine presets from ${ENGINE_CONFIG}: ${err.message}`);
    return DEFAULT_ENGINE_PRESETS.slice();
  }
}

function addEnginePreset(input) {
  const name = String(input.name || "").trim();
  const enginePath = String(input.path || "").trim();
  if (!name || !enginePath) throw new Error("Preset name and path are required");
  const presets = loadEnginePresets();
  presets.push({ name, path: enginePath });
  saveEnginePresets(presets);
  return presets;
}

function removeEnginePreset(index) {
  const presets = loadEnginePresets();
  if (!Number.isInteger(index) || index < 0 || index >= presets.length) throw new Error("Preset not found");
  presets.splice(index, 1);
  saveEnginePresets(presets);
  return presets;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  if (pathname === "/chess.js") {
    fs.readFile(path.join(__dirname, "chess.js"), (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end(data);
    });
    return;
  }
  const file = pathname === "/" ? path.join(PUBLIC, "index.html") : path.join(PUBLIC, pathname);
  const resolved = path.resolve(file);
  if (!resolved.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(resolved);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png"
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickEnginePath() {
  if (process.platform !== "darwin") throw new Error("Native path picker is only available on macOS");
  const script = 'POSIX path of (choose file with prompt "Choose a UCI engine")';
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script], { timeout: 120_000 }, (err, stdout, stderr) => {
      if (err) {
        const message = `${stderr || err.message}`;
        if (/User canceled/i.test(message)) {
          resolve("");
          return;
        }
        reject(new Error(message.trim() || "Could not open file picker"));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function normalizePlayer(input, color, defaults = {}) {
  const player = input || {};
  const maxMoveTime = player.maxMoveTime ?? player.movetime ?? defaults.maxMoveTime ?? defaults.movetime;
  return {
    color,
    type: player.type === "engine" ? "engine" : "human",
    path: String(player.path || ""),
    label: String(player.label || `${color === "w" ? "White" : "Black"} engine`),
    options: player.options || {},
    depth: clampNumber(player.depth ?? defaults.depth, 6, 1, 30),
    minMoveTime: clampNumber(player.minMoveTime ?? defaults.minMoveTime, 0, 0, 3_600_000),
    maxMoveTime: clampNumber(maxMoveTime, 0, 0, 3_600_000)
  };
}

function publicSession(session) {
  const snapshot = session.chess.snapshot();
  return {
    id: session.id,
    running: session.running,
    thinking: session.thinking,
    error: session.error,
    config: {
      white: redactPlayer(session.players.w),
      black: redactPlayer(session.players.b)
    },
    moveHistory: session.moveHistory,
    clocks: session.clocks,
    lastEngine: session.lastEngine,
    log: session.log.slice(-80),
    ...snapshot
  };
}

function enginePositionCommand(session) {
  const moves = session.moveHistory.map((move) => move.uci).join(" ");
  return moves
    ? `position fen ${session.startFen} moves ${moves}`
    : `position fen ${session.startFen}`;
}

function redactPlayer(player) {
  return {
    color: player.color,
    type: player.type,
    path: player.path,
    label: player.label,
    depth: player.depth,
    minMoveTime: player.minMoveTime,
    maxMoveTime: player.maxMoveTime
  };
}

function pushLog(session, text) {
  const stamp = new Date().toLocaleTimeString();
  session.log.push(`[${stamp}] ${text}`);
  if (session.log.length > 160) session.log.shift();
}

async function buildEngine(session, player) {
  if (player.type !== "engine") return null;
  if (!player.path) throw new Error(`${player.color === "w" ? "White" : "Black"} engine path is empty`);
  const engine = new UciEngine(resolveEnginePath(player.path), player.label);
  engine.on("line", (line) => {
    if (line.startsWith("info ")) session.lastEngine = { color: player.color, line };
  });
  engine.on("stderr", (chunk) => pushLog(session, `${player.label} stderr: ${chunk.trim()}`));
  await engine.start();
  for (const [name, value] of Object.entries(player.options || {})) engine.setOption(name, value);
  engine.newGame();
  await engine.isReady();
  pushLog(session, `${player.label} ready${engine.name ? ` as ${engine.name}` : ""}`);
  return engine;
}

async function createSession(config) {
  const id = crypto.randomUUID();
  const chess = new Chess(config.startFen || START_FEN);
  const session = {
    id,
    chess,
    startFen: chess.toFen(),
    players: {
      w: normalizePlayer(config.white, "w", {
        depth: config.depth,
        minMoveTime: config.minMoveTime,
        maxMoveTime: config.maxMoveTime,
        movetime: config.movetime
      }),
      b: normalizePlayer(config.black, "b", {
        depth: config.depth,
        minMoveTime: config.minMoveTime,
        maxMoveTime: config.maxMoveTime,
        movetime: config.movetime
      })
    },
    engines: {},
    moveHistory: [],
    running: false,
    thinking: null,
    error: "",
    log: [],
    lastEngine: null,
    clocks: { startedAt: Date.now() },
    turnToken: 0
  };
  sessions.set(id, session);
  try {
    session.engines.w = await buildEngine(session, session.players.w);
    session.engines.b = await buildEngine(session, session.players.b);
    session.running = !!config.autoStart;
    pushLog(session, "Game created");
    if (session.running) scheduleEngineTurn(session);
  } catch (err) {
    session.error = err.message;
    pushLog(session, "Error: " + err.message);
  }
  return session;
}

function scheduleEngineTurn(session) {
  const status = session.chess.status();
  if (!session.running || status.over) return;
  const color = session.chess.turn;
  const player = session.players[color];
  if (!player || player.type !== "engine") return;
  const token = ++session.turnToken;
  setTimeout(() => runEngineTurn(session, color, token), 80);
}

async function runEngineTurn(session, color, token) {
  if (!session.running || session.chess.turn !== color || token !== session.turnToken) return;
  const engine = session.engines[color];
  if (!engine) {
    session.error = "Engine is not running";
    session.running = false;
    return;
  }
  session.thinking = color;
  const fen = session.chess.toFen();
  const player = session.players[color];
  const label = player.label;
  const searchStartedAt = Date.now();
  pushLog(session, `${label} thinking from ${fen}`);
  try {
    const result = await engine.search({
      fen,
      position: enginePositionCommand(session),
      depth: player.depth,
      movetime: player.maxMoveTime
    });
    const remainingDelay = player.minMoveTime - (Date.now() - searchStartedAt);
    if (remainingDelay > 0) await delay(remainingDelay);
    session.thinking = null;
    if (!session.running || token !== session.turnToken || session.chess.turn !== color) return;
    if (!result.bestmove || result.bestmove === "(none)") {
      session.running = false;
      pushLog(session, `${label} returned no move`);
      return;
    }
    const move = session.chess.applyUci(result.bestmove);
    session.moveHistory.push({
      ply: session.moveHistory.length + 1,
      color,
      uci: result.bestmove,
      fen: session.chess.toFen(),
      info: result.info.slice(-8),
      stats: result.stats,
      engine: label
    });
    pushLog(session, formatMoveLog(label, result.bestmove, result.stats));
    const status = session.chess.status();
    if (status.over) {
      session.running = false;
      pushLog(session, `Game over: ${status.reason}`);
    } else {
      scheduleEngineTurn(session);
    }
    return move;
  } catch (err) {
    session.thinking = null;
    session.error = err.message;
    session.running = false;
    pushLog(session, "Error: " + err.message);
  }
}

function formatMoveLog(label, move, stats) {
  const parts = [`${label} played ${move}`];
  if (stats) {
    if (Number.isFinite(stats.elapsedMs)) parts.push(`time=${stats.elapsedMs}ms`);
    if (Number.isFinite(stats.depth)) parts.push(`depth=${stats.depth}`);
    if (Number.isFinite(stats.nodes)) parts.push(`nodes=${stats.nodes}`);
    if (stats.score && Number.isFinite(stats.score.value)) parts.push(`score=${formatScoreForLog(stats.score)}`);
  }
  return parts.join("  ");
}

function formatScoreForLog(score) {
  if (score.type === "cp") return `${score.value}cp`;
  if (score.type === "mate") return `mate ${score.value}`;
  return `${score.type}${score.value}`;
}

function stopSession(session) {
  session.running = false;
  session.turnToken++;
  session.thinking = null;
  for (const engine of Object.values(session.engines)) {
    if (engine) engine.stop();
  }
  pushLog(session, "Stopped");
}

function destroySession(session) {
  stopSession(session);
  for (const engine of Object.values(session.engines)) {
    if (engine) engine.quit();
  }
  sessions.delete(session.id);
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/default-engines") {
      return json(res, 200, { engines: loadEnginePresets() });
    }

    if (req.method === "POST" && pathname === "/api/engine/check") {
      const body = await readJson(req);
      const engine = new UciEngine(resolveEnginePath(body.path), "probe");
      await engine.start();
      const result = { name: engine.name, author: engine.author, options: engine.options };
      engine.quit();
      return json(res, 200, result);
    }

    if (req.method === "POST" && pathname === "/api/engine-presets") {
      const body = await readJson(req);
      return json(res, 200, { engines: addEnginePreset(body) });
    }

    const presetMatch = pathname.match(/^\/api\/engine-presets\/(\d+)$/);
    if (req.method === "DELETE" && presetMatch) {
      return json(res, 200, { engines: removeEnginePreset(Number(presetMatch[1])) });
    }

    if (req.method === "POST" && pathname === "/api/pick-engine") {
      const selectedPath = await pickEnginePath();
      return json(res, 200, { path: selectedPath });
    }

    if (req.method === "POST" && pathname === "/api/session") {
      const body = await readJson(req);
      const session = await createSession(body);
      return json(res, session.error ? 400 : 200, publicSession(session));
    }

    const match = pathname.match(/^\/api\/session\/([^/]+)(?:\/([^/]+))?$/);
    if (match) {
      const session = sessions.get(match[1]);
      if (!session) return json(res, 404, { error: "Session not found" });
      const action = match[2] || "";

      if (req.method === "GET" && !action) return json(res, 200, publicSession(session));

      if (req.method === "POST" && action === "move") {
        const body = await readJson(req);
        if (session.chess.status().over) return json(res, 400, { error: "Game is over" });
        const color = session.chess.turn;
        if (session.players[color].type !== "human") return json(res, 400, { error: "It is not a human turn" });
        const uci = `${body.from || ""}${body.to || ""}${body.promotion || ""}`.toLowerCase();
        const move = session.chess.applyUci(uci);
        session.moveHistory.push({
          ply: session.moveHistory.length + 1,
          color,
          uci: move.from !== undefined ? `${body.from}${body.to}${body.promotion || ""}` : uci,
          fen: session.chess.toFen(),
          info: []
        });
        pushLog(session, `${color === "w" ? "White" : "Black"} played ${uci}`);
        session.running = true;
        scheduleEngineTurn(session);
        return json(res, 200, publicSession(session));
      }

      if (req.method === "POST" && action === "control") {
        const body = await readJson(req);
        if (body.action === "start") {
          session.running = true;
          pushLog(session, "Started");
          scheduleEngineTurn(session);
        } else if (body.action === "stop") {
          stopSession(session);
        } else if (body.action === "quit") {
          destroySession(session);
          return json(res, 200, { ok: true });
        } else {
          return json(res, 400, { error: "Unknown control action" });
        }
        return json(res, 200, publicSession(session));
      }
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(req, res, url.pathname);
  } else {
    serveStatic(req, res, decodeURIComponent(url.pathname));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`UCI Chess Matchboard listening on http://${HOST}:${PORT}`);
});

process.on("SIGINT", () => {
  for (const session of sessions.values()) destroySession(session);
  process.exit(0);
});
