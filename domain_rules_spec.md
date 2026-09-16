# Domain Rules Specification: Student Progress, Practice Queue & Evaluation Engine

> Archived reference. This document may contradict the active specification. Use the [active docs](../../index.md) for current requirements.


This document defines the core business logic governing student mastery tracking, activity queue progression, AI vs non-AI grading rules, hint penalties, and gamification/XP rewards for the learning system.

---

## 1. Mastery Tracking (`understandingRating`)

Student progress is measured by the **`understandingRating`** integer attribute (scale **1 to 5**) attached to each **`AtomicClaim`**.

### 1.1 Rating Scale & Mastery Goal
- **Initial State**: All newly imported or unstudied claims start at **Level 1**.
- **Mastery Target (Level 5)**: When a claim reaches **Level 5**, the student is considered to fully understand the topic/claim.
- **Queue Completion Drop**: Once an `AtomicClaim` reaches **Level 5**, all practice activities targeting that claim are automatically dropped from the active queue.

---

## 2. Activity Queue & Selection Mechanics

### 2.1 Multi-Topic Concurrent Study
- Students can study and progress through **multiple `WikiPage` topics simultaneously**.

### 2.2 Student-Initiated Queue Additions
- Students can manually generate and add practice activities to their queue from **any topic** of their choice at any time.

### 2.3 Automatic Progression Hierarchy
When automatically populating the practice queue:
1. The queue selects unstudied or unmastered `AtomicClaim`s from the **current active `WikiPage`**.
2. Once all claims on the current `WikiPage` reach Level 5, the queue automatically advances to claims on the **next `WikiPage`**.

### 2.4 Activity Ownership & Visibility Scopes
- **Teacher-Created Activities (`CLASSROOM_SHARED`)**:
  - When a Teacher creates or assigns an activity to a Classroom, it is automatically broadcast and added to the active `UserActivityQueue` of **all enrolled students** in that classroom.
  - Visible to all students in the classroom and to the managing teacher.
- **Student-Created Personal Activities (`STUDENT_PERSONAL`)**:
  - When an individual Student generates an activity for themselves, it is added **strictly to their personal queue**.
  - **Privacy Isolation**: No other student can see, access, or attempt another student's personal activity.
- **Teacher Diagnostic & Reporting Aggregation**:
  - All completed attempts and grades from **both** teacher-assigned activities AND student-created personal activities are aggregated into the teacher's classroom diagnostic dashboard and individual student progress reports (`getStudentActivityHistory`, `calculateStudentProgress`).

---


## 3. Activity Grading & Evaluation Rules

Grading is split between deterministic basic activities and AI-refereed complex activities.

### 3.1 Non-AI Basic Grading vs AI Evaluation
- **Basic / Simple Activities** (e.g. Multiple Choice, True/False, Keyword Match): Graded instantly and deterministically **without using AI**.
- **Complex Activities**: Evaluated via AI referee into **3 distinct outcomes**:
  1. **Understood** (Correct / Meets Rubric)
  2. **Did Not Understand** (Incorrect / Mistakes Made)
  3. **Neutral / Hint Condition** (Used assistance)

---

## 4. Rating Adjustment Rules

A student's `understandingRating` updates upon completing an activity according to activity difficulty and performance:

| Activity Difficulty | Outcome | Hints Used? | `understandingRating` Change |
| :--- | :--- | :---: | :---: |
| **Simple Activity** | **Understood (Correct)** | No | **`+1`** (max 5) |
| **Hard Activity** | **Understood (Correct)** | No | **`+2`** (max 5) |
| **Any Activity** | **Did Not Understand (Incorrect)** | No | **`-1`** (min 1) |
| **Any Activity** | **Got Everything Right** | **Yes (Used Hints)** | **`0` (Keeps current rating)** |
| **Any Activity** | **Made a Mistake** | **Yes (Used Hints)** | **`-1`** (min 1) |

---

## 5. Gamification & XP Award Mechanics

### 5.1 Completion Guarantee
- Completing any practice activity **always awards XP to the student**, even if they fail or make mistakes on the activity.

### 5.2 Daily Streak Counter (`streakDays`)
- Each user profile maintains a **`streakDays`** counter and a **`lastActiveDate`** timestamp.
- **Increment Rule**: Completing at least **one practice activity in a calendar day** increments `streakDays` by `+1` (or maintains the streak if an activity was already completed earlier the same day).
- **Reset Rule**: If a student misses a full calendar day without completing any activity, `streakDays` resets to `1` upon their next completed activity.

