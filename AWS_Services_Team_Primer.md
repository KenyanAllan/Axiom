# AWS Services Primer for the Team

> Archived reference. This document may contradict the active specification. Use the [active docs](../../index.md) for current requirements.

## A Plain-English Guide to Our System Infrastructure

This document breaks down every AWS service in our lean MVP architecture. It explains what each tool does in general and its exact role within our platform.

---

### System Architecture Overview

```
[ User Browser / Client ]
           │
           ▼
   [ AWS Amplify ] (Frontend Web UI & Hosting - HTTPS)
           │
           │ HTTPS (Direct API calls via sslip.io + Let's Encrypt)
           ▼
     [ Amazon EC2 ] (Backend API Server & Python Workers)
           │
           ├────────────────────────┬────────────────────────┐
           ▼                        ▼                        ▼
     [ Amazon S3 ]       [ Amazon Aurora PostgreSQL ]  [ Amazon Bedrock ]
 (Raw Files & Transcripts)  (Wiki, Graph & Vectors)     (LLM Intelligence)
           │                        ▲
           ▼                        │
     [ Amazon SQS ] ────────────────┘
   (Background Job Queue)
           │
           ├────────────────────────┐
           ▼                        ▼
  [ Amazon Transcribe ]      [ Amazon Polly ]
   (Speech-to-Text)           (Text-to-Speech)
```

---

### The Services Breakdown

#### 1. AWS Amplify (Frontend Hosting & Deployment)
* **What it is in plain English:** A turnkey web host designed for modern frontend apps (React, Next.js, Vue). You connect it directly to a GitHub repository, and every time you push code, Amplify builds and deploys the site to a global Content Delivery Network (CDN).
* **What it does for us:** 
  * Hosts our interactive student/teacher dashboard.
  * Assigns us a free AWS domain (`https://main.d123.amplifyapp.com`) with automatic SSL enabled.
  * Provides zero-configuration Continuous Integration / Continuous Deployment (CI/CD) for fast iteration.

#### 2. Amazon EC2 (Elastic Compute Cloud - Backend Compute)
* **What it is in plain English:** A virtual server (a Linux computer) running in an AWS data center that we control completely.
* **What it does for us:**
  * Runs our **FastAPI web server** to handle API requests from the frontend.
  * Runs our **background workers** (using Celery/Python) that do the heavy lifting: extracting text from PDFs, chunking chapters, and running multi-step reasoning jobs without freezing the user interface.
  * **SSL / Domain Handling for MVP:** Since we don't need a custom domain or expensive load balancers, we map our Elastic IP using a free wildcard DNS hostname (`<elastic-ip>.sslip.io`) and let Certbot issue a free Let's Encrypt certificate. This satisfies browser HTTPS requirements with zero ongoing cost.

#### 3. Amazon S3 (Simple Storage Service - File Storage)
* **What it is in plain English:** An ultra-reliable digital storage locker for files. You store files as "objects" in "buckets" rather than running a traditional hard drive.
* **What it does for us:**
  * Serves as our **Layer 1 Immutable Ground-Truth Storage**.
  * Holds raw textbook PDFs, lecture audio, video files, and clean Markdown transcripts.
  * Stores diagram crops, flowchart images, and generated audio overview MP3 files.
  * Users upload large media files directly to S3 via secure temporary links (Presigned URLs), preventing our EC2 backend from getting overwhelmed.

#### 4. Amazon Aurora Serverless v2 with `pgvector` (Database, Graph & Search)
* **What it is in plain English:** A high-performance, cloud-native PostgreSQL database that automatically scales its memory and compute power up or down based on current traffic.
* **What it does for us (The All-in-One Data Store):**
  * **Relational Data & Demo Auth:** Stores student progress, activity completion logs, and hardcoded demo personas (`usr_student_demo`, `usr_teacher_demo`) to bypass Cognito complexity for the MVP.
  * **Knowledge Graph:** Tracks which topics are prerequisites for others using recursive SQL queries, driving our Active Learning Frontier.
  * **Vector Database (`pgvector`):** Stores mathematical vector representations of wiki pages, atomic claims, and synthetic questions, allowing us to perform semantic AI search directly inside PostgreSQL without needing a separate vector DB tool.

#### 5. Amazon Bedrock (AI & Foundation Models)
* **What it is in plain English:** AWS's managed hub for accessing state-of-the-art Large Language Models (like Anthropic Claude) via secure API calls, without running your own GPU clusters.
* **What it does for us:**
  * **Concept Extraction & Audit:** Scans raw textbook chunks to extract claims and verifies that no major principles were missed.
  * **Synthetic Question Generation:** Pre-generates realistic user questions for every claim to improve search accuracy.
  * **Interactive Activities & Grading:** Powers "Wrong on Purpose" roleplay, grades student explanations, and evaluates code submissions against claim rubrics.

#### 6. Amazon SQS / Celery + Redis (Task Queue & Message Buffer)
* **What it is in plain English:** A durable, waiting line (buffer) for tasks. One part of your system drops a message into the line, and another part picks it up when it's ready.
* **What it does for us:**
  * Prevents our server from crashing when multiple users upload heavy documents at once.
  * Buffers multi-minute background jobs: OCR parsing, media transcription, vector generation, and cascading claim deletions.
  * Prevents our app from getting throttled by Bedrock API rate limits by pacing how fast workers send extraction requests.
  * *(Implementation Note: For the MVP, task queueing is powered by Celery backed by Redis via `REDIS_URL` on EC2 or ElastiCache, matching docker-compose).*

#### 7. Amazon Transcribe (Speech-to-Text)
* **What it is in plain English:** An automated speech recognition engine that converts spoken audio and video into text.
* **What it does for us:**
  * Ingests audio lectures, podcasts, and recorded seminars.
  * Separates distinct speakers (Speaker Diarization) and transcribes spoken technical concepts with exact timestamps so claims can link back to precise moments in the recording.

#### 8. Amazon Polly (Text-to-Speech)
* **What it is in plain English:** A speech synthesis engine that turns written text into lifelike spoken audio.
* **What it does for us:**
  * Generates **Mini Podcasts** of wiki pages (NotebookLM-style audio summaries).
  * Generates "Speech Marks" (metadata showing the exact millisecond each word is spoken), allowing our frontend UI to highlight text on screen in sync with the audio.

---

### Quick Reference Summary

| Service | Category | Why We Chose It |
| :--- | :--- | :--- |
| **AWS Amplify** | Frontend Host | Push-to-deploy hosting with zero server setup & free SSL. |
| **Amazon EC2** | Backend Compute | Full flexibility to run FastAPI and Python workers. |
| **Amazon S3** | Storage | Industry standard for durable, read-only file storage. |
| **Aurora (`pgvector`)** | Multi-Model DB | Combines relational records, graph edges, demo auth, and vector search in one DB. |
| **Amazon Bedrock** | GenAI / LLM | Secure, enterprise access to top-tier models (Claude). |
| **Amazon SQS** | Task Queue | Smooths out traffic spikes and orchestrates long jobs. |
| **Amazon Transcribe** | Speech-to-Text | Converts audio/video lectures into timestamped text. |
| **Amazon Polly** | Text-to-Speech | Reads wiki pages aloud with synchronized text highlights. |

*(Note: AWS ALB, ACM, and Cognito have been excluded from the MVP scope to reduce costs and operational complexity.)*
