# Source Document Approval — Implementation Plan

## Problem
Currently, any user can upload source documents that immediately enter the knowledge graph and influence activity generation. There is no review gate — a student could upload incorrect or irrelevant material that corrupts the learning content.

## Proposed Flow

```
Student uploads doc → status: "pending"
       │
       ▼
Teacher sees pending docs in Dashboard → Reviews content
       │
       ├── Approve → status: "approved" → doc enters knowledge graph
       │                                → topics/claims regenerated
       │
       └── Reject → status: "rejected" → student notified with reason
                                        → doc excluded from graph
```

## Data Model Changes

### Backend: `source_documents` table
Add a `status` column (currently not present — docs are immediately active):

```sql
ALTER TABLE source_documents
  ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'approved',  -- backwards compat
  ADD COLUMN reviewed_by UUID REFERENCES users(id),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN rejection_reason TEXT;
```

**Status values:** `pending` | `approved` | `rejected`

When a **teacher** uploads: auto-set `status = 'approved'`.
When a **student** uploads: set `status = 'pending'`.

### Backend: New/Modified Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `POST /api/sources/upload` | Modify | Add `status` based on uploader's role |
| `GET /api/sources/pending` | New | Teacher-only. List docs with `status = 'pending'` |
| `PATCH /api/sources/{id}/approve` | New | Teacher-only. Set status to `approved`, trigger re-ingestion |
| `PATCH /api/sources/{id}/reject` | New | Teacher-only. Set status to `rejected` + reason |
| `GET /api/sources` | Modify | Filter by `status = 'approved'` for students; show all for teachers |

### Frontend Changes

**1. SourceDocsManager (student view)**
- Upload still works, but shows a "Pending Review" badge on unreviewed docs
- Rejected docs show the reason with option to re-upload
- Only approved docs show the "View" / knowledge graph integration

**2. TeacherDashboard — New "Pending Docs" section**
- Card count badge showing pending doc count
- List view with: filename, uploader name, upload date, file size, preview button
- Two action buttons per doc: "Approve" (green) and "Reject" (red, opens reason modal)
- Bulk approve/reject with checkboxes

**3. Notification indicators**
- NavPanel: badge on Dashboard icon showing pending count (teacher only)
- Toast notification when a student's doc is approved/rejected

## Implementation Steps

### Phase 1: Backend (Est. 3–4 hours)
1. Add migration for `status`, `reviewed_by`, `reviewed_at`, `rejection_reason` columns
2. Modify upload endpoint to set status based on role
3. Add `GET /api/sources/pending` endpoint (teacher-only, auth check)
4. Add `PATCH /api/sources/{id}/approve` and `/reject` endpoints
5. Modify source listing to filter by status for students
6. Modify knowledge graph ingestion to only process approved docs

### Phase 2: Frontend — Teacher Review UI (Est. 3–4 hours)
1. Add "Pending Documents" section to TeacherDashboard
2. Build approval/rejection UI with preview capability
3. Add rejection reason modal
4. Add pending count badge to Dashboard nav item
5. Wire up API calls

### Phase 3: Frontend — Student Feedback (Est. 1–2 hours)
1. Add status badges to SourceDocsManager list
2. Show rejection reason inline
3. Add "Re-upload" option for rejected docs
4. Toast notifications for status changes

### Phase 4: Knowledge Graph Re-ingestion (Est. 2–3 hours)
1. On approval, trigger topic/claim extraction pipeline for the newly approved doc
2. Update the DAG/node map with new nodes
3. Generate new activities from approved content

## Total Estimated Effort
**9–13 hours** (1.5–2 days of focused work)

## Edge Cases to Handle
- **Teacher uploads**: Skip review, auto-approve
- **Doc deleted while pending**: Clean up, no notification needed
- **Multiple teachers**: Any teacher can approve/reject any pending doc
- **Re-upload after rejection**: Creates a new doc entry (new review cycle)
- **Bulk operations**: Approve/reject multiple docs at once for efficiency

## Risks
- Knowledge graph re-ingestion on approval may be slow for large documents — consider async processing with a status indicator
- If the approval queue gets long, teachers may need sorting/filtering (by date, uploader, file type)
