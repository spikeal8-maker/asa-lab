# Tinkercad Reference Facts for ASA Lab

**Verified:** 2026-07-27.  
**Purpose:** separate externally verified reference behavior from owner-required ASA Lab behavior and assumptions.

This document is not a license to copy trademarks, source code or protected assets. It records product patterns that the parity specification must reproduce independently.

---

## 1. Verified current reference facts

### 1.1. Multiple creative environments

Tinkercad presents itself as a web application for:

- 3D design;
- Circuits/electronics;
- Codeblocks;
- Sim Lab/physics-oriented creation.

Sources:

- https://www.tinkercad.com/learn/
- https://www.tinkercad.com/codeblocks
- https://www.tinkercad.com/simlab

### 1.2. Classroom code join

Tinkercad exposes a `Join Class` flow where a learner enters a code supplied by a teacher.

Source:

- https://www.tinkercad.com/joinclass

### 1.3. Classroom control and visibility

Autodesk describes Tinkercad Classrooms as simplifying student sign-on and providing control and visibility of student activity. The product surface advertises:

- assigning class activities;
- monitoring progress;
- inviting co-teachers to moderate;
- compatibility with classroom ecosystems.

Source:

- https://www.tinkercad.com/ipad-app

### 1.4. Accountless/nickname classroom participation

Autodesk's Children's Privacy Statement states that a student may join a teacher-moderated Tinkercad Classroom with an existing account or without registering, using a nickname provided by the teacher.

Source:

- https://www.autodesk.com/company/legal-notices-trademarks/privacy-statement/childrens-privacy-statement

### 1.5. Safe Mode and private-by-default child projects

Autodesk documents that:

- Safe Mode is enabled by default for newly created child accounts;
- it is enabled by default when an educator creates a Classroom;
- users joining such a Classroom inherit Safe Mode while the educator leaves it enabled;
- child designs are private by default;
- while Safe Mode is enabled, a child cannot publicly share designs.

Source:

- https://www.autodesk.com/company/legal-notices-trademarks/privacy-statement/childrens-privacy-statement

### 1.6. Public content and likes subject to moderation

The same privacy statement says eligible children may post designs and like other users' content, subject to parental/school moderation settings.

Source:

- https://www.autodesk.com/company/legal-notices-trademarks/privacy-statement/childrens-privacy-statement

### 1.7. Community gallery by module

Tinkercad has a Community gallery with module categories including:

- 3D Designs;
- Circuits;
- Codeblocks.

The gallery supports remix-oriented discovery/filtering.

Source:

- https://www.tinkercad.com/things?sort=copies

### 1.8. Published project page and remix lineage

A public Tinkercad project page can show:

- project preview;
- author;
- description;
- tags;
- edited/created dates;
- remix lineage;
- remix count;
- copy action for another user.

Example source:

- https://www.tinkercad.com/things/ixzh9EFchgh

### 1.9. View and tinker with copies

Tinkercad's Codeblocks material explicitly describes sharing creations so others can view and tinker with copies.

Source:

- https://www.tinkercad.com/codeblocks

### 1.10. Teacher-assigned badges

Tinkercad documents that Design & Make skill badges can be manually assigned to students by teachers in classrooms and appear on the student's dashboard.

Source:

- https://www.tinkercad.com/design-make

---

## 2. Owner-required ASA Lab parity behavior

The following behavior is explicitly required by the ASA Lab owner even when the public reference source does not expose enough implementation detail for independent verification:

- teacher opens and reviews student work;
- teacher comments on work and asks for changes;
- public or permitted project comments;
- portfolio/feed-like presentation of published work;
- project visibility controlled so homework is not accidentally public;
- public links and publication;
- project duplication/remix;
- multiple subject modules using one account/project system;
- teacher creates own demonstration projects outside classes;
- published projects are visible to other allowed users;
- registered/eligible users may publish while StudentSeat/Safe Mode users cannot.

These requirements are normative for ASA Lab and are defined precisely in `TINKERCAD_PARITY_SPEC.md`.

---

## 3. Facts not yet sufficiently verified

Before claiming exact parity for a feature, the implementation team must capture current reference screenshots or official documentation for:

- exact public-comment UI and permissions;
- exact project visibility names and transitions;
- teacher live-view versus version-view behavior;
- exact assignment creation and distribution UI;
- exact project-card context menu;
- exact profile tabs and collection behavior;
- collaboration/invite permissions;
- moderation queue behavior.

Unknown details must not be invented silently. Record them as a pending reference investigation or an owner-approved deviation.

---

## 4. Reference evidence workflow

For each parity surface:

1. capture current reference screenshots/video with date;
2. record visible controls and navigation;
3. record roles and permission conditions;
4. record negative behavior;
5. map to ASA Lab screen/use cases;
6. add any difference to `TINKERCAD_PARITY_DEVIATIONS.yaml`;
7. obtain owner decision before changing the flow.
