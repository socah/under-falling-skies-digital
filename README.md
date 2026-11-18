# Under Falling Skies — Digital

A browser adaptation of **[Under Falling Skies: A 9-Card Solo Game](https://boardgamegeek.com/boardgame/273779/under-falling-skies-a-9-card-solo-game)**, the print-and-play solo dice-placement game by Tomáš Uhlíř. Place dice to shoot down alien ships, dig deeper into your underground base and finish researching a weapon before the mothership lands.

> This is an unofficial fan project for personal use. *Under Falling Skies* and its design belong to its designer and publisher (Czech Games Edition). If you enjoy it, buy the full game.

## How to play

Each round you roll five dice (three white, two grey) and place them in the base one at a time, **one die per column**. Each die you place moves every alien ship in that column down the sky by the die's value, so a strong die is also a risk.

- **Grey dice** force a reroll of the dice you haven't placed yet.
- **Rooms** activate when every space in them is filled. A room's value is the sum of its dice plus its modifier, and some rooms cost energy to use:
  - **Energy:** gain energy (max 7)
  - **Fighters:** shoot down every ship sitting on an explosion icon of that value or less
  - **Research:** move along the research track. Reaching the end **wins the game**
  - **Robots:** build a robot die that keeps working in later rounds (max 2)
- **Excavator:** a die on an undug space moves the excavator forward along its route and unlocks the rooms behind it.
- **Sky icons:** arrows push a ship sideways. A saucer brings the mothership one row down.
- At the end of each round the mothership applies its row's effect and comes down a row, and new ships appear.

**You lose** if the mothership reaches the skull row or your base takes 5 hits (a hit happens when a ship gets past the bottom of the sky).

### Difficulty

Each of the 8 board cards (mothership, the four sky cards, two base cards and the research track) can be set to its **easy** or **hard** side on its own, giving 256 setups from level 0 (all easy) to level 8 (all hard). A setup is stored as an 8-letter code such as `eehheeee`. Win/loss stats and best round counts are kept for each setup in your browser's `localStorage`.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, file-based routing, SSR) on [Vite](https://vite.dev)
- Tailwind CSS v4 and [shadcn/ui](https://ui.shadcn.com) components
- [Vitest](https://vitest.dev) and Testing Library
- Scaffolded with [Lovable](https://lovable.dev)

## Getting started

The toolchain is pinned in [`mise.toml`](mise.toml) (Node 22, Bun 1), so the project uses its own Node and Bun and leaves your system versions alone. Install [mise](https://mise.jdx.dev) once:

```sh
curl https://mise.run | sh
echo 'eval "$(~/.local/bin/mise activate bash)"' >> ~/.bashrc   # or zsh/fish equivalent
```

Then:

```sh
git clone https://github.com/socah/under-falling-skies-digital.git
cd under-falling-skies-digital
mise install       # fetches the pinned Node + Bun into ~/.local/share/mise
bun install
bun run dev
```

Not using mise? Any **Node.js 20.19+ / 22.12+** (Vite 8 requires it) together with [Bun](https://bun.sh) will work. The lockfile is `bun.lock`.

| Script            | What it does                         |
| ----------------- | ------------------------------------ |
| `dev`             | Start the dev server                 |
| `build`           | Production build                     |
| `preview`         | Serve the production build           |
| `test`            | Run the test suite once              |
| `test:watch`      | Run tests in watch mode              |
| `lint` / `format` | ESLint / Prettier                    |

## Project structure

```
src/
├── game/
│   ├── data.ts          # Board data for both sides of each card; composeBoard() builds a board from a setup code
│   ├── engine.ts        # Game rules as pure functions (GameState in, new GameState out)
│   ├── engine.test.ts   # Rules tests
│   └── stats.ts         # Per-setup results in localStorage
├── components/
│   ├── game/Game.tsx    # The whole game UI
│   └── ui/              # shadcn/ui primitives
├── routes/              # TanStack Router file routes (index.tsx renders <Game />)
├── assets/              # Sky, base and room artwork
└── styles.css
```

### Design notes

- **The rules are separate from the UI.** All game logic is in `src/game/engine.ts` as pure, deterministic functions. Randomness comes in through an `Rng` argument, so tests can use fixed rolls. The UI only calls these functions and renders the result.
- **Dice placement can be undone through replay.** The placements made since the last reroll are kept as a list and replayed from a saved snapshot (`replay()`). That lets you move or take back a die before you commit, with no separate undo logic.
- **Games start on the client.** A new game is created after mount, because rolling dice during SSR would cause hydration mismatches.
- **Everything runs locally.** There is no backend, and all state lives in the browser.

See [`AGENTS.md`](AGENTS.md) for more conventions and [`roadmap.md`](roadmap.md) for recent and planned work.

## Lovable sync

This repo started in Lovable. If the Lovable project is still connected, commits pushed to `main` sync back into the Lovable editor. Don't rewrite published history (force-push, rebase or amend pushed commits), because that would break the Lovable project history.
