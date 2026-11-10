---
task_id: TASK-ELECTRONICS-PHOTORESISTOR-OPTICAL-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites: []
acceptance_boundary: slice
review: independent
---

# Illuminate a photoresistor from a lamp

Select an incandescent lamp and its distance in the photoresistor inspector.
The existing slider sets background light. The selected lamp adds light
according to its filament glow and the inverse-square law. The 0.65 cd
reference approximates the comparable 6.3 V, 250 mA miniature
[CEC 259](https://ceclighting.com/products/side-bar/bulb-shape.php?BULB=T-3+1%2F4).
A missing or burned-out lamp contributes no light.

Use the same resistance to solve the circuit and report measurements.
Keep old documents on their existing ambient light curve. Preserve the
pairing through save and reopen, remap it when copying the pair, and clear
it when deleting the lamp. The bounded editor scope includes the inspector,
stage readout, document operations and their result types.

Check the timed model, numerical quality and stable clock while the lamp
warms and cools. Verify the actual inspector and saved link in Chromium and
check the Arduino A0 reading with both its 5 V supply and an external 3 V
supply. Independent review is required before integration.
