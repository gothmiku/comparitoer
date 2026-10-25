# PROGRESS

Running log for the video-compare app. One entry per phase.

---

## Phase 0 — Scaffold ✅

**Done**

- `git init -b main` (no remote yet, no push).
- Vite 8.3.5 + TypeScript 7.0.2 + Vitest 5.0.5 as the only dev dependencies. Zero runtime dependencies.
- `vite.config.ts` with `base: './'` so a single `dist/` works on both Vercel and GitHub Pages.
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`, `noEmit`, `types: []`.
- `.gitignore` (node_modules, dist, coverage, test-media, editor/OS junk) and
  `.gitattributes` (`* text=auto eol=lf`, byte-exact `package-lock.json` and `*.mp4`).
- `.github/workflows/deploy.yml`: build job (npm ci → typecheck → test → build) then
  `upload-pages-artifact` + `deploy-pages`, triggered on push to `main` and manually.
- App shell: `index.html` → `src/main.ts` (composition root, mounts header + `#stage-root`)
  and `src/styles.css` (design tokens, reset, motion preferences, light/dark tokens).
- `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.

**Gate:** `npm run typecheck && npm test && npm run build` — all green.
`dist/index.html` references `./assets/...` (relative, verified by inspecting the output).

**Decisions**

- `src/logic/fps.ts` added as a fourth pure module (approved): FPS estimation, frame
  indexing and frame snapping are unit-testable math and are shared by the frame counter,
  frame stepping and the info-bar FPS chip. Sampling stays in `sync.ts`.
- `test-media/` is gitignored — fixtures are for manual browser checks only and are never
  referenced by `index.html`, so the Pages artifact is unaffected.
- `progress.md` (empty) was deleted and `PROGRESS.md` created in its place. On this
  case-insensitive filesystem they are the same file, so no history was lost.
- TypeScript 7 rejects untyped side-effect imports (TS2882), which is why
  `src/vite-env.d.ts` exists. Keep it — removing it breaks `import './styles.css'`.
- `npm run build` is `vite build` only; typechecking is a separate script so CI and the
  local gate don't run `tsc` twice.
- `npm test` carries `--passWithNoTests` **for Phase 0 only**; drop it when Phase 1 lands
  the first spec files.
- CI runs `typecheck` and `test`, so the workflow stays red until Phase 1. Expected.
- All npm/git commands must run through `cmd.exe /C` — WSL has no node or git. Shell output
  capture is unreliable in this environment, so gate output is redirected to a log file.
- Node 24 / npm 12, git 2.55, identity already configured globally (`gothmiku`). No
  `git config user.*` writes were needed.

**Manual verification needed (browser)**

1. `npm run dev`, open the served URL: header "Video Compare" + tagline render, dark by
   default and readable in light mode, no console errors, no network requests beyond the
   dev bundle.
2. `npm run preview` and open `dist/`: same shell, and the asset URLs resolve relative to
   the page (they must work from a subpath such as `/<repo>/`).

**Next:** Phase 1 — `src/logic/` pure modules (`format.ts`, `duration.ts`, `drift.ts`,
`fps.ts`) plus their Vitest specs.

---

## Phase 1 — Logic + tests

Not started.
