# Canvas vendoring provenance

Source: https://github.com/MMMarcinho/open-intelligent-ui
Verified upstream commit: `037e94824a6f8045c22d09a45eb28b54cd564fbb`
Upstream package version: `0.1.0`
License: MIT, copyright (c) 2026 MMMarcinho. See `LICENSE` in this directory.

Verified on 2026-10-22 against the clean cloud reference checkout. The original
copy of `protocol/`, `ui/`, `services/reply-coordinator.ts`, and dsh `segments.ts`
matched that commit byte-for-byte. Local changes for Canvas 0.2.2 are listed
below; the reference hashes at the end remain upstream baseline hashes, not
claims about patched files. The original IUI repository and host plugin are not
modified.

## Canvas-local patch, 0.2.2

- `protocol/runtime.ts`: add only primitive string `.slice(start, end)` to the
  existing safe evaluator's explicit string method allowlist. It uses the same
  finite index conversion as the existing array slice, native primitive string
  slicing, and the existing output string-length budget. No method extraction,
  prototype dispatch, `call`/`apply`, constructor access, `eval`, `Function`, DOM,
  network access, or arbitrary HTML execution is enabled. All other previously
  unsupported string methods remain unsupported.
- `protocol/parser.ts`: keep Markdown code opaque using the full opening fence
  length, matching marker character, and a standalone closing fence line. Inline
  code closes only on an equal-length backtick run. Top-level four-space/tab
  indented code is skipped as literal source; indentation inside an already open
  IUI component remains component formatting. These are conservative code-example
  boundary fixes, not HTML execution or new protocol syntax.
- `src/adapters/iui.ts` (outside this vendored directory): Canvas-local source
  segmentation and per-root validation adapted from the upstream MIT reply
  coordinator. Parser spans preserve Markdown/UI order and opaque code fences,
  inline code, escaped roots, and foreign HTML. Bad declarations or roots become
  local source-only fallbacks instead of replacing the complete reply. An
  explicitly mismatched root close permits bounded recovery of subsequent
  content; an absent close never invents a boundary. Global parser budgets
  still apply.
- `src/ui/ReplyContent.tsx` (outside this vendored directory): separate React
  boundaries and shadow roots for each component and Markdown segment; valid
  roots share the safe local state runtime. Unclosed streaming syntax previews
  only its own safe prefix. Completed surrounding content remains visible, and
  the full original source remains available. Whitespace-only text placeholders
  do not create empty Markdown panels.

## Safe legacy predicate sync, 0.2.4

- `protocol/runtime.ts` accepts only direct array `.filter(Boolean)` with one
  argument as a bounded, built-in truthiness predicate. A locally declared
  `Boolean` still takes precedence and must be an allowed arrow closure.
  Arbitrary global calls, other array callbacks, computed member aliases, and
  dangerous properties remain blocked. The existing bounded string `slice`
  patch remains in place.
- `src/adapters/iui.ts` recognizes that exact syntax during declaration and
  root readiness checks; mixed Markdown and IUI roots keep their shared state.

The import closure uses only the safe parser/runtime and React UI renderer.
The website DOM-interception coordinator is not started or instantiated.
Script authorization and resource adapters are deliberately not provided.
Code fences remain literal Markdown. `AppBlock` cannot run.

The upstream `THIRD_PARTY_NOTICES.md` describes upstream bundles, not this
canvas package. Canvas distributions must retain the IUI MIT license and
appropriate licenses for Acorn, ReactMarkdown/remark, and bundled dependencies.
The exact build import closure and license list belong to the canvas build.

Verified reference file SHA-256 values:

- `LICENSE`: `57805f3093225e49d659088f26ea5045ee15d75d53ce8f1562980b1a78ef0b9c`
- `protocol/runtime.ts`: `1d5c2bef8cfc8be9af68e02ca7aed1e380612e27f9bcc04923aa7ee6ce892a84`
- `protocol/parser.ts`: `19629994883846726df1217ecc060803a92a2948fd7d9b32300e404e6eb02536`
- `services/reply-coordinator.ts`: `0f9824b645743ddb7313cdc8d21ae896454fdd88e73eb60eb4b7c3fdbe2f51e1`
- `packages/dsh-plugin/src/segments.ts`: `b88da36c29cbbd61fcb500d9a9caf020e7c7aec77c1b4a3d1b82e27a061319f2`
- `ui/renderer/Renderer.tsx`: `ba0dc368d9ce798c51e06274aef4583e34d62a57292d88ed51e84786f0f2c2a0`
- `ui/styles.css`: `351f26d18dd226ae460dfaa9112645f940b458dae70aa1825b714eb806232efc`
