# UCI Chess Matchboard

A local browser chess GUI for playing vs UCI engines.

The Node server serves the board UI and starts UCI engine
executables as child processes on your machine.

<img width="1000" height="550" alt="Image" src="https://github.com/user-attachments/assets/05108960-cb07-48a6-a505-95f15dd1482d" />

## Requirements

- Node.js 18 or newer
- One or more UCI-compatible chess engine binaries

No npm packages need to be installed.

## Start The App

```sh
cd path/to/ChessMatchboardUCI
npm start
```

Open:

```text
http://localhost:5174
```

## Use The Board

- Choose whether White and Black are **Human** or **Engine**.
- Pick engine presets or custom paths for engine players.
- Set depth and optional min/max move time per engine.
- Press **New Game**.

## Add An Engine

You can add engines from the UI:
1. Expand **Engines**.
2. Enter or browse to the UCI engine executable.
3. Press the plus button to save engine preset

<img width="435" height="533" alt="Image" src="https://github.com/user-attachments/assets/fbae1819-fac0-4331-a5c2-255b8d047dc0" />

Saved presets are written to `config/engines.json`.

You can also edit `config/engines.json` manually:

```json
{
  "engines": [
    { "name": "Stockfish", "path": "path/to/stockfish/uci.exe" }
  ]
}
```
Download the engine yourself and place the binary at that path, or change the
path to wherever your engine binary lives.

On macOS/Linux, make sure the engine file is executable:

```sh
chmod +x path/to/stockfish/uci.exe
```

## Notes

- The app validates legal moves and tracks FEN, castling, en passant,
  promotion, checkmate, stalemate, 50-move draw, repetition, and insufficient
  material.
