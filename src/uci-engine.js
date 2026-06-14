const { spawn } = require("child_process");
const { EventEmitter } = require("events");

function parseInfoLine(line) {
  if (!line || !line.startsWith("info ") || line.startsWith("info string ")) return null;
  const tokens = line.split(/\s+/);
  const stats = { raw: line };
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === "pv") {
      stats.pv = tokens.slice(i + 1);
      break;
    }
    if (token === "score" && i + 2 < tokens.length) {
      stats.score = {
        type: tokens[i + 1],
        value: Number(tokens[i + 2])
      };
      i += 2;
      continue;
    }
    if (["depth", "seldepth", "nodes", "nps", "time", "multipv", "hashfull", "tbhits"].includes(token) && i + 1 < tokens.length) {
      const value = Number(tokens[i + 1]);
      if (Number.isFinite(value)) stats[token] = value;
      i += 1;
    }
  }
  return stats;
}

function summarizeInfoLines(lines, elapsedMs, bestmove) {
  const parsed = lines.map(parseInfoLine).filter(Boolean);
  const depthLine = parsed.slice().reverse().find((item) => Number.isFinite(item.depth));
  const latest = parsed.at(-1) || {};
  const source = depthLine || latest;
  return {
    bestmove,
    depth: source.depth ?? null,
    seldepth: source.seldepth ?? null,
    score: source.score || null,
    nodes: source.nodes ?? latest.nodes ?? null,
    nps: source.nps ?? latest.nps ?? null,
    engineTimeMs: source.time ?? latest.time ?? null,
    elapsedMs,
    pv: source.pv || latest.pv || [],
    raw: source.raw || lines.at(-1) || ""
  };
}

class UciEngine extends EventEmitter {
  constructor(enginePath, label) {
    super();
    this.path = enginePath;
    this.label = label || enginePath;
    this.proc = null;
    this.buffer = "";
    this.waiters = [];
    this.ready = false;
    this.name = "";
    this.author = "";
    this.options = [];
    this.lastInfo = [];
    this.searching = false;
  }

  async start(options = {}) {
    if (this.proc) return;
    this.proc = spawn(this.path, [], {
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.cwd || undefined
    });
    this.proc.stdout.setEncoding("utf8");
    this.proc.stderr.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk) => this.emit("stderr", chunk));
    this.proc.on("exit", (code, signal) => {
      this.ready = false;
      this.searching = false;
      this.emit("exit", { code, signal });
      const pending = this.waiters.splice(0);
      for (const waiter of pending) waiter.reject(new Error(`${this.label} exited`));
    });
    this.proc.on("error", (err) => {
      this.emit("error", err);
      const pending = this.waiters.splice(0);
      for (const waiter of pending) waiter.reject(err);
    });

    const uciReady = this.waitFor((line) => {
      if (line.startsWith("id name ")) this.name = line.slice(8).trim();
      if (line.startsWith("id author ")) this.author = line.slice(10).trim();
      if (line.startsWith("option ")) this.options.push(line);
      return line === "uciok";
    }, 7000);
    this.send("uci");
    await uciReady;
    await this.isReady();
    this.ready = true;
  }

  onData(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      this.emit("line", line);
      for (const waiter of this.waiters.slice()) {
        try {
          if (waiter.test(line)) {
            this.waiters = this.waiters.filter((item) => item !== waiter);
            clearTimeout(waiter.timer);
            waiter.resolve(line);
          }
        } catch (err) {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          clearTimeout(waiter.timer);
          waiter.reject(err);
        }
      }
    }
  }

  waitFor(test, timeoutMs) {
    return new Promise((resolve, reject) => {
      const waiter = {
        test,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters = this.waiters.filter((item) => item !== waiter);
          reject(new Error(`${this.label} timed out`));
        }, timeoutMs || 5000)
      };
      this.waiters.push(waiter);
    });
  }

  send(command) {
    if (!this.proc || !this.proc.stdin.writable) throw new Error(`${this.label} is not running`);
    this.emit("send", command);
    this.proc.stdin.write(command + "\n");
  }

  async isReady() {
    const ready = this.waitFor((line) => line === "readyok", 5000);
    this.send("isready");
    await ready;
  }

  setOption(name, value) {
    if (value === undefined || value === null || value === "") return;
    this.send(`setoption name ${name} value ${value}`);
  }

  newGame() {
    this.send("ucinewgame");
  }

  async search({ fen, position, depth, movetime, nodes }) {
    this.lastInfo = [];
    this.searching = true;
    const startedAt = Date.now();
    const searchLimit = Number(movetime || 0);
    const timeoutMs = searchLimit > 0 ? Math.max(2500, searchLimit + 1500) : 10000;
    const bestMovePromise = this.waitFor((line) => {
      if (line.startsWith("info ")) {
        this.lastInfo.push(line);
        if (this.lastInfo.length > 25) this.lastInfo.shift();
        this.emit("info", line);
      }
      return line.startsWith("bestmove ");
    }, timeoutMs);

    this.send(position || "position fen " + fen);
    const parts = ["go"];
    if (nodes) parts.push("nodes", String(nodes));
    if (depth) parts.push("depth", String(depth));
    if (movetime) parts.push("movetime", String(movetime));
    if (parts.length === 1) parts.push("depth", "6");
    this.send(parts.join(" "));
    let line;
    try {
      line = await bestMovePromise;
    } finally {
      this.searching = false;
    }
    const tokens = line.split(/\s+/);
    const bestmove = tokens[1];
    const elapsedMs = Math.max(1, Date.now() - startedAt);
    return {
      bestmove,
      ponder: tokens[3] || "",
      info: this.lastInfo.slice(),
      stats: summarizeInfoLines(this.lastInfo, elapsedMs, bestmove)
    };
  }

  stop() {
    if (this.proc && this.searching) {
      try {
        this.send("stop");
      } catch (_) {
        // Process may already have exited.
      }
    }
    this.searching = false;
  }

  quit() {
    if (!this.proc) return;
    try {
      this.send("quit");
    } catch (_) {
      // Ignore shutdown races.
    }
    const proc = this.proc;
    this.proc = null;
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGTERM");
    }, 800);
  }
}

module.exports = { UciEngine, parseInfoLine, summarizeInfoLines };