### 5.3 Daily Streak XP Boost
Completing an activity once a day grants an **XP Boost** scaled by their daily streak:

$$\text{XPAwarded} = (\text{BaseXP} + \text{PerformanceBonus} \times \text{DifficultyMultiplier}) \times \text{StreakBoostMultiplier}(\text{streakDays})$$

- **Base XP**: Guaranteed baseline reward for attempting and completing an activity.
- **Performance Bonus**: Higher bonus for `Understood` outcomes vs `Did Not Understand`.
- **Difficulty Multiplier**: Hard activities provide a significantly higher XP yield than simple activities.
- **Streak Boost Multiplier**: Multiplies total XP earned based on active `streakDays` (e.g., `1.0x` baseline, increasing by `+5%` per streak day up to a maximum `2.0x` cap).

---

## 6. Classroom Enrollment & Join Code Mechanics

### 6.1 Join Code Generation
- When a Teacher creates a `Classroom`, the system automatically generates a unique 6-character uppercase alphanumeric **`join_code`** (e.g. `QK7B9X`).

### 6.2 Student Self-Enrollment
- Students enter the 6-character `join_code` in their client dashboard to join a classroom.
- **Validation**:
  1. The system verifies `join_code` existence.
  2. The system checks if the student is already enrolled in the classroom.
  3. Upon validation, the student is added to `ClassroomStudent` and granted access to shared classroom resources.
- **Automatic Queue Sync**: Upon joining, all active teacher-assigned activities (`CLASSROOM_SHARED`) for that classroom are automatically appended to the student's `UserActivityQueue`.

---

## 7. User Roles & System Permissions

The system explicitly supports roles (`User.role`) for both classroom environments and standalone self-studiers:

1. **`TEACHER`**:
   - Can create classrooms (`createClassroom`), generating a unique 6-character `join_code`.
   - Can create and broadcast shared activities (`CLASSROOM_SHARED`) to all enrolled students.
   - Accesses teacher dashboards, student activity histories, and classroom diagnostic heatmaps (`getDiagnostic`).

2. **`STUDENT` (Classroom Enrolled)**:
   - Joins teacher classrooms via `join_code`.
   - Receives broadcast classroom activities in their `UserActivityQueue`.
   - Can also generate personal activities (`STUDENT_PERSONAL`) that are private to them but report performance to their enrolled teacher's progress reports.

3. **`INDIVIDUAL_LEARNER` (Independent Studier / "Regular User")**:
   - Default role for standalone users not affiliated with a teacher or classroom.
   - Has full access to source upload, evergreen wiki reading/editing, personal activity generation, 1–5 mastery tracking, daily streak counters, and XP gamification completely independently.
   - No classroom or teacher required.

---

## 8. Multi-Workspace & Notebook Isolation System

Users can create and manage multiple self-contained **Workspaces / Notebooks** (e.g. "Quantum Computing", "Linear Algebra", "Organic Chemistry").

### 8.1 Data & Scope Isolation
Selecting an active workspace filters system assets strictly to that workspace:
- **Sources & Evidence**: `SourceDocument`s belong to a specific workspace.
- **Evergreen Wiki & Claims**: `WikiPage`s, `AtomicClaim`s, and active study targets (`currentStudy`) are defined within a specific workspace context.
- **Practice Queue**: `UserActivityQueue` items are generated and filtered by the active workspace.
- **Chat Sessions**: Interactive conversation logs (`chatSessions`) and vector retrieval queries execute strictly within the active workspace.

### 8.2 Classroom Shared Workspaces vs Personal Workspaces
- **Shared Classroom Workspace**: When a Teacher creates a `Classroom`, the system automatically provisions a **Shared Workspace** (`is_classroom_shared = true`). All enrolled students gain access to its shared sources, wiki, and activities.
- **Personal Workspaces**: Students and individual learners can create unlimited private **Personal Workspaces** (`is_classroom_shared = false`) for their independent subjects.

### 8.3 Global vs Local User Progress Metrics
- **Local Scope (Workspace Level)**: Active study claims (`currentStudy`), chat history (`chatSessions`), atomic claim mastery ratings (Levels 1–5), topic mastery averages, practice queues, and review items are strictly scoped per workspace.
- **Global Scope (User Level)**: User authentication, role, total XP (`xpTotal`), User Level (`level`), and Daily Streak Counter (`streakDays`) remain **global** on the user profile across workspace switches.

