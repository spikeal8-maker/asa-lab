# VSCR-D0-001A — canonical ASA brand asset for Visual Programming host

**Status:** owner decision / normative addendum  
**Date:** 11 September 2026  
**Amends:** `VSCR-D0-001-SCRATCH-HOST-CONTRACT.md` §§4–5 and M1-002 branding acceptance

This addendum closes the remaining asset-identity ambiguity in the ASA Scratch host design.
It does not authorise M1 coding by itself.

---

## 1. Decision

The Scratch logo is not used as ASA Lab product chrome.

The Visual Programming runtime uses the existing canonical ASA Lab logo asset:

```text
apps/web/public/asa-lab-mark.svg
```

This repository file is the source of truth for the mark shown in the ASA Scratch host.

M1-002 MUST NOT create or maintain a separately drawn `asa-blocks-mark.svg` whose artwork
can diverge from the main ASA Lab product mark.

---

## 2. Runtime packaging

The runtime image copies the canonical source asset deterministically, for example:

```text
apps/web/public/asa-lab-mark.svg
    ↓ Docker COPY
/usr/share/nginx/html/assets/asa-lab-mark.svg
```

The runtime-local output filename may differ for packaging reasons, but its bytes must come
from the canonical repository asset. There must be no independently editable second SVG
source for the same ASA product mark under `infra/scratch-editor/**`.

A build/test assertion must fail if the expected canonical source is missing.

---

## 3. Scratch host behaviour

The already approved minimal host-logo compatibility patch remains the mechanism for
replacing the upstream MenuBar logo source.

Required result:

```text
Scratch logo rendered in product chrome: NO
ASA Lab canonical mark rendered:         YES
logo navigation to scratch.mit.edu:       NO
Scratch account/community product chrome: NO
upstream licenses/NOTICE retained:        YES
```

A no-op Scratch logo click handler is not sufficient. The Scratch mark itself must not be
shown as the ASA product logo.

The Scratch name may appear only where factual compatibility or legally required
attribution is appropriate, for example:

```text
совместимо с проектами Scratch 3 (.sb3)
```

Nothing in the ASA UI may imply that ASA Lab is an official Scratch Foundation product.

---

## 4. M1-002 acceptance amendment

In addition to the existing D0-001 acceptance list, browser/Docker evidence must prove:

```text
1. the rendered product logo is the canonical ASA Lab mark;
2. the build copies that mark from apps/web/public/asa-lab-mark.svg;
3. no independently maintained second ASA mark exists for the Scratch host;
4. no Scratch logo remains in rendered product chrome;
5. the logo cannot navigate to scratch.mit.edu;
6. the two-authorised-patch ceiling remains unchanged.
```

Source grep alone is insufficient; browser DOM/network evidence is required.

---

## 5. Production default media remains separate

This logo decision does not authorise Scratch trademark media as the production default
project.

The upstream default project/assets may remain a non-user-facing compatibility fixture in
M1 while `blocks` is `coming_soon`. Before activation, default project/library media must be
ASA-owned/right-cleared (or intentionally empty) unless a separate explicit rights review
says otherwise.
