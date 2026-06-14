(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.ChessCore = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const FILES = "abcdefgh";
  const PIECE_TO_CHAR = {
    P: "♙",
    N: "♘",
    B: "♗",
    R: "♖",
    Q: "♕",
    K: "♔",
    p: "♟",
    n: "♞",
    b: "♝",
    r: "♜",
    q: "♛",
    k: "♚"
  };
  const KNIGHT_DELTAS = [
    [-2, -1],
    [-2, 1],
    [-1, -2],
    [-1, 2],
    [1, -2],
    [1, 2],
    [2, -1],
    [2, 1]
  ];
  const KING_DELTAS = [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1]
  ];
  const BISHOP_DIRS = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1]
  ];
  const ROOK_DIRS = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1]
  ];
  const QUEEN_DIRS = BISHOP_DIRS.concat(ROOK_DIRS);

  function cloneBoard(board) {
    return board.slice();
  }

  function colorOf(piece) {
    if (!piece) return null;
    return piece === piece.toUpperCase() ? "w" : "b";
  }

  function opposite(color) {
    return color === "w" ? "b" : "w";
  }

  function inBounds(row, col) {
    return row >= 0 && row < 8 && col >= 0 && col < 8;
  }

  function index(row, col) {
    return row * 8 + col;
  }

  function rowOf(idx) {
    return Math.floor(idx / 8);
  }

  function colOf(idx) {
    return idx % 8;
  }

  function squareToIndex(square) {
    if (!/^[a-h][1-8]$/.test(square)) return -1;
    const col = FILES.indexOf(square[0]);
    const row = 8 - Number(square[1]);
    return index(row, col);
  }

  function indexToSquare(idx) {
    return FILES[colOf(idx)] + String(8 - rowOf(idx));
  }

  function moveToUci(move) {
    return indexToSquare(move.from) + indexToSquare(move.to) + (move.promotion || "");
  }

  function normalizePromotion(piece, color) {
    const p = (piece || "q").toLowerCase();
    return "qrbn".includes(p) ? (color === "w" ? p.toUpperCase() : p) : color === "w" ? "Q" : "q";
  }

  function makeMoveKey(move) {
    return indexToSquare(move.from) + indexToSquare(move.to) + (move.promotion || "");
  }

  class Chess {
    constructor(fen = START_FEN) {
      this.load(fen);
    }

    clone() {
      const copy = Object.create(Chess.prototype);
      copy.board = cloneBoard(this.board);
      copy.turn = this.turn;
      copy.castling = this.castling;
      copy.ep = this.ep;
      copy.halfmove = this.halfmove;
      copy.fullmove = this.fullmove;
      copy.positionCounts = new Map(this.positionCounts || []);
      return copy;
    }

    load(fen) {
      const parts = fen.trim().split(/\s+/);
      if (parts.length < 4) throw new Error("FEN must have at least 4 fields");
      const rows = parts[0].split("/");
      if (rows.length !== 8) throw new Error("FEN board must have 8 ranks");
      const board = [];
      for (const row of rows) {
        let count = 0;
        for (const ch of row) {
          if (/[1-8]/.test(ch)) {
            const n = Number(ch);
            count += n;
            for (let i = 0; i < n; i++) board.push(null);
          } else if (/[pnbrqkPNBRQK]/.test(ch)) {
            count++;
            board.push(ch);
          } else {
            throw new Error("Invalid FEN piece: " + ch);
          }
        }
        if (count !== 8) throw new Error("Invalid FEN rank width");
      }
      this.board = board;
      this.turn = parts[1] === "b" ? "b" : "w";
      this.castling = parts[2] === "-" ? "" : parts[2];
      this.ep = parts[3];
      this.halfmove = Number(parts[4] || 0);
      this.fullmove = Number(parts[5] || 1);
      this.positionCounts = new Map();
      this.recordPosition();
      return this;
    }

    toFen() {
      const rows = [];
      for (let r = 0; r < 8; r++) {
        let row = "";
        let empty = 0;
        for (let c = 0; c < 8; c++) {
          const piece = this.board[index(r, c)];
          if (!piece) {
            empty++;
          } else {
            if (empty) row += String(empty);
            empty = 0;
            row += piece;
          }
        }
        if (empty) row += String(empty);
        rows.push(row);
      }
      return [
        rows.join("/"),
        this.turn,
        this.castling || "-",
        this.ep,
        this.halfmove,
        this.fullmove
      ].join(" ");
    }

    pieceAt(squareOrIndex) {
      const idx = typeof squareOrIndex === "number" ? squareOrIndex : squareToIndex(squareOrIndex);
      return this.board[idx] || null;
    }

    legalMoves(options = {}) {
      const color = options.color || this.turn;
      const moves = this.pseudoMoves(color);
      const legal = [];
      for (const move of moves) {
        const next = this.clone();
        next.applyMoveObject(move, { skipValidation: true });
        if (!next.inCheck(color)) legal.push(move);
      }
      return legal;
    }

    findLegalUci(uci) {
      const normalized = String(uci || "").trim().toLowerCase();
      return this.legalMoves().find((move) => moveToUci(move).toLowerCase() === normalized) || null;
    }

    applyUci(uci) {
      const move = this.findLegalUci(uci);
      if (!move) throw new Error("Illegal move: " + uci);
      this.applyMoveObject(move);
      return move;
    }

    applyMove(fromSquare, toSquare, promotion) {
      const from = squareToIndex(fromSquare);
      const to = squareToIndex(toSquare);
      const desired = String(promotion || "").toLowerCase();
      const move = this.legalMoves().find((candidate) => {
        if (candidate.from !== from || candidate.to !== to) return false;
        return (candidate.promotion || "") === desired || (!candidate.promotion && !desired);
      });
      if (!move) throw new Error("Illegal move");
      this.applyMoveObject(move);
      return move;
    }

    applyMoveObject(move) {
      const piece = this.board[move.from];
      if (!piece) throw new Error("No piece on source square");
      const color = colorOf(piece);
      const target = this.board[move.to];
      const fromSquare = indexToSquare(move.from);
      const toSquare = indexToSquare(move.to);

      this.board[move.from] = null;

      if (move.enPassant) {
        const capRow = color === "w" ? rowOf(move.to) + 1 : rowOf(move.to) - 1;
        this.board[index(capRow, colOf(move.to))] = null;
      }

      if (move.castle) {
        if (toSquare === "g1") this.moveRookForCastle("h1", "f1");
        if (toSquare === "c1") this.moveRookForCastle("a1", "d1");
        if (toSquare === "g8") this.moveRookForCastle("h8", "f8");
        if (toSquare === "c8") this.moveRookForCastle("a8", "d8");
      }

      this.board[move.to] = move.promotion ? normalizePromotion(move.promotion, color) : piece;
      this.updateCastlingRights(piece, fromSquare, toSquare, target);
      this.ep = "-";

      if (piece.toLowerCase() === "p" && Math.abs(move.to - move.from) === 16) {
        const epRow = (rowOf(move.from) + rowOf(move.to)) / 2;
        this.ep = indexToSquare(index(epRow, colOf(move.from)));
      }

      this.halfmove = piece.toLowerCase() === "p" || target || move.enPassant ? 0 : this.halfmove + 1;
      if (this.turn === "b") this.fullmove += 1;
      this.turn = opposite(this.turn);
      this.recordPosition();
    }

    positionKey() {
      return this.toFen().split(" ").slice(0, 4).join(" ");
    }

    recordPosition() {
      const key = this.positionKey();
      this.positionCounts.set(key, (this.positionCounts.get(key) || 0) + 1);
    }

    repetitionCount() {
      return this.positionCounts.get(this.positionKey()) || 0;
    }

    moveRookForCastle(fromSquare, toSquare) {
      const from = squareToIndex(fromSquare);
      const to = squareToIndex(toSquare);
      this.board[to] = this.board[from];
      this.board[from] = null;
    }

    updateCastlingRights(piece, fromSquare, toSquare, captured) {
      const remove = (letters) => {
        for (const letter of letters) this.castling = this.castling.replace(letter, "");
      };
      if (piece === "K") remove("KQ");
      if (piece === "k") remove("kq");
      if (fromSquare === "h1" || toSquare === "h1" || (captured === "R" && toSquare === "h1")) remove("K");
      if (fromSquare === "a1" || toSquare === "a1" || (captured === "R" && toSquare === "a1")) remove("Q");
      if (fromSquare === "h8" || toSquare === "h8" || (captured === "r" && toSquare === "h8")) remove("k");
      if (fromSquare === "a8" || toSquare === "a8" || (captured === "r" && toSquare === "a8")) remove("q");
    }

    pseudoMoves(color) {
      const moves = [];
      for (let from = 0; from < 64; from++) {
        const piece = this.board[from];
        if (!piece || colorOf(piece) !== color) continue;
        const type = piece.toLowerCase();
        if (type === "p") this.addPawnMoves(moves, from, color);
        if (type === "n") this.addJumpMoves(moves, from, color, KNIGHT_DELTAS);
        if (type === "b") this.addSlideMoves(moves, from, color, BISHOP_DIRS);
        if (type === "r") this.addSlideMoves(moves, from, color, ROOK_DIRS);
        if (type === "q") this.addSlideMoves(moves, from, color, QUEEN_DIRS);
        if (type === "k") {
          this.addJumpMoves(moves, from, color, KING_DELTAS);
          this.addCastleMoves(moves, from, color);
        }
      }
      return moves;
    }

    addPawnMoves(moves, from, color) {
      const row = rowOf(from);
      const col = colOf(from);
      const dir = color === "w" ? -1 : 1;
      const startRow = color === "w" ? 6 : 1;
      const promoteRow = color === "w" ? 0 : 7;
      const oneRow = row + dir;
      if (inBounds(oneRow, col)) {
        const one = index(oneRow, col);
        if (!this.board[one]) {
          this.pushPawnMove(moves, from, one, color, promoteRow);
          const twoRow = row + dir * 2;
          const two = index(twoRow, col);
          if (row === startRow && !this.board[two]) moves.push({ from, to: two });
        }
      }
      for (const dc of [-1, 1]) {
        const capRow = row + dir;
        const capCol = col + dc;
        if (!inBounds(capRow, capCol)) continue;
        const to = index(capRow, capCol);
        const target = this.board[to];
        const epIndex = this.ep === "-" ? -1 : squareToIndex(this.ep);
        if (target && colorOf(target) !== color) {
          this.pushPawnMove(moves, from, to, color, promoteRow, true);
        } else if (to === epIndex) {
          moves.push({ from, to, enPassant: true });
        }
      }
    }

    pushPawnMove(moves, from, to, color, promoteRow, capture) {
      if (rowOf(to) === promoteRow) {
        for (const promotion of ["q", "r", "b", "n"]) moves.push({ from, to, promotion, capture: !!capture });
      } else {
        moves.push({ from, to, capture: !!capture });
      }
    }

    addJumpMoves(moves, from, color, deltas) {
      const row = rowOf(from);
      const col = colOf(from);
      for (const [dr, dc] of deltas) {
        const nr = row + dr;
        const nc = col + dc;
        if (!inBounds(nr, nc)) continue;
        const to = index(nr, nc);
        const target = this.board[to];
        if (!target || colorOf(target) !== color) moves.push({ from, to, capture: !!target });
      }
    }

    addSlideMoves(moves, from, color, dirs) {
      const row = rowOf(from);
      const col = colOf(from);
      for (const [dr, dc] of dirs) {
        let nr = row + dr;
        let nc = col + dc;
        while (inBounds(nr, nc)) {
          const to = index(nr, nc);
          const target = this.board[to];
          if (!target) {
            moves.push({ from, to });
          } else {
            if (colorOf(target) !== color) moves.push({ from, to, capture: true });
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    }

    addCastleMoves(moves, from, color) {
      if (this.inCheck(color)) return;
      if (color === "w" && from === squareToIndex("e1")) {
        if (this.castling.includes("K") && !this.board[squareToIndex("f1")] && !this.board[squareToIndex("g1")] && !this.isAttacked(squareToIndex("f1"), "b") && !this.isAttacked(squareToIndex("g1"), "b")) {
          moves.push({ from, to: squareToIndex("g1"), castle: true });
        }
        if (this.castling.includes("Q") && !this.board[squareToIndex("d1")] && !this.board[squareToIndex("c1")] && !this.board[squareToIndex("b1")] && !this.isAttacked(squareToIndex("d1"), "b") && !this.isAttacked(squareToIndex("c1"), "b")) {
          moves.push({ from, to: squareToIndex("c1"), castle: true });
        }
      }
      if (color === "b" && from === squareToIndex("e8")) {
        if (this.castling.includes("k") && !this.board[squareToIndex("f8")] && !this.board[squareToIndex("g8")] && !this.isAttacked(squareToIndex("f8"), "w") && !this.isAttacked(squareToIndex("g8"), "w")) {
          moves.push({ from, to: squareToIndex("g8"), castle: true });
        }
        if (this.castling.includes("q") && !this.board[squareToIndex("d8")] && !this.board[squareToIndex("c8")] && !this.board[squareToIndex("b8")] && !this.isAttacked(squareToIndex("d8"), "w") && !this.isAttacked(squareToIndex("c8"), "w")) {
          moves.push({ from, to: squareToIndex("c8"), castle: true });
        }
      }
    }

    inCheck(color) {
      const king = color === "w" ? "K" : "k";
      const kingIndex = this.board.findIndex((piece) => piece === king);
      return kingIndex >= 0 ? this.isAttacked(kingIndex, opposite(color)) : false;
    }

    isAttacked(targetIndex, byColor) {
      const row = rowOf(targetIndex);
      const col = colOf(targetIndex);
      const pawnDir = byColor === "w" ? -1 : 1;
      const pawnRow = row - pawnDir;
      for (const dc of [-1, 1]) {
        const pc = col + dc;
        if (inBounds(pawnRow, pc)) {
          const piece = this.board[index(pawnRow, pc)];
          if (piece && colorOf(piece) === byColor && piece.toLowerCase() === "p") return true;
        }
      }
      for (const [dr, dc] of KNIGHT_DELTAS) {
        const nr = row + dr;
        const nc = col + dc;
        if (inBounds(nr, nc)) {
          const piece = this.board[index(nr, nc)];
          if (piece && colorOf(piece) === byColor && piece.toLowerCase() === "n") return true;
        }
      }
      for (const [dr, dc] of KING_DELTAS) {
        const nr = row + dr;
        const nc = col + dc;
        if (inBounds(nr, nc)) {
          const piece = this.board[index(nr, nc)];
          if (piece && colorOf(piece) === byColor && piece.toLowerCase() === "k") return true;
        }
      }
      if (this.rayAttacked(row, col, byColor, BISHOP_DIRS, ["b", "q"])) return true;
      if (this.rayAttacked(row, col, byColor, ROOK_DIRS, ["r", "q"])) return true;
      return false;
    }

    rayAttacked(row, col, byColor, dirs, attackers) {
      for (const [dr, dc] of dirs) {
        let nr = row + dr;
        let nc = col + dc;
        while (inBounds(nr, nc)) {
          const piece = this.board[index(nr, nc)];
          if (piece) {
            if (colorOf(piece) === byColor && attackers.includes(piece.toLowerCase())) return true;
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
      return false;
    }

    status() {
      const legal = this.legalMoves();
      const check = this.inCheck(this.turn);
      if (legal.length === 0) return { over: true, reason: check ? "checkmate" : "stalemate", winner: check ? opposite(this.turn) : null, check };
      if (this.repetitionCount() >= 3) return { over: true, reason: "threefold repetition", winner: null, check };
      if (this.halfmove >= 100) return { over: true, reason: "50-move rule", winner: null, check };
      if (this.insufficientMaterial()) return { over: true, reason: "insufficient material", winner: null, check };
      return { over: false, reason: check ? "check" : "playing", winner: null, check };
    }

    insufficientMaterial() {
      const pieces = this.board.filter(Boolean);
      const material = pieces.map((piece) => piece.toLowerCase());
      if (material.every((piece) => piece === "k")) return true;
      const nonKings = material.filter((piece) => piece !== "k");
      if (nonKings.length === 1 && ["b", "n"].includes(nonKings[0])) return true;
      if (nonKings.length === 2 && nonKings.every((piece) => piece === "b")) {
        const bishopSquares = [];
        this.board.forEach((piece, idx) => {
          if (piece && piece.toLowerCase() === "b") bishopSquares.push((rowOf(idx) + colOf(idx)) % 2);
        });
        return bishopSquares.length === 2 && bishopSquares[0] === bishopSquares[1];
      }
      return false;
    }

    snapshot() {
      const legal = this.legalMoves();
      return {
        fen: this.toFen(),
        board: this.board,
        turn: this.turn,
        castling: this.castling || "-",
        ep: this.ep,
        halfmove: this.halfmove,
        fullmove: this.fullmove,
        status: this.status(),
        legalMoves: legal.map((move) => ({
          from: indexToSquare(move.from),
          to: indexToSquare(move.to),
          promotion: move.promotion || "",
          uci: moveToUci(move),
          capture: !!move.capture || !!move.enPassant,
          castle: !!move.castle
        }))
      };
    }
  }

  return {
    Chess,
    START_FEN,
    PIECE_TO_CHAR,
    squareToIndex,
    indexToSquare,
    moveToUci,
    makeMoveKey,
    opposite
  };
});
