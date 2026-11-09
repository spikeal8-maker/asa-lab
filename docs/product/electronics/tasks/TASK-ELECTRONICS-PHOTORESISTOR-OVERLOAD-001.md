---
task_id: TASK-ELECTRONICS-PHOTORESISTOR-OVERLOAD-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Photoresistor overload failure

Use the GL5528-class electrical limits and the existing transient thermal
solver to model sustained photoresistor overload. A safe circuit must keep
conducting. An overloaded photoresistor must heat up, fail open and remain
open for the rest of the run. Report the failure through the existing
diagnostic and thermal presentation.

The slice owns the photoresistor solver branch, thermal profile selection,
and focused solver regression. Check safe, overloaded and recovered-input
scenarios in the solver, then verify the circuit in Chromium before
integration. The lamp's optical coupling is a separate slice.
