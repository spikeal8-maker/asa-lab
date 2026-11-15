---
task_id: TASK-ELECTRONICS-PHOTORESISTOR-LIVE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Update photoresistor illumination during simulation

Changing the light slider currently changes the document identity used by the
workbench and restarts the entire simulation. Route the selected photoresistor's
effective illumination through the existing timed input queue. Preserve the
active clock, circuit state, project revision, and existing GL5528 class curve.

The regression must advance a 3 V battery circuit with a photoresistor and LED
in series and an independently lit parallel branch. Sweep light in both
directions, check resistance and optical response, and verify that the
controller stays in the same generation with no new preflight. Reject invalid
illumination events and events targeting another component type. Use the
existing photoresistor browser journey and check the owner's LED circuit before
integration. No installation or live database changes.
