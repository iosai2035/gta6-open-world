// Solmar Bay: an original 3D open-world crime game for make.fun's gta6-01 bounty (Node 22,
// standard library only). The game is this directory's game/ folder, plain static files a
// desktop browser loads offline (game/index.html and its ES modules, Three.js vendored as
// game/vendor/three.min.js, no network request), and the program hands it in: it copies
// game/ and screenshots/ from beside this file to /output and writes /output/dossier.json,
// the summary the judge reads, with the vendored make.fun library. After copying, it checks
// the copy landed whole — a short copy is a broken entry, so it refuses to write a dossier
// over one. It also refuses when the vendored engine the game needs is missing.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** Total bytes of every file under a directory, recursively. */
function totalBytes(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) total += totalBytes(path);
    else if (entry.isFile()) total += statSync(path).size;
  }
  return total;
}

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Guard: the copy must land whole. A short game/ or screenshots/ is a broken entry, so
// refuse to write a dossier over one instead of handing in a half-copied game.
const gameBytes = totalBytes(join(out, 'game'));
const sourceBytes = totalBytes(join(here, 'game'));
if (gameBytes === 0 || gameBytes !== sourceBytes) throw new Error('game/ did not copy whole: refusing to write a dossier over a half-copied game');
const shotBytes = totalBytes(join(out, 'screenshots'));
if (shotBytes === 0) throw new Error('screenshots/ did not copy: refusing to write a dossier with no screenshots');

// Guard: the game needs its vendored engine. Without game/vendor/three.min.js the page
// loads nothing 3D, so refuse to hand in a game that cannot start.
if (!existsSync(join(out, 'game', 'vendor', 'three.min.js'))) throw new Error('game/vendor/three.min.js is missing: refusing to write a dossier for a game with no engine');

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
