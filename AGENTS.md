<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Game rules live as pure functions in `src/game/engine.ts` (board data composed per card setup by `composeBoard` in `src/game/data.ts` — each of the 8 cards is independently easy or hard — read via `board(state)`) with tests in `engine.test.ts`; UI only calls them — keeps rules testable and separate from rendering.
- New games are created client-side after mount, because random dice during SSR cause hydration mismatches.
- Dice placements in a round are stored as a list replayed from the last reroll snapshot (`replay`), so dice can be moved/returned before a reroll without special undo logic.
- Past-game stats are kept per card-setup code in localStorage (`src/game/stats.ts`); no backend, so they stay on the device.
- Sky and base use the same two-column grid with an identical sidebar width so all five gameplay columns align.
- Excavation rendering uses the same route boundary as engine occupancy, with ground texture applied per undug cell rather than to the whole base; keeps track and cleared spaces clean.
