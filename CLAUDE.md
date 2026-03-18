# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Game Hub — a Flask web app serving three browser-based games (Tetris, Omok/Five-in-a-Row, Chess) via a card-based dashboard. All game logic runs client-side in vanilla JavaScript using the Canvas API. Flask is purely a template renderer with no business logic or API endpoints.

## Running the App

```bash
# Development
python app.py          # Starts Flask dev server on http://localhost:5000

# Production (Docker)
docker build -t game-hub .
docker run -p 5000:5000 game-hub
# Internally runs: gunicorn --bind 0.0.0.0:5000 app:app
```

No test or lint commands are configured.

## Architecture

**Backend (`app.py`)**: Four Flask routes (`/`, `/tetris`, `/omok`, `/chess`) that render the corresponding HTML templates. Nothing else — no database, no REST API, no session state.

**Frontend**: Each game lives on its own HTML page with a dedicated JS file:
- `static/js/tetris.js` — 10×20 grid, 7 tetrominoes, scoring/levels, next-piece preview
- `static/js/omok.js` — 15×15 board, two-player (Black vs White), 5-in-a-row win detection
- `static/js/chess.js` — full piece rules, castling, en passant, check/checkmate/stalemate, move history, undo

All games render to `<canvas>` elements. There is no bundler or build step — JS and CSS are served as-is.

**Styling (`static/css/style.css`)**: Dark theme with purple gradient accents, glassmorphism card components, game-specific panel layouts (Tetris stats sidebar, Chess move history panel).

## Deployment

Designed for AWS deployment. The Dockerfile uses `python:3.12-slim` and gunicorn as the WSGI server. The app binds to `0.0.0.0:5000`.