---


## 9. AI Source Distillation & Wiki Consolidation Policy

When a new source document (PDF, transcript, notes) is uploaded to an active workspace, the system executes an automated distillation pipeline to incorporate new learning material into the workspace's evergreen wiki.

### 9.1 Vector Similarity & Consolidation Rules
1. **Extraction**: The `Textbook_Pipeline` normalizes, chunks, and extracts candidate topics and atomic claims (`ExtractionCandidate`).
2. **Vector Similarity Matching (`findMatchingWikiPage`)**:
   - For each candidate topic, the system computes its vector embedding and queries the active workspace's existing `WikiPage` embeddings.
   - **Threshold Rule**: Standard similarity threshold is set to **`0.82` cosine similarity**.
3. **Consolidation Actions**:
   - **High Similarity ($\ge 0.82$) $\rightarrow$ Update / Extend Existing Wiki Page (`applyWikiDelta`)**:
     - The candidate content is merged into the existing matching `WikiPage`.
     - New claims are appended to the page's claim list.
     - New source locators/anchors are attached as backing evidence.
     - The overview is incrementally updated without erasing existing verified distinctions.
   - **Low Similarity ($< 0.82$) $\rightarrow$ Create New Wiki Page (`createWikiPage`)**:
     - A new `WikiPage` is initialized in the active workspace with its extracted atomic claims and topic relationship edges.

### 9.2 Provenance Preservation
- Merging content into an existing `WikiPage` never overwrites historical ground-truth evidence; each atomic claim retains links to its specific `SourceAnchor` passage.

---

## 10. History-Aware Question & Distractor Generation Policy

To ensure high question variety and prevent repetitive options across practice attempts:

### 10.1 History-Aware Neighboring Distractor Sampling
1. **Target Selection**: Selects a target `AtomicClaim` ($C_{\text{target}}$) from the active workspace.
2. **Correct Choice Generation**: Populated directly from $C_{\text{target}}.\text{content}$ or $C_{\text{target}}.\text{assessment_target}$.
3. **Neighboring Claim Pool**: Candidate distractors are sampled from the target claim's own `WikiPage` **plus** adjacent prerequisite and dependent `WikiPage`s in the active workspace.
4. **History Exclusion Filter**:
   - The generator checks the student's recent `ActivityAttempt` logs for $C_{\text{target}}$.
   - Distractor claims presented to the student in their last 3 attempts are excluded from the choice pool.
5. **Fallback Threshold**: If history filtering leaves fewer than 3 available distractor claims, the system relaxes the history filter and samples any distinct claim from neighboring DAG topics.

### 10.2 Generation Cost & Runtime Analysis
- **Basic Deterministic Activities (Multiple Choice, True/False, Short Answer)**:
  - **Generation Cost**: **$0.00** (Zero API cost; options assembled via SQL).
  - **Runtime Latency**: **~1–5 ms** (Instant database query).
- **Complex AI Activities (Wrong on Purpose, Feynman Diagnostic, Scenarios)**:
  - **Generation Cost**: **~$0.0001 – $0.0005** per call (using fast models like Gemini Flash / Haiku).
  - **Runtime Latency**: **~300–800 ms**.

---

## 11. Activity Format Specific Rules & Flashcard Stacks

### 11.1 Flashcard Stack Rules (`Activity-Flashcards`)
- **No Distractors**: Flashcards have no wrong options or distractors (Front: Prompt/Question, Back: Claim answer & source locator excerpt).
- **One Stack Per Wiki Page**: Each `WikiPage` owns **1 Flashcard Stack**.
- **Neighboring Fallback**: If a `WikiPage` has fewer cards than the standard stack size (e.g. $< 5$ cards), the stack automatically pulls flashcards from **neighboring prerequisite or dependent `WikiPage`s** within the active workspace.

---

## 12. Chat Inaccessibility Rule During Active Practice

To enforce independent recall and prevent AI assistance during assessed practice:

### 12.1 Interface Lock During Active Practice
- **Lock Trigger**: Whenever a student opens or starts an activity (`activity.is_completed == false` and in-progress), the `ChatInterface` **locks and disables chat input**.
- **Notice Display**: In place of the active chat input, the UI displays an explanatory notice:
  > *"Chat is paused during active practice activities to encourage independent recall. Complete or exit the activity to resume chat access."*
- **Unlock Trigger**: Chat input is automatically re-enabled upon activity submission or exit.

---





