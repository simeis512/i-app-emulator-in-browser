# Third-party software

The combined emulator is distributed under GNU GPL version 3. Our original
adapter/frontend changes are offered under GPL-3.0-or-later; each upstream file
retains its original terms and copyright notices. The root LICENSE contains GPL v3.

## FreeJ2ME-Plus

- Source: https://github.com/TASEmulators/freej2me-plus
- Snapshot commit: `0f3d7467ccce46fdf4e225300bec8c4dbb7242f3`
- License: GPL-3.0-or-later, with separately licensed components (including ASM).
- Full upstream notice: `vendor/freej2me-plus-devel/LICENSE`.
- Vendored files are unmodified. `build.py` generates patches under `build/patched/`.
- Changes: browser frontend bridge, scratchpad offsets/boundaries and repeated
  close handling, PhoneSystem attribute validation, image clipping, log capture,
  music clock, browser volume/tempo routing and DoJa synchronization callbacks.

Separately licensed components retained from that snapshot:

| Component | Terms / notice |
| --- | --- |
| ObjectWeb ASM (`org/objectweb/asm`) | BSD-style 3-clause notice in upstream LICENSE and source headers |
| JavaLayer (`javazoom/jl`) | GNU Library GPL 2.0 or later, as stated in the retained headers; `licenses/LGPL-2.0.txt` |
| Micro3D implementation (`com/mascotcapsule/micro3d/v3`) | MIT; copyright 2026 Yury Kharchenko and/or Roman Lahin; `licenses/MIT-micro3d.txt` |
| Vodafone `ResourceOperator` / `ResourceOperatorManager` | Apache-2.0; copyright 2020 Yury Kharchenko; `licenses/Apache-2.0.txt` |
| Yamaha ADPCM routines | Source credits public-domain code from https://github.com/superctr/adpcm |

`NOTICE.txt` collects the original copyright/license comments, including JavaLayer
and ASM contributor notices, and is included in both emulator JARs with the full
license texts. `python notices.py --check` verifies this collection against the
vendored source. The original files retain all notices. No vendor SDK binaries or
device firmware are included.

License text sources: https://www.apache.org/licenses/LICENSE-2.0.txt,
https://github.com/spdx/license-list-data/blob/main/text/LGPL-2.0-only.txt,
https://opensource.org/license/mit. JavaLayer's headers allow later versions;
the LGPL-2.0 filename records the earliest version, not an "only" restriction.

## openDoJa

- Source: https://github.com/GrenderG/openDoJa
- Snapshot commit: `0eb46a3905733458d1f7ded49cd1ba8dcc93511f`
- License: GPL-3.0; full text at `vendor/openDoJa-master/LICENSE`.
- Only the necessary Java source files and license are vendored.
- `build_ogl.py` generates changes under `build/ogl-src/`: software-only backend,
  shared framebuffer bridge, explicit unsupported API errors, color masks,
  secondary-texture limitation notices and perspective-triangle fog.

`UPSTREAM.json` lists every vendored input and its SHA-256, as well as original
snapshot archive hashes. These archives themselves are not distributed here.

## CheerpJ 4.3 (external runtime)

https://cheerpj.com/docs/licensing

Powered by CheerpJ, developed by Leaning Technologies. The web page loads the
runtime from `https://cjrtnc.leaningtech.com/4.3/loader.js`. CheerpJ is separately
licensed; it is not bundled, sublicensed under GPL, or mirrored by this project.
Personal and eligible FOSS projects can use the Community License with appropriate
credits. Self-hosting and redistribution of the CheerpJ runtime require separate
rights. Check the current provider terms for your deployment.

## Distribution

`web/audio.mjs` implements original procedural oscillators and percussion, plus
PCM playback. It includes no soundfont, sampled instruments, game audio or device
ROM data. MLD-to-MIDI/PCM decoding uses the retained FreeJ2ME-Plus implementation;
decoded application audio stays in the user's browser. Web Audio is a browser API,
not an additional bundled library.

When distributing built emulator JARs or serving them to browsers, provide the
corresponding source, build scripts, vendored sources and license notices for
that exact version. Link prominently to that source alongside the binaries.
`package.py` creates a distribution including those sources.

Generated modified Java files carry a modification notice dated 2026-09-21.
Vendored inputs remain byte-for-byte identical to the recorded snapshots.

This project supplies no commercial applications, recovered saves, game images,
music or decompiled game source. The small test application is original source
written for automated verification and is compiled only into ignored build output.
