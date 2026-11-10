import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TURN_MS = 20_000;
const ROUNDS = 5;
const RELAYS = [6, 8, 12, 16, 18];
const SPAWNS = [0, 24, 4, 20];
const rooms = new Map();
const board = await readFile(new URL("./index.html", import.meta.url));
const distance = (a, b) => Math.abs(a % 5 - b % 5) + Math.abs(Math.floor(a / 5) - Math.floor(b / 5));
const weight = tile => tile === 12 ? 3 : 2;
const token = bytes => randomBytes(bytes).toString("hex");

function addPlayer(room, name, bot = false) {
  const seat = room.players.length;
  const player = { name, bot, seat, position: SPAWNS[seat], energy: 3, score: 0, key: bot ? null : token(16) };
  room.players.push(player);
  return player;
}

function legal(room) {
  if (room.phase !== "playing") return [];
  const p = room.players[room.turn];
  const choices = [{ kind: "charge" }];
  for (let tile = 0; tile < 25; tile++) {
    const steps = distance(p.position, tile);
    if (steps > 0 && steps <= 2 && p.energy >= steps &&
        !room.players.some(other => other.position === tile)) choices.push({ kind: "move", tile, cost: steps });
  }
  for (const tile of RELAYS) {
    const owner = room.relays[tile];
    const cost = owner === null ? 1 : 2;
    if (distance(p.position, tile) <= 1 && owner !== p.seat && p.energy >= cost) choices.push({ kind: "claim", tile, cost });
  }
  return choices;
}

function play(room, move, now) {
  const p = room.players[room.turn];
  if (move.kind === "move") p.position = move.tile;
  if (move.kind === "claim") room.relays[move.tile] = p.seat;
  p.energy = move.kind === "charge" ? Math.min(5, p.energy + 3) : p.energy - move.cost;
  room.log.unshift({ round: room.round, text: move.kind === "charge" ? p.name + " charged."
    : p.name + (move.kind === "claim" ? " tuned relay " : " moved to ") + cellName(move.tile) + "." });
  room.turns++;
  if (room.turns % room.players.length === 0) {
    for (const [tile, owner] of Object.entries(room.relays)) {
      if (owner !== null) room.players[owner].score += weight(Number(tile));
    }
    room.log.unshift({ round: room.round, text: "Signal scored · " + room.players.map(p => p.name + " " + p.score).join(" / ") });
    if (room.round === ROUNDS) {
      const best = Math.max(...room.players.map(p => p.score));
      room.winners = room.players.filter(p => p.score === best).map(p => p.seat);
      room.phase = "finished";
      room.deadline = null;
      return;
    }
    room.round++;
  }
  room.turn = (room.turn + 1) % room.players.length;
  room.deadline = now + TURN_MS;
}

function cellName(tile) {
  return "ABCDE"[tile % 5] + (Math.floor(tile / 5) + 1);
}

function botMove(room) {
  const p = room.players[room.turn];
  const options = legal(room);
  const targets = RELAYS.filter(tile => room.relays[tile] !== p.seat);
  const value = move => {
    if (move.kind === "claim") return 10 + weight(move.tile) * 2 + (room.relays[move.tile] === null ? 0 : 1);
    if (move.kind === "charge") return p.energy <= 1 ? 8 : (p.energy <= 3 ? 2 : 0);
    return Math.max(0, ...targets.map(t => Math.max(0, distance(p.position, t) - Math.max(1, distance(move.tile, t))) *
      (weight(t) + 1))) - move.cost * 0.6;
  };
  return options.reduce((best, move) => value(move) > value(best) ? move : best);
}

function advance(room, now = Date.now()) {
  while (room.phase === "playing") {
    if (room.players[room.turn].bot) play(room, botMove(room), room.deadline - TURN_MS);
    else if (now >= room.deadline) play(room, { kind: "charge" }, room.deadline);
    else break;
  }
}

function snapshot(room) {
  return { code: room.code, phase: room.phase, seats: room.seats, round: room.round, rounds: ROUNDS,
    revision: room.turns, turn: room.turn, deadline: room.deadline, relays: room.relays, winners: room.winners,
    players: room.players.map(({ key, ...player }) => player), legal: legal(room), log: room.log };
}

function send(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(value));
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new Error("Request too large.");
    chunks.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object.");
  return value;
}

function playerName(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 22) : fallback;
}

export function createGameServer() {
  return createServer(async (req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
      return res.end(board);
    }
    try {
      if (path === "/api/matches" && req.method === "POST") {
        const input = await body(req);
        if (![2, 3, 4].includes(input.seats)) return send(res, 400, { error: "Choose 2, 3 or 4 seats." });
        const now = Date.now();
        for (const [code, room] of rooms) if (now - room.created > 3_600_000) rooms.delete(code);
        if (rooms.size >= 200) return send(res, 503, { error: "All match slots are busy." });
        let code;
        do { code = token(3).toUpperCase(); } while (rooms.has(code));
        const room = { code, created: now, seats: input.seats, phase: "lobby", round: 1, turn: 0, turns: 0,
          players: [], deadline: null, relays: Object.fromEntries(RELAYS.map(t => [t, null])), winners: [], log: [] };
        const host = addPlayer(room, playerName(input.name, "Operator 1"));
        rooms.set(code, room);
        return send(res, 201, { seat: host.seat, key: host.key, match: snapshot(room) });
      }
      const route = /^\/api\/matches\/([A-Fa-f0-9]{6})(?:\/(join|start|move))?$/.exec(path);
      const room = route && rooms.get(route[1].toUpperCase());
      if (!room) return send(res, 404, { error: "Match not found." });
      if (!route[2] && req.method === "GET") {
        advance(room);
        return send(res, 200, snapshot(room));
      }
      if (!route[2] || req.method !== "POST") return send(res, 405, { error: "Method not supported." });
      const input = await body(req);
      advance(room);
      if (route[2] === "join") {
        if (room.phase !== "lobby" || room.players.length >= room.seats) return send(res, 409, { error: "Lobby is full or already launched." });
        const p = addPlayer(room, playerName(input.name, "Operator " + (room.players.length + 1)));
        return send(res, 201, { seat: p.seat, key: p.key, match: snapshot(room) });
      }
      const player = room.players.find(p => !p.bot && p.key === input.key);
      if (!player) return send(res, 403, { error: "Seat key required." });
      if (route[2] === "start") {
        if (player.seat !== 0 || room.phase !== "lobby") return send(res, 409, { error: "Only the host can launch the lobby." });
        while (room.players.length < room.seats) addPlayer(room, "Drone " + room.players.length, true);
        room.phase = "playing";
        room.deadline = Date.now() + TURN_MS;
        return send(res, 200, snapshot(room));
      }
      if (room.phase !== "playing" || room.turn !== player.seat || room.turns !== input.revision) {
        return send(res, 409, { error: "Turn has changed. Read the match again." });
      }
      const move = legal(room).find(option => option.kind === input.kind && option.tile === input.tile);
      if (!move) return send(res, 400, { error: "Illegal move." });
      play(room, move, Date.now());
      advance(room);
      return send(res, 200, snapshot(room));
    } catch (error) {
      return send(res, 400, { error: error.message || "Invalid request." });
    }
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const port = Number(process.env.PORT || 8788);
  createGameServer().listen(port, process.env.HOST || "127.0.0.1", () => console.log("Relay Rush is listening on port " + port));
}

