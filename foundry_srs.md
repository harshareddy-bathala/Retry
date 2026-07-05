# Software Requirements Specification
## Foundry — College Project Archival, Collaboration, and Evaluation Platform

| Field | Detail |
|-------|--------|
| Version | 1.0 |
| Date | June 2026 |
| Status | Draft |
| Team Size | 5 members |
| Target Timeline | 12 months |

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Problem Statement](#2-problem-statement)
3. [User Roles and Characteristics](#3-user-roles-and-characteristics)
4. [Functional Requirements](#4-functional-requirements)
   - 4.1 Authentication and Onboarding
   - 4.2 Student Profile
   - 4.3 Project Posts
   - 4.4 Lineage and Fork System
   - 4.5 Feed and Discovery
   - 4.6 AI Grading System (Human-in-Loop)
   - 4.7 Collaboration Rooms
   - 4.8 Idea Hub
   - 4.9 Social Features
   - 4.10 Team Collaboration
   - 4.11 Faculty Panel
   - 4.12 Alumni Access
   - 4.13 Notification System
5. [Non-Functional Requirements](#5-non-functional-requirements)
6. [External Interface Requirements](#6-external-interface-requirements)
7. [System Architecture Overview](#7-system-architecture-overview)
8. [Data Model Overview](#8-data-model-overview)
9. [Constraints and Assumptions](#9-constraints-and-assumptions)
10. [Out of Scope — Version 1](#10-out-of-scope--version-1)
11. [Appendix](#11-appendix)

---

## 1. Introduction

### 1.1 Purpose

This Software Requirements Specification (SRS) defines the complete functional and non-functional requirements for **Foundry**, a college project archival, collaboration, and evaluation platform. This document is the authoritative reference for the development team and governs what the system must do in version 1.

### 1.2 Document Conventions

Requirements are identified by unique IDs in the format `FR-[MODULE]-[NUMBER]`.

**Priority levels:**
- **P1** — Must be complete before public launch
- **P2** — Must be complete within the 12-month development window
- **P3** — Aspirational; include only if time permits

### 1.3 Definitions and Abbreviations

| Term | Definition |
|------|------------|
| Post | A project entry created by a student documenting something they have built |
| Fork | Deriving a new project post from an existing one, with a mandatory written rationale |
| Lineage | The directed tree of parent–child relationships formed by forks of a project |
| Idea Hub | A tab containing unbuilt project ideas and feature requests for existing projects |
| FR | Feature Request — a community suggestion to extend an existing project |
| AI Grading | Automated project analysis against a faculty-defined rubric |
| Human-in-Loop | The faculty review and approval step that must occur before a grade is visible to students |
| DAG | Directed Acyclic Graph — the data structure representing project lineage |
| AST | Abstract Syntax Tree — used to analyse code quality during grading |
| Room | A persistent 2D collaborative workspace where a team works together during the building phase of a project, independent of any post |
| Proximity | The server-detected closeness between two avatars in a room that determines whether their audio/video is connected |
| Demo URL | An optional external link a student attaches to a post (e.g. a Vercel or Render deployment); a copy is frozen as `frozen_demo_url` at submission time and never changes afterward |

---

## 2. Problem Statement

Engineering college students build many projects throughout their academics, but these projects exist in silos:

- Final year projects go into a physical library and are never opened again.
- Most work lives on personal hard drives or unannounced GitHub repositories that nobody at the college knows about.
- Junior students have no visibility into what their seniors built, so they either repeat generic ideas or start from scratch without any reference point.
- Faculty and interviewers evaluate the same common project ideas year after year because there is no channel connecting past work to current students.
- Students do not have a clear picture of what a weekend project, mini project, or final year project should look like — because they have never seen enough examples.

**Foundry solves this by creating a living archive.** Students post projects throughout their academics, not only at graduation. The archive builds institutional memory. Junior students can see, fork, and build on senior work. Faculty get AI-assisted tools to evaluate and track originality. The whole college — across departments — becomes visible and collaborative.

---

## 3. User Roles and Characteristics

### 3.1 Student

The primary user of the platform. Any currently enrolled student.

**Can do:**
- Register and create a profile
- Create, edit, publish, and delete their own project posts
- Fork any public project with a written rationale
- Add teammates to posts
- Submit posts for grading
- Create and join Collaboration Rooms; attach an external demo URL to posts
- Browse the feed across all departments
- Upvote, comment, save posts
- Post and claim ideas in the Idea Hub
- Suggest Feature Requests on any post

**Cannot do:**
- View AI grade suggestions before faculty approval
- Edit a post that is in Submitted state (must withdraw first)
- Join a Collaboration Room without an invitation from a member
- Access the faculty grading panel

---

### 3.2 Faculty / Evaluator

A teaching staff member responsible for evaluating student projects.

**Can do:**
- All student read capabilities (feed, posts, lineage, Idea Hub)
- Define and manage grading rubrics
- Trigger AI grading on submitted projects
- View AI-generated grade suggestions before they are released
- Approve AI grades as-is, modify individual criterion scores (with reason), or override entirely with a manual grade
- Post comments on any student project
- Assign mandatory submission tasks to a batch with deadlines
- View lineage trees for plagiarism and originality context
- Export grade reports as CSV

**Cannot do:**
- Create project posts
- Join or view student Collaboration Rooms (rooms are private to their members)

---

### 3.3 Alumni

A former student whose academic tenure has ended. Account migrated from student account by admin.

**Can do:**
- View all public posts, feed, lineage views, and Idea Hub
- Upvote posts
- Post comments (displayed with an "Alumni — Class of [Year]" badge)
- Post Open Ideas in the Idea Hub
- View demo URLs attached to posts

**Cannot do:**
- Create project posts
- Claim ideas or fork projects
- Access grading features
- Create or join Collaboration Rooms (rooms are for active student teams)

---

### 3.4 System Administrator (Technical Role)

An implicit technical role, not a public-facing user persona.

**Can do:**
- Manage user accounts (activate, suspend, reset passwords)
- Configure department and batch metadata
- Monitor server health and Daily.co usage against free-tier limits
- Migrate student accounts to alumni on batch graduation

---

## 4. Functional Requirements

---

### 4.1 Authentication and Onboarding

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-AUTH-01 | The system shall allow registration only with a college email address. Email domain validation must be enforced at signup. | P1 |
| FR-AUTH-02 | On registration, a one-time verification link must be sent to the college email. The account is inactive until the link is clicked. | P1 |
| FR-AUTH-03 | The system shall use JWT-based session management. Access tokens expire in 7 days; refresh tokens in 30 days. | P1 |
| FR-AUTH-04 | On first login, students must complete an onboarding form: full name, department, batch year (e.g. 2023–2026), current semester, and a short bio. | P1 |
| FR-AUTH-05 | Faculty accounts shall be created by the system administrator and verified via college email. Faculty cannot self-register. | P1 |
| FR-AUTH-06 | Alumni accounts shall be created by the administrator when a student batch graduates. Alumni accounts retain all posts and profile history. | P2 |
| FR-AUTH-07 | Role-based access control (RBAC) must be enforced at the API layer. Roles: Student, Faculty, Alumni, Admin. Frontend-only role checks are not sufficient. | P1 |
| FR-AUTH-08 | Password reset must be supported via a time-limited link sent to the college email. | P1 |

---

### 4.2 Student Profile

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-PROFILE-01 | Each student shall have a public profile page displaying: name, department, current semester, batch year, bio, profile picture, and a grid of all their published posts. | P1 |
| FR-PROFILE-02 | The profile shall show a "Skills" section auto-generated from tech stack tags across all the student's posts. This is not self-edited — it is derived from post data. | P2 |
| FR-PROFILE-03 | The profile shall display lineage contribution stats: projects started (root posts), forks made by this student, and times this student's projects were forked by others. | P2 |
| FR-PROFILE-04 | Students shall be able to follow other students. A "Following" and "Followers" count appears on the profile. Following affects feed personalisation. | P2 |
| FR-PROFILE-05 | The profile shall have a "Saved" tab showing all posts the student has bookmarked. Visible only to the profile owner. | P2 |

---

### 4.3 Project Posts

#### 4.3.1 Post Creation and Editing

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-POST-01 | A student shall be able to create a project post with the following **required fields**: title (max 80 characters), description (min 100 characters), project type (Weekend Project / Mini Project / Final Year Project), department, and semester built in. | P1 |
| FR-POST-02 | A post shall support the following **optional fields**: GitHub repository URL, tech stack tags (multi-select from a predefined list, with free-form addition), domain tag (single select from the same list used in rooms: Education, Healthcare, Fintech, Logistics, Government, Social, Productivity, Other), cover image, demo video URL (external link only), and a demo/live URL — an external link to wherever the student has deployed the project (Vercel, Render, Railway, or any other service). | P1 |
| FR-POST-03 | Post descriptions shall support Markdown formatting with rendered preview. | P2 |
| FR-POST-04 | Posts shall follow a state machine: **Draft → Published → Submitted → Graded**. Transitions: student can move Draft ↔ Published freely; Submitted requires explicit "Submit for Grading" action; Graded is set by faculty approval. | P1 |
| FR-POST-05 | A post in Submitted state is locked for editing. On this transition, the current value of the demo URL (FR-POST-02) is copied to a read-only `frozen_demo_url` field — a plain string copy with no infrastructure involved. The student may withdraw the submission (reverting to Draft); the frozen demo URL is retained regardless. | P1 |
| FR-POST-06 | Each post shall have a unique, URL-slug-based shareable link (e.g. `/posts/smart-attendance-system-harsha-2025`). | P1 |
| FR-POST-07 | Students shall be able to delete their own posts in Draft or Published state. Posts in Submitted or Graded state cannot be deleted without admin intervention. | P1 |
| FR-POST-08 | The post's Draft view shall display a non-blocking **Readiness Checklist** with the following rule-based checks: title set, description meets minimum length, at least one tech stack tag added, GitHub URL provided, demo URL provided, and at least one accepted team member. Each item shows a completion indicator. The checklist is informational only — no item prevents publishing. It disappears once the post is Published. | P1 |

#### 4.3.2 Post Display

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-POST-09 | The post card (shown in feeds and search) shall display: cover image (if present), title, author name + avatar, department, semester, project type badge, domain tag (if set), tech stack tags, upvote count, comment count, and a "Live Demo" button if a demo URL is provided. | P1 |
| FR-POST-10 | The post detail page shall show: full description, GitHub link, team members section, and a "Part of Lineage" section showing the direct parent post and the fork rationale if applicable. | P1 |
| FR-POST-11 | Graded posts shall display a grade badge (e.g. "Excellent / Good / Needs Improvement") visible to all users. The detailed rubric breakdown (scores per criterion, feedback, similarity score) is visible only to the post author and faculty. | P2 |
| FR-POST-12 | The post detail page shall show a mini lineage tree if the project has a parent or any children forks. Clicking a node navigates to that post. Full lineage view opens in a dedicated page. | P2 |

---

### 4.4 Lineage and Fork System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-LINEAGE-01 | Any authenticated student shall be able to fork any published project post. Forking requires a **mandatory rationale** field (minimum 50 characters) explaining what the student intends to change, improve, or add. | P1 |
| FR-LINEAGE-02 | Forking creates a new post in Draft state, pre-filled with the parent's title (appended with " — fork"), department, and tech stack. All fields remain editable. The `parent_post_id` foreign key is set and immutable after creation. | P1 |
| FR-LINEAGE-03 | Project lineage shall be stored as a Directed Acyclic Graph (DAG) in PostgreSQL using a `parent_post_id` self-referencing foreign key. A post may have at most one parent but unlimited children (forks). | P1 |
| FR-LINEAGE-04 | The system shall expose a lineage traversal API that, given any post ID, returns all ancestors (upward traversal) and all descendants (downward traversal) with depth metadata, using recursive CTEs. This API powers both the lineage visualiser and the plagiarism detection component. | P1 |
| FR-LINEAGE-05 | A dedicated full lineage view page shall display the complete family tree of a project as a visual directed graph. Nodes are post cards; edges represent forks. Node colour indicates project type. | P2 |
| FR-LINEAGE-06 | Cross-department forking is permitted. A cross-department fork is tagged with both departments and surfaced in interdepartmental discovery. | P1 |
| FR-LINEAGE-07 | Each post card shall display a fork count. A "Forked from [Parent Title]" attribution link shall appear on forked posts. | P1 |

---

### 4.5 Feed and Discovery

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FEED-01 | The default feed shall be a personalised algorithmic feed. Ranking signals shall include: recency, upvote velocity (upvotes per hour since posting), comment count, department match, semester proximity (prefer posts from students within 2 semesters), and activity from followed users. | P1 |
| FR-FEED-02 | The feed shall support five named view modes selectable by the user: **For You** (algorithmic), **Department** (only own department), **Discover** (cross-department, ranked by upvote velocity), **Trending** (top upvoted posts in the last 7 days), **Latest** (strict reverse chronological). | P1 |
| FR-FEED-03 | The feed shall support composable filters: department, project type, tech stack tag, domain tag, semester built in, and batch year. Active filters persist within a session. | P1 |
| FR-FEED-04 | The feed shall implement infinite scroll, loading a minimum of 20 posts per page. | P1 |
| FR-FEED-05 | The feed shall include a "From Your Seniors" section that surfaces 3–5 recently published posts from students who are at least 2 semesters ahead in the same department. This section is pinned above the main feed. | P2 |
| FR-FEED-06 | Feed ranking scores shall be computed periodically (every 15 minutes) and cached in Redis. The feed is not recomputed on every request. | P2 |

---

### 4.6 AI Grading System (Human-in-Loop)

This is the most sensitive module. The design principle is: **AI proposes, faculty decides.** No grade is ever released to a student without explicit faculty approval. This ensures accuracy and gives faculty full control.

#### 4.6.1 Rubric Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-GRADE-01 | Faculty shall be able to create named grading rubrics. A rubric is a list of criteria, each with a name, a description of what is being evaluated, and a maximum point value. | P1 |
| FR-GRADE-02 | Rubrics can be **global** (applied to all submissions in a department by default) or **assignment-specific** (tied to a specific mandated submission task). | P1 |
| FR-GRADE-03 | A default system rubric shall be pre-loaded and available for immediate use: Code Quality (20 pts), Documentation (20 pts), Technical Complexity (20 pts), Originality (20 pts), Working Demo (20 pts). Faculty may modify this rubric. | P1 |
| FR-GRADE-04 | Faculty shall be able to clone an existing rubric and modify the copy, to reduce setup time for similar assignments. | P2 |

#### 4.6.2 AI Grade Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-GRADE-05 | When a student transitions a post to Submitted state, the system shall automatically enqueue an AI grading job. | P1 |
| FR-GRADE-06 | The AI grading engine shall use the following inputs: cloned GitHub repository (for AST analysis), README and documentation text, post description, project type, tech stack tags, demo URL (if present), and the lineage ancestor chain (for originality scoring). | P1 |
| FR-GRADE-07 | The AI grading engine shall produce structured output containing: a numeric score per rubric criterion, a written justification per criterion (max 100 words each), an overall summary paragraph, and a plagiarism similarity score. | P1 |
| FR-GRADE-08 | Code quality analysis shall use Tree-sitter to parse the repository. Evaluated signals: average function length, cyclomatic complexity per function, comment-to-code ratio, presence of hardcoded values (secrets, URLs, magic numbers), and presence of error handling patterns. | P2 |
| FR-GRADE-09 | Originality scoring shall use vector embeddings (pgvector) of the project's code and documentation. Cosine similarity is computed against all posts in the lineage ancestry chain. A similarity score above a configurable threshold (default: 0.85) triggers a plagiarism flag visible to faculty in the grading UI. | P1 |
| FR-GRADE-10 | AI grading jobs shall complete within 5 minutes under normal load. A timeout of 10 minutes shall trigger a failure state, notifying faculty that manual grading is required for that submission. | P1 |
| FR-GRADE-11 | If the GitHub URL is absent or inaccessible, the AI grading engine shall grade only on available inputs (post description, tags, demo URL) and indicate which criteria were scored with limited data. | P1 |

#### 4.6.3 Human-in-Loop Approval Flow

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-GRADE-12 | AI-generated grades shall be visible only to faculty until explicitly approved. Students see status "Under Review — your faculty member will release the grade shortly." | P1 |
| FR-GRADE-13 | Faculty shall see a grading review screen showing: the AI-generated score per criterion, the written justification per criterion, the overall summary, and the plagiarism similarity score with a highlighted warning if above threshold. | P1 |
| FR-GRADE-14 | Faculty shall have three actions available on the review screen: **(a) Approve as-is** — release the AI grade unchanged. **(b) Modify** — change one or more criterion scores; a required text field captures the override reason for each modified criterion. **(c) Override entirely** — discard AI grade and enter a fully manual grade with comments. | P1 |
| FR-GRADE-15 | Upon faculty approval (any of the three actions), the final grade is released. The post displays a grade summary badge visible to all. The detailed breakdown is visible to the post author and faculty only. | P1 |
| FR-GRADE-16 | The grading audit trail shall be stored immutably: original AI grade, any criterion-level modifications with override reasons, faculty member who approved, and approval timestamp. This record is not editable after grade release. | P2 |
| FR-GRADE-17 | The student (and all accepted team members) shall receive an in-app notification and email when their grade is released. | P1 |

---

### 4.7 Collaboration Rooms

A collaboration room is a persistent 2D virtual workspace where a team of students can work together throughout the entire building phase of a project. Rooms are completely independent of posts — there is no link, automatic or manual, between a room and a post. A student creates a room whenever they want to start collaborating on something; a post is created separately, whenever a project is finished and ready to be shared. A student can be active in several rooms across several different projects and teams at the same time.

**Design principles:**
- Rooms are student-initiated and manually created. Nothing auto-creates a room.
- A student can create and be a member of as many rooms as they want, with no platform-imposed limit.
- Rooms persist indefinitely once created. Only the owner can delete a room, which is an explicit confirmed action.
- Room membership is independent of post team membership. A room's members do not need to match any post's team — rooms often exist long before any post does.
- The platform never mandates that real project work happens inside a room. Teams that meet in person, use WhatsApp, or work without ever opening a room are at zero disadvantage anywhere on Foundry. The room is an option, not a requirement.
- No audio or video is ever recorded or stored. No session timestamps or attendance history are kept. The only real-time data tracked is who is present right now, ephemerally.
- Every room has two views. **Workspace** (default — what the student sees on entry) shows project context, Blueprint, Build Journey, and the Kanban board. **Live Space** (opened on demand) has the 2D canvas, proximity audio/video, and whiteboard. A team can use Workspace indefinitely without ever opening Live Space.

#### 4.7.1 Room Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-01 | A student shall be able to create a room at any time from the Rooms tab. Required field: room name. Optional field: description. Room creation has no dependency on any post, assignment, or other entity. | P1 |
| FR-ROOM-02 | There is no limit on the number of rooms a student can create or be a member of. | P1 |
| FR-ROOM-03 | The room creator is the owner. Ownership can be transferred to any other member. The owner can rename the room, delete it, or remove members. Deleting a room requires explicit confirmation and permanently removes its chat, whiteboard, Kanban board, Blueprint, and Build Journey. | P1 |
| FR-ROOM-04 | The owner may invite other students by name or college email. Invitees receive an in-app notification and must accept to join. Declined invitations are not visible to other room members. | P1 |
| FR-ROOM-05 | Any member may leave a room at any time. The owner must transfer ownership before leaving. If the owner leaves without transferring, ownership passes to the longest-standing member. | P1 |
| FR-ROOM-06 | The Rooms tab shall list all rooms the student is a member of, sorted by most recent activity, showing: room name, member count, and time since last activity. | P1 |

#### 4.7.2 Live Presence

Live presence is ephemeral — it shows who is in a room right now, and nothing more. No session timestamps, no duration logs, no activity history of any kind.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-07 | The system shall track live presence per room: which members currently have an active WebSocket connection to the room. Presence updates in real time for all connected members. | P1 |
| FR-ROOM-08 | The Rooms tab shall display, for each room, the avatars or initials of members currently present, so a student can see who is active before joining. | P1 |

---

**Workspace — default view**

When a student enters a room, the first thing they see is the Workspace. Not avatars. The Workspace loads immediately and shows project context, Blueprint, Build Journey, and the Kanban board. The Live Space is a separate view opened on demand.

#### 4.7.3 Workspace View and Project Context

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-09 | On entering a room, the student shall land on the Workspace view by default. The Workspace displays a Project Context header showing: project name (editable inline), current stage (dropdown: Ideation / Planning / Building / Testing / Complete), and domain tag (single select from a predefined list: Education, Healthcare, Fintech, Logistics, Government, Social, Productivity, Other — same list used for post domain tags and feed filters). | P1 |
| FR-ROOM-10 | Any room member may edit the project context fields at any time. Changes are broadcast in real time to all connected members via WebSocket and persisted immediately. | P1 |

#### 4.7.4 Project Blueprint

The Blueprint is an entirely optional structured panel. It is never required, never checked for completeness, and has no effect on grading or any other platform feature. It exists as a shared thinking space for teams that find it useful. A team that leaves it completely blank is not penalised in any way.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-11 | Each room contains a Project Blueprint panel in the Workspace sidebar with three optional free-text fields: (1) What problem are we solving? (2) Who experiences this problem? (3) What already exists, and why is it not enough? All three fields may be left empty. | P1 |
| FR-ROOM-12 | Blueprint fields support collaborative real-time editing. Each field stores a lightweight edit log (user, timestamp, new value) so the team can see how their thinking evolved over time — this is for the team's own reference only, never shown to faculty or used in grading. | P2 |
| FR-ROOM-13 | If the room was created via fork-aware creation (FR-ROOM-16), Blueprint field 3 is pre-filled with a read-only copy of the ancestor post's description and its open Feature Requests as a starting reference. The student may clear and replace this at any time. | P2 |

#### 4.7.5 Fork-Aware Room Creation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-14 | At room creation, the student shall choose an origin: **New Project** (blank Workspace) or **Based on Existing Project** (fork-aware, pulls in ancestor context). | P1 |
| FR-ROOM-15 | If "Based on Existing Project" is chosen, the student searches and selects a published post as the ancestor. The Workspace then shows a read-only Ancestor panel containing the ancestor's title, tech stack, description, and open Feature Requests — captured as a snapshot at room creation time. This snapshot does not update if the ancestor post is later edited. | P1 |
| FR-ROOM-16 | At room creation (for either origin), the system shall run a tag-overlap SQL query against published posts: find posts sharing 2 or more tech stack tags with the room's domain tag. If any matches exist, the student sees a dismissable notice: "X published projects exist in this area — browse before you start?" with links. This is a plain SQL query with no AI or embeddings involved. | P2 |

#### 4.7.6 Build Journey

Build Journey is a fully automatic timeline. No team member ever writes a journal entry. All entries are generated from things the team is already doing inside the room.

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-17 | Each room has a Build Journey timeline that auto-generates entries from: room creation, each Blueprint field's first-ever edit (field name + new value as the entry text), stage changes in the project context header, and weekly Kanban "Done" card counts (e.g. "Week 4 — 5 tasks completed"). The timeline is visible to all room members. | P1 |

#### 4.7.7 Kanban Board

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-18 | Each room has a Kanban board with three default columns: To Do / In Progress / Done. An optional fourth column "Parked" is available for deprioritised or changed-direction cards. Default column names are editable by any member. | P1 |
| FR-ROOM-19 | Any member may create, edit, move, and delete cards. A card has: title, optional description, and optional assignee (one room member). | P1 |
| FR-ROOM-20 | Card movements and edits are broadcast via WebSocket so all members see changes in real time. | P1 |
| FR-ROOM-21 | When a card is moved to Done or Parked, a one-line optional note field appears inline on the card. The student may type a brief reason or dismiss without entering anything — it is never required. The note persists as a tooltip on the card. This is the only place a pivot or decision is informally recorded, and it is entirely opt-in. | P2 |

---

**Live Space — on demand**

Opened from the Workspace via a "Go to Live Space" button. Contains the 2D canvas, proximity audio/video, and the shared whiteboard. A team can use the Workspace indefinitely without ever opening Live Space.

#### 4.7.8 2D Canvas and Avatars

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-22 | Each room has a persistent 2D canvas environment rendered in the browser using Phaser.js. No downloads or plugins are required. | P1 |
| FR-ROOM-23 | V1 uses a single fixed room layout: a pixel-art tilemap with an open central area and individual desk zones around the perimeter. No custom map editor is provided in V1. | P1 |
| FR-ROOM-24 | Each member selects an avatar sprite from 6 preset options on first entry to Live Space. The selection persists per room per member. | P1 |
| FR-ROOM-25 | Avatars move using WASD or arrow keys with four-direction walking animation (up, down, left, right, idle). | P1 |
| FR-ROOM-26 | Avatar position (`userId`, `x`, `y`, `direction`) is broadcast via WebSocket to all members in the room on each movement. The server relays updates; no peer-to-peer sync. | P1 |
| FR-ROOM-27 | On disconnection and reconnection, the avatar returns to the member's last known position, or a default desk zone if none is stored. | P2 |

#### 4.7.9 Proximity Audio and Video

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-28 | Proximity detection runs server-side. Two avatars are "in proximity" when the Euclidean distance between their tile positions is below a configurable threshold (default: 5 tiles). | P1 |
| FR-ROOM-29 | The platform shall use Daily.co for all WebRTC audio and video. No custom WebRTC implementation shall be built. | P1 |
| FR-ROOM-30 | When two or more members enter proximity, the server notifies the Daily.co session to add them to a shared call. When they move apart, they are removed. Members in proximity see small video bubbles rendered as canvas overlays near their avatar. | P1 |
| FR-ROOM-31 | Members may mute/unmute audio and toggle video independently of their position. State persists until they change it. | P1 |
| FR-ROOM-32 | No audio or video is recorded or stored. Daily.co session data is ephemeral and exists only for the duration of the call. | P1 |

#### 4.7.10 Text Chat

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-33 | Each room has a persistent text chat panel accessible as a sidebar in both the Workspace and Live Space views. | P1 |
| FR-ROOM-34 | Chat messages are stored in PostgreSQL indefinitely and visible to any member who joins the room, including members added after messages were sent. | P1 |
| FR-ROOM-35 | Chat supports plain text only. No Markdown, file uploads, or reactions in V1. | P1 |
| FR-ROOM-36 | Chat history is permanently deleted only when the owner deletes the room. There is no automatic deletion and no export or transcript feature. | P1 |

#### 4.7.11 Shared Whiteboard

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ROOM-37 | Each room has one shared persistent whiteboard powered by tldraw (open-source). All members can draw, write, and add shapes simultaneously in real time. | P1 |
| FR-ROOM-38 | Whiteboard state is persisted in PostgreSQL as a tldraw document JSON. Changes are saved automatically and persist indefinitely. | P1 |
| FR-ROOM-39 | The whiteboard is accessible from Live Space via the whiteboard desk object in the canvas, or from the sidebar in both views. | P1 |

---

### 4.8 Idea Hub

The Idea Hub is a dedicated top-level tab containing two sub-sections: **Open Ideas** (unbuilt project ideas) and **Feature Requests** (improvement suggestions for existing posts). Both live in one tab, toggled by a selector.

#### 4.8.1 Open Ideas

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-IDEA-01 | Any authenticated user (Student, Faculty, Alumni) shall be able to post an Open Idea with: title, problem statement (min 80 characters), suggested approach (optional), suggested tech stack tags, and difficulty level (Easy / Medium / Hard). | P1 |
| FR-IDEA-02 | Open Ideas are ranked by upvote count within the sub-section. Upvotes are one-per-user-per-idea. | P1 |
| FR-IDEA-03 | A student may **claim** an Open Idea, indicating intent to build it. Only one student or team may hold the claim at a time. Claiming requires the student to link the idea to an existing Draft post or to create a new Draft post from the idea template. | P1 |
| FR-IDEA-04 | A claimed idea shows the claimer's name and a link to their draft post. The post author may unclaim at any time, returning the idea to Open status. | P1 |
| FR-IDEA-05 | When a claimed idea's linked post is Published, the idea transitions to **Built** status. The idea card links to the published post. Built ideas are archived separately and not shown in the default Open Ideas view. | P1 |
| FR-IDEA-06 | Open Ideas can be filtered by: department relevance, difficulty, tech stack, and claimed/unclaimed status. | P2 |
| FR-IDEA-07 | Faculty may pin ideas to the top of the Open Ideas list (for ideas aligned with curriculum). | P3 |

#### 4.8.2 Feature Requests

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-IDEA-08 | Any authenticated user may post a Feature Request on any published project post. A Feature Request requires: feature title, description (min 50 characters), and estimated scope (Weekend Project / Mini Project / Major Feature). | P1 |
| FR-IDEA-09 | Feature Requests are visible on the project's post detail page under a "Feature Requests" tab. | P1 |
| FR-IDEA-10 | The post author receives an in-app notification for each new FR on their post. | P1 |
| FR-IDEA-11 | The post author may **accept** an FR. Accepting creates a fork prompt: the system pre-fills a new post with the FR description as the fork rationale, maintaining the lineage chain. The FR card links to the resulting fork post. | P1 |
| FR-IDEA-12 | The AI system shall automatically generate 2–3 suggested Feature Requests for any published project with more than 300 lines of code. These are generated by analysing the codebase and comparing it against similar projects in the lineage. Auto-generated FRs are labelled "AI Suggested." The post author may dismiss them; dismissed FRs do not reappear. | P2 |
| FR-IDEA-13 | FR scope labels (Weekend / Mini / Major) are for guidance only, provided by the requester. The system does not enforce or validate scope claims. | P1 |

---

### 4.9 Social Features

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SOCIAL-01 | Any authenticated user shall be able to upvote a post. Each user may upvote a post exactly once. Upvotes are reversible (toggle). | P1 |
| FR-SOCIAL-02 | Any authenticated user shall be able to comment on a post. Comments support Markdown rendering. | P1 |
| FR-SOCIAL-03 | Comments shall support exactly one level of reply nesting. Replies to replies are not permitted. | P1 |
| FR-SOCIAL-04 | Post authors may delete their own comments and any comment on their own post. Faculty may delete any comment. | P1 |
| FR-SOCIAL-05 | Any authenticated user shall be able to save/bookmark a post. Saved posts appear in the "Saved" tab of the user's profile. | P1 |
| FR-SOCIAL-06 | Each post shall have a share button that copies the canonical post URL to the clipboard. | P1 |
| FR-SOCIAL-07 | Students shall be able to follow other students. Following is asymmetric (A follows B does not imply B follows A). Following affects the feed algorithm (FR-FEED-01). | P2 |

---

### 4.10 Team Collaboration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-TEAM-01 | When creating or editing a post, the student may search for and mention teammates by name or college email. Mentioned users receive an in-app notification. | P1 |
| FR-TEAM-02 | A mentioned user may accept or decline the team invitation. Only accepted team members appear in the "Team" section of the post card. Pending and declined invitations are not publicly visible. | P1 |
| FR-TEAM-03 | A post with accepted team members shall appear on each accepted member's profile under a "Team Projects" section, distinct from their personal posts. | P1 |
| FR-TEAM-04 | All accepted team members shall receive grade release notifications. | P1 |
| FR-TEAM-05 | Team members (non-authors) may comment on the post with an "Author" badge. They may not edit the post title, description, or submission state. | P2 |

---

### 4.11 Faculty Panel

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FACULTY-01 | Faculty shall have a dedicated panel accessible via a persistent navigation link, visible only to Faculty role accounts. | P1 |
| FR-FACULTY-02 | **Post Browser**: view all posts filterable by department, batch year, current semester, project type, and grading status (Unsubmitted / Submitted / Under Review / Graded). | P1 |
| FR-FACULTY-03 | **Grading Queue**: a prioritised list of all submitted projects awaiting grade review. Sorted by submission date ascending (oldest first). Shows submission count and average time-in-queue. | P1 |
| FR-FACULTY-04 | **Rubric Editor**: create, edit, clone, and manage grading rubrics as defined in FR-GRADE-01 through FR-GRADE-04. | P1 |
| FR-FACULTY-05 | **Assignment Manager**: create mandatory submission tasks for a batch. An assignment defines: title, description, linked rubric, project type requirement, and deadline. Students in the batch see an assignment banner on their dashboard. | P2 |
| FR-FACULTY-06 | **Lineage Viewer**: given any post, display the full DAG lineage tree for plagiarism and originality context before grading. | P2 |
| FR-FACULTY-07 | **Grade Export**: download grade reports as CSV, filterable by batch, department, assignment, or rubric. | P2 |
| FR-FACULTY-08 | Faculty may post public comments on any student project. These appear with a "Faculty" badge. | P1 |
| FR-FACULTY-09 | **Analytics Dashboard**: aggregate, read-only charts showing most-used tech stacks by department and batch, average grade distributions, fork activity trends over time, and Idea Hub usage statistics. | P3 |

---

### 4.12 Alumni Access

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-ALUMNI-01 | Alumni shall have read access to all published posts, the feed (all modes), lineage views, and the Idea Hub. | P1 |
| FR-ALUMNI-02 | Alumni may upvote posts and post comments. Comments display an "Alumni — Class of [Year]" badge. | P2 |
| FR-ALUMNI-03 | Alumni profiles retain all posts they created as students. Posts retain their original metadata and are clearly marked with the batch year during which they were posted. | P1 |
| FR-ALUMNI-04 | Alumni may post Open Ideas in the Idea Hub but may not claim ideas or fork existing projects. | P2 |

---

### 4.13 Notification System

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-NOTIF-01 | The system shall generate in-app notifications for: new comment on your post, new upvote milestone (10 / 50 / 100 upvotes), your post was forked, a mentioned teammate accepted your invitation, grade released, new Feature Request on your post, an Open Idea you posted was claimed, and a Collaboration Room invitation received. | P1 |
| FR-NOTIF-02 | Notifications shall be accessible from a notification bell icon in the navigation bar, showing unread count. | P1 |
| FR-NOTIF-03 | Email notifications shall be sent for: grade released, and assignment deadline reminders (72 hours and 24 hours before deadline). | P2 |
| FR-NOTIF-04 | Users shall be able to configure notification preferences per event type (toggle on/off). | P3 |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement |
|----|-------------|
| NFR-PERF-01 | Feed page initial load (first contentful paint) shall complete within 2 seconds on a college LAN connection (100 Mbps). |
| NFR-PERF-02 | Project post detail page shall load within 1.5 seconds. |
| NFR-PERF-03 | The 2D room canvas shall load and become interactive — avatar visible, movement responsive — within 3 seconds of joining a room. |
| NFR-PERF-04 | AI grading jobs shall complete within 5 minutes under normal load (fewer than 10 concurrent grading jobs). |
| NFR-PERF-05 | The system shall support 200 concurrent active users without response time degradation beyond 20% of baseline. |
| NFR-PERF-06 | Avatar position updates broadcast via WebSocket shall propagate to other room members within 150ms, to preserve a real-time movement feel. |

### 5.2 Scalability

| ID | Requirement |
|----|-------------|
| NFR-SCALE-01 | The BullMQ job queue for AI grading shall persist jobs across application restarts. Failed jobs shall be retried up to 3 times with exponential backoff (1 min, 5 min, 15 min delays). |
| NFR-SCALE-02 | The WebSocket room server shall be horizontally scalable using Redis pub/sub to broadcast position, chat, whiteboard, and Kanban events across server instances, so members of the same room can connect to different server nodes. |

### 5.3 Security

| ID | Requirement |
|----|-------------|
| NFR-SEC-01 | All HTTP communication shall use HTTPS/TLS. HTTP connections shall be redirected to HTTPS at the Nginx layer. |
| NFR-SEC-02 | Daily.co room tokens shall be scoped per-room and per-session. A member removed from a room or whose invitation is revoked shall lose access to that room's Daily.co session immediately. |
| NFR-SEC-03 | GitHub tokens, Anthropic API keys, and all secrets shall be stored encrypted at rest using AES-256. Secrets shall never appear in application logs or error messages. |
| NFR-SEC-04 | All user-submitted text content (post descriptions, comments, room chat) shall be sanitised before storage and re-sanitised on render to prevent stored XSS. |
| NFR-SEC-05 | RBAC checks shall be enforced at the API route middleware level. A student with a valid JWT must not be able to access faculty endpoints by manipulating request headers. |

### 5.4 Reliability

| ID | Requirement |
|----|-------------|
| NFR-REL-01 | The platform shall target 99.5% uptime during the academic year (August to May). Planned maintenance shall be scheduled outside business hours with 48-hour advance notice. |
| NFR-REL-02 | If a member's connection drops unexpectedly (browser crash, network loss), the room's persistent state (whiteboard, Kanban, chat, Blueprint, Build Journey) shall be unaffected. The member's live presence indicator clears automatically after 30 seconds of no heartbeat. |
| NFR-REL-03 | PostgreSQL data shall be backed up daily with a 30-day retention policy. |
| NFR-REL-04 | If the Anthropic API is unavailable, AI grading jobs shall enter a pending state and be retried automatically when the service recovers. Faculty shall be notified of delays exceeding 30 minutes. |

### 5.5 Usability

| ID | Requirement |
|----|-------------|
| NFR-USE-01 | A new student shall be able to create and publish their first project post within 10 minutes of completing onboarding, without reading any documentation. |
| NFR-USE-02 | The platform shall be accessible on mobile browsers. Minimum supported viewport width: 375px (iPhone SE). Core flows (reading the feed, viewing a post) must be fully usable on mobile. Post creation may use a simplified mobile form. Collaboration Rooms are desktop/laptop only (see Section 10). |
| NFR-USE-03 | The Rooms tab shall use plain-English presence language — "3 online now", "Last active 2 hours ago" — rather than raw timestamps or connection states. |

---

## 6. External Interface Requirements

### 6.1 User Interface

- Single-page application (SPA) built with React.
- Persistent top navigation bar: Feed, Rooms, Idea Hub, Notifications bell, Profile avatar (+ Faculty Panel link for faculty accounts).
- Feed uses a responsive card grid layout (2 columns on desktop, 1 on mobile).
- Lineage tree visualised with React Flow or D3.js (nodes = post cards, edges = fork relationships).
- Room view renders the Phaser.js canvas in a fixed-aspect-ratio container, with chat, whiteboard, Kanban, and the Activity log accessible as overlays/sidebars without leaving the canvas.
- Post editor uses a split-pane Markdown editor with live preview.

### 6.2 Software Interfaces

| System | Usage | Notes |
|--------|-------|-------|
| Anthropic API | AI grading — rubric scoring, feedback generation, FR suggestion | claude-sonnet-4-6 model |
| GitHub API | Repo access for AI grading (AST analysis, README, code) | OAuth token per student account |
| Tree-sitter | Multi-language AST parsing for code quality analysis | Node.js bindings |
| pgvector | Vector storage and cosine similarity for plagiarism detection | PostgreSQL extension |
| Daily.co API | WebRTC audio/video for proximity calls in Collaboration Rooms | Free tier; usage-based pricing beyond free minutes |
| tldraw sync | Real-time multiplayer whiteboard sync | Self-hosted open-source sync server (Node.js) |
| College SMTP server | Email notifications for grades and assignment deadlines | SMTP with TLS |

### 6.3 Infrastructure

**Primary infrastructure: DigitalOcean** (college server is a fallback/backup option).

| Resource | Specification | DigitalOcean Product | Estimated Cost |
|----------|--------------|---------------------|----------------|
| Main application server | 2 vCPU, 4 GB RAM, 80 GB SSD, Ubuntu 22.04 LTS | Basic Droplet | ~$24/month |
| Database | PostgreSQL 15, 1 vCPU, 1 GB RAM, 10 GB storage | Managed PostgreSQL (Basic) | ~$15/month |
| **Total** | | | **~$39/month** |

With $200 in DigitalOcean credits, the platform runs at full specification for approximately **5 months at zero cost** — comfortably covering the entire development and testing phase.

**Daily.co usage:** Daily.co's free tier covers a meaningful number of participant-minutes per month, sufficient for development and small-scale pilot use (a handful of 5-person rooms used regularly). If the platform sees heavy adoption across many simultaneous rooms, Daily.co usage may exceed the free tier and incur additional cost — this is the one variable cost in the architecture and should be monitored once real usage data exists.

**College server as backup:** If DigitalOcean credits expire and the college can provide a server (minimum 4 cores, 8 GB RAM, 100 GB SSD, Ubuntu 22.04 LTS), the application is portable — the API server, PostgreSQL, and the room/whiteboard sync services are all standard Node.js and Postgres processes with no cloud-specific dependencies.

---

## 7. System Architecture Overview

### 7.1 Component Summary

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| API Server | Fastify + TypeScript | REST API, business logic, authentication, RBAC |
| Database | PostgreSQL + pgvector extension | Persistent data, vector embeddings, lineage DAG, room/whiteboard/Kanban/chat state |
| Cache + Queue | Redis | Session cache, BullMQ job queue (AI grading), feed ranking cache, room event pub/sub |
| Room Server | Fastify WebSocket plugin | Avatar position broadcast, server-side proximity detection, Daily.co session orchestration, chat and Kanban event sync |
| Whiteboard Sync | tldraw sync server (self-hosted) | Real-time multiplayer whiteboard CRDT sync, persistence to PostgreSQL |
| Reverse Proxy | Nginx | TLS termination and routing for the main application domain |
| AI Grading Worker | Node.js (BullMQ consumer) | Anthropic API calls, Tree-sitter AST analysis, pgvector similarity |
| Frontend | React + TanStack Query + Phaser.js | SPA, 2D room canvas rendering, lineage tree visualiser |

### 7.2 Key Data Flows

**Post creation:**
Student submits form → API validates → stored in PostgreSQL → feed ranking cache invalidated → post appears in relevant feeds.

**Post submission (demo URL freeze):**
Student transitions post to Submitted → API copies the current `demo_url` value to `frozen_demo_url` (plain string copy, no infrastructure) → post status set to Submitted → AI grading job enqueued → faculty notified.

**Room session:**
Student opens a room → WebSocket connection established → live presence shown to other members → **Workspace loads as default view**: project context header, Blueprint panel, Build Journey timeline, Kanban board, and chat sidebar all render from PostgreSQL immediately → if Live Space button is clicked, Phaser.js canvas initialises, avatar spawns at last known position or default desk zone, position updates begin broadcasting → proximity detection runs on each position update → Daily.co session membership updated as members enter or leave proximity → whiteboard state loaded via tldraw sync server → on disconnect, live presence indicator clears after 30-second heartbeat timeout, all persistent state (whiteboard, Kanban, chat, Blueprint) remains unaffected.

**AI grading:**
Grading job dequeued → GitHub repo cloned → Tree-sitter AST analysis → pgvector similarity query against lineage ancestors → Anthropic API call with rubric, code quality signals, demo URL, and similarity data → structured grade JSON stored as pending → faculty notified → faculty reviews on grading screen → approves or modifies → grade released to student and team.

---

## 8. Data Model Overview

### 8.1 Core Entities

| Entity | Key Fields |
|--------|-----------|
| users | id, email, name, role, department, batch_year, semester, bio, avatar_url |
| posts | id, author_id, title, description, project_type, status, department, semester, domain, github_url, demo_url, frozen_demo_url, parent_post_id, created_at |
| grades | id, post_id, rubric_id, ai_scores (JSONB), ai_feedback (JSONB), ai_similarity_score, final_scores (JSONB), final_feedback, approved_by, approved_at, status (pending / approved / modified / manual) |
| rubrics | id, name, faculty_id, criteria (JSONB array of {name, description, max_points}), is_global, assignment_id |
| comments | id, post_id, author_id, parent_comment_id, body, created_at |
| upvotes | id, post_id, user_id, created_at |
| ideas | id, author_id, title, description, type (open_idea / feature_request), linked_post_id, target_post_id, claimed_by_id, status (open / claimed / built / stale), difficulty, scope, department_tags |
| team_members | id, post_id, user_id, status (pending / accepted / declined) |
| follows | id, follower_id, following_id, created_at |
| notifications | id, recipient_id, type, payload (JSONB), read, created_at |
| assignments | id, faculty_id, title, description, rubric_id, department, batch_year, deadline, project_type_required |
| rooms | id, name, description, owner_id, project_origin (new / fork), ancestor_post_id (nullable), ancestor_snapshot (JSONB — captured at creation), project_name, project_stage, project_domain, github_url, blueprint_problem, blueprint_audience, blueprint_existing, blueprint_history (JSONB), whiteboard_state (JSONB — tldraw document), created_at |
| room_members | id, room_id, user_id, role (owner / member), avatar_sprite, last_position (JSONB — {x, y, direction}), created_at |
| room_messages | id, room_id, sender_id, body, created_at |
| kanban_cards | id, room_id, column (todo / in_progress / done / parked), title, description, assignee_id, move_note (optional), position, created_at |

### 8.2 Lineage DAG Traversal

The `posts.parent_post_id` self-referencing foreign key forms the DAG. Traversal uses PostgreSQL recursive CTEs:

```sql
-- Get all descendants of a root post (full lineage tree downward)
WITH RECURSIVE descendants AS (
  SELECT id, parent_post_id, title, author_id, 0 AS depth
  FROM posts WHERE id = $rootId
  UNION ALL
  SELECT p.id, p.parent_post_id, p.title, p.author_id, d.depth + 1
  FROM posts p
  INNER JOIN descendants d ON p.parent_post_id = d.id
)
SELECT * FROM descendants ORDER BY depth;

-- Get all ancestors of a post (upward traversal for plagiarism scope)
WITH RECURSIVE ancestors AS (
  SELECT id, parent_post_id, title, 0 AS depth
  FROM posts WHERE id = $postId
  UNION ALL
  SELECT p.id, p.parent_post_id, p.title, a.depth + 1
  FROM posts p
  INNER JOIN ancestors a ON p.id = a.parent_post_id
)
SELECT * FROM ancestors ORDER BY depth;
```

### 8.3 Vector Embeddings for Plagiarism Detection

Each published post generates a vector embedding of its concatenated code (sampled) and documentation text, stored in a `post_embeddings` table with a `pgvector` column. On AI grading, the engine queries:

```sql
SELECT post_id, 1 - (embedding <=> $queryEmbedding) AS similarity
FROM post_embeddings
WHERE post_id = ANY($ancestorIds)
ORDER BY similarity DESC;
```

A similarity score ≥ 0.85 flags a potential plagiarism concern for faculty review.

---

## 9. Constraints and Assumptions

| Item | Detail |
|------|--------|
| College-internal only | All accounts require a valid college email. No public registration. |
| Single college deployment | Version 1 supports one college instance. Multi-tenancy is out of scope. |
| AI grading is advisory | Grades are never released to students without faculty approval. The AI is a first-pass tool. |
| Infrastructure is DigitalOcean-primary | Primary deployment target is a DigitalOcean Droplet using $200 in available credits (~5 months free at this lower spec). College server is a fallback. |
| GitHub is the only supported VCS | GitLab and Bitbucket support is deferred to a future version. |
| Rooms are optional and non-mandatory | No feature, grade, or platform behaviour penalises a student or team for not using Collaboration Rooms. Every platform function (posting, grading, feed, Idea Hub) works fully without a room ever being opened. |
| Rooms persist indefinitely | Once created, a room and all its data (chat, whiteboard, Kanban, Blueprint, Build Journey) remain until the owner explicitly deletes it. There is no idle-based cleanup and no session history is stored. |
| Development timeline | P1 features must be complete before the end of Month 10. P2 by end of Month 12. P3 is aspirational only. |

---

## 10. Out of Scope — Version 1

- Real-time co-editing of post content
- Video hosting (students provide external links only)
- Mobile native applications (iOS / Android)
- Integration with existing college LMS, ERP, or attendance systems
- Multi-college support
- Public-facing posts visible outside the college network
- GitLab or Bitbucket repository support
- In-platform code editor or IDE
- Direct messaging between students outside of Collaboration Rooms (room-scoped chat is in scope; platform-wide DMs are not)
- Custom room layouts, map editor, or multiple room templates (V1 ships one fixed layout)
- Meeting recordings, transcripts, or audio/video logs of any kind
- Collaboration Rooms on mobile browsers (avatar movement uses keyboard input; desktop/laptop only in V1)

---

## 11. Appendix

### 11.1 Project Type Definitions

| Type | Typical Duration | Team Size | Complexity |
|------|-----------------|-----------|------------|
| Weekend Project | 1–2 days | 1 developer | 1 core feature, minimal stack |
| Mini Project | 1–4 weeks | 1–2 developers | 3–6 features, authentication optional |
| Final Year Project | 3–12 months | 2–5 developers | Production-grade, multiple services, documented |

---

### 11.2 Default AI Grading Rubric

| Criterion | Max Points | What the AI Evaluates |
|-----------|-----------|----------------------|
| Code Quality | 20 | Function length, cyclomatic complexity, comment-to-code ratio, presence of hardcoded values, error handling patterns (via Tree-sitter AST) |
| Documentation | 20 | README completeness (setup instructions, feature list, usage, tech stack), inline code comments, demo description |
| Technical Complexity | 20 | Number of services and integrations, algorithms present, database schema complexity, presence of a demo URL |
| Originality | 20 | Cosine similarity against lineage ancestors (lower similarity = higher score), presence of features not found in parent posts |
| Working Demo | 20 | Demo URL (if provided) returns a successful response and the application loads without errors; if no demo URL is provided, scored on whether the README's setup instructions would let a reviewer run the project locally |

---

### 11.3 Post Status State Machine

```
[Draft] ──publish──→ [Published] ──submit──→ [Submitted] ──faculty approves──→ [Graded]
   ↑                      ↑                       │
   └──────unpublish────────┘             withdraw──┘
                                         (returns to Draft,
                                          frozen_demo_url preserved)
```

While in Draft state, the non-blocking Readiness Checklist (FR-POST-08) is visible to the author. It disappears once the post is Published.

---

### 11.4 Proximity Zones (Collaboration Rooms — Live Space)

Proximity detection (FR-ROOM-28) governs when Daily.co audio/video activates between two avatars.

| Distance (tiles) | State | Behaviour |
|-------------------|-------|-----------|
| 0–2 | Close proximity | Video bubble shown at full size; audio at full volume |
| 3–5 | In proximity | Video bubble shown smaller; audio present |
| 6+ | Out of range | No audio/video connection; avatars remain visible on canvas |

Proximity thresholds are server-configurable without a code deploy. Conversations start and end naturally as avatars move — no one needs to manually join or leave a call.

---

*End of Document — Foundry SRS v1.0*
