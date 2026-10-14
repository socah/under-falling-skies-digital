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

- Game rules live as pure functions in `src/game/engine.ts` (board data in `src/game/data.ts`) with tests in `engine.test.ts`; UI only calls them — keeps rules testable and separate from rendering.
- New games are created client-side after mount, because random dice during SSR cause hydration mismatches.
