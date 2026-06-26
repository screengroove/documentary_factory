# @doc/render

Remotion composition that turns a documentary manifest's `buildInputProps` output
into a narrated-stills (Ken Burns) video.

## Manual smoke check

The web layer writes `projects/<slug>/out/inputProps.json` (via `buildInputProps`)
once a project reaches the assemble gate. Then:

```bash
cd packages/render && npx remotion studio src/Root.tsx
# In the studio, set the "Documentary" input props to the contents of inputProps.json
# (with publicDir pointed at projects/<slug>). Confirm it plays without errors.

# Cheap non-interactive sanity check (catches asset-path / layout breakage):
npx remotion still src/Root.tsx Documentary <project>/out/frame.png \
  --frame=30 --props=<project>/out/inputProps.json --public-dir=<project>
```

The full render is wired by the web layer (`POST /api/projects/[slug]/render`).
