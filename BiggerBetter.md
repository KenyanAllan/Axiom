**Amazon Comprehend**

* **Potential Use Case:** Automated concept extraction and prerequisite taxonomy mapping. During textbook ingestion, raw text chunks pass through Comprehend to extract key entities, technical noun phrases, and domain-specific terminology before constructing the prerequisite Directed Acyclic Graph (DAG).
* **Feature Impact:**
* **Entity & Keyphrase Extraction:** Isolates candidate learning objectives and topic nodes directly from unstructured prose, reducing LLM token consumption and hallucinations when structuring syllabus modules.
* **Syntax & Sentiment/Confidence Signals:** Assesses syntactic complexity to estimate chapter difficulty levels and analyzes student free-text responses to gauge conceptual confidence versus hesitation.



**Amazon DynamoDB**

* **Potential Use Case:** Ultra-low latency pedagogical state and student mastery tracking. It serves as the primary operational datastore recording fine-grained student competency across the atomic concept tree.
* **Feature Impact:**
* **Single-Digit Millisecond Latency:** Enables instantaneous state checks whenever a student submits an answer, verifying immediately whether upstream prerequisite nodes are unlocked.
* **Flexible Document Schema:** Easily accommodates evolving per-node attempt histories, misconception tags, and time-to-solve metrics per user without costly relational schema migrations.
* **Predictable Auto-Scaling:** Handles concurrent evaluation bursts when multiple students run interactive challenges simultaneously.



**Amazon Bedrock AgentCore**

* **Potential Use Case:** End-to-end hosting and execution of the active Socratic tutor, multi-turn reasoning loops, and dynamic student code evaluation.
* **Feature Impact:**
* **Isolated Code Interpreter:** Directly powers the automated code and proof sandboxes in isolated microVMs, enabling safe runtime execution and automated unit testing of student-submitted code without managing custom Docker infrastructure.
* **AgentCore Memory:** Provides built-in short-term context for multi-turn Socratic dialogues and long-term memory to retain specific misconceptions and learning patterns across study sessions.
* **Managed Runtime & Observability:** Offers serverless agent hosting with session isolation and execution tracing to inspect and debug multi-step pedagogical flows in real time.

**Amazon Translate**

* **Potential Use Case:** Real-time localization of instructional modules, textbook source material, and Socratic dialogues for ESL and international students. It bridges linguistic gaps so learners can interact with complex STEM concepts, code sandboxes, and hints in their native language while maintaining domain-specific technical terms.
* **Feature Impact:**
* **Custom Terminology (Active Custom Translation):** Preserves strict computer science and mathematical terms (e.g., "Directed Acyclic Graph", "race condition", "topological sort") without erroneous literal translation, ensuring conceptual integrity across languages.
* **Bi-directional Socratic Probing:** Automatically translates dynamic Socratic friction prompts and student text explanations on the fly, expanding the reach of the diagnostic platform without re-generating separate LLM pipelines per language.
* **Brevity & Formality Controls:** Allows adjusting pedagogical tone between formal academic scaffolding and concise diagnostic hints.



**Amazon Rekognition**

* **Potential Use Case:** Visual textbook decomposition and multimodal diagram analysis. Textbooks frequently communicate critical architectural concepts through circuit schematics, UML sequence diagrams, network topologies, and data structure figures that standard text extractors ignore.
* **Feature Impact:**
* **Label & Object Detection in Diagrams:** Identifies visual components (e.g., tree nodes, edges, flowcharts, data blocks) within embedded textbook graphics to anchor conceptual visual aids to specific prerequisite nodes in your graph.
* **Text-in-Image Extraction (DetectText):** Extracts annotations, callouts, and variable labels embedded directly inside architectural diagrams or mathematical figures where traditional OCR might clip them.
* **Visual Challenge Verification:** Enables students to upload handwritten proofs, drawn graph structures, or sketch-based solutions, allowing the system to inspect student-drawn responses alongside code submissions.