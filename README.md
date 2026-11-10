# Relay Rush

Relay Rush is a five-round strategy game for 2–4 people and agents in the same match. Move one or two grid steps for one energy each, tune a relay from the same or an adjacent cell, or recharge three energy (maximum five). Neutral relays cost one energy to tune, enemy relays cost two. Each owned relay scores two points every round, with three for the center. Highest total after five rounds wins. A missed 20-second turn recharges automatically. The host can launch with empty seats filled by built-in drones. Matches take at most 6 minutes and 40 seconds after launch.

## Run

Use Node.js 22 or later. No dependencies to install.

```sh
node server.mjs
```

Open http://127.0.0.1:8788, create a room, and share the six-character code. For a hosted demo, run one instance with `HOST=0.0.0.0` and the port provided by the host in `PORT`. Put the service behind HTTPS. Rooms are in memory and expire after an hour. A restart clears active rooms. Browser play requires neither an account nor a download.

## Sample agent

Join an unstarted lobby before launching it.

```sh
node sample-agent.mjs http://127.0.0.1:8788 A1B2C3
```

## HTTP/JSON API

| Method | Path | Request |
| --- | --- | --- |
| POST | `/api/matches` | `{"name":"Host","seats":4}` |
| POST | `/api/matches/:code/join` | `{"name":"Agent"}` |
| POST | `/api/matches/:code/start` | `{"key":"HOST_SEAT_KEY"}` |
| GET | `/api/matches/:code` | Read the board, players, turn deadline, legal moves and log. |
| POST | `/api/matches/:code/move` | `{"key":"YOUR_SEAT_KEY","revision":0,"kind":"move","tile":2}` |

Create and join return a private `key`, a zero-based `seat`, and a `match` snapshot. Keep the key private. When the snapshot's `turn` equals your seat, copy any `kind` and optional `tile` from `legal` into the move request along with its current `revision`. Tiles are numbered 0–24, row first, with A1 at 0. The other move kinds are `claim` and `charge`. A stale or out-of-turn request returns 409. Read state again before retrying. An invalid key returns 403. End of match is indicated by `phase: "finished"`; `winners` contains seat indices and `log` records each action and round score.

## Verification

```sh
node --test server.test.mjs
```

The API integration test plays a full four-seat match and checks legal moves, seat authorization, duplicate-turn rejection, score updates, and timeout behavior.

## Pitch

Relay Rush turns territory control into a five-round fight over scarce energy. People use a compact browser board, while agents join the very same lobby and play through a small JSON API.
