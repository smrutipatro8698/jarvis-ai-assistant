# Jarvis AI Assistant

## Coding Preferences

- Always add `console.log` statements for debugging in server-side code. Log at function entry with inputs, at key decision points, and on errors with context.
- Keep voice responses concise — all output is spoken aloud.
- Use plain English, avoid jargon.

## Project Structure

- `server/` — Node.js + Express + WebSocket backend with Claude API integration
- `client/` — React + Vite frontend with Web Speech API
- Tools live in `server/src/tools/`, each exporting a `definition` and `execute` function
- Register new tools in `server/src/tools/index.ts`
