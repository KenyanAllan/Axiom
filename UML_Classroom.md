# Backend

> Archived reference. This document may contradict the active specification. Use the [active docs](../../index.md) for current requirements.


### User
* Attributes
    * id: int
    * name: string
    * role: string (e.g. STUDENT, TEACHER)
    * xpTotal: int
    * level: int

* Methods
    * login()
    * logout()
    * register()
    * getRole(): string
    * getProgress()
    * addXP(amount: int)
    * getLevel(): int


### Database - Singleton
* Attributes
    * conn: DB
* Methods
    * getConnection()
    * executeQuery(query: string)

### UserFeed - Activities
* Attributes
    * userId: int
    * activity_queue: array of Activity
    * finished_activities: array of Activity

* Methods
    * getActivities()
    * addActivity(activity: Activity)
    * removeActivity(activityId: int)
    * getNextRecommendedActivity()

### Textbook_Pipeline
* Attributes
    * rawInputSource: SourceDocument
    * normalizer: ModalityNormalizer
    * chunker: StructuralChunker
    * extractor: DualPassExtractor
    * similarityThreshold: float (Default 0.82)

* Methods
    * processSource(file: File, workspaceId: int): SourceDocument
    * normalizeModality(source: File): string
    * executeStructuralChunking(content: string): array of Chunks
    * executeDualPassExtraction(chunk: Chunk): array of ExtractionCandidates
    * consolidateExtraction(candidates: array of ExtractionCandidates, workspaceId: int): array of WikiPages
    * findMatchingWikiPage(candidateVector: PageVector, workspaceId: int): WikiPage
    * applyWikiDelta(targetWikiId: int, delta: WikiDelta)


### CascadingPruningService
* Attributes
    * wikiRepository: WikiRepository
    * vectorIndex: VectorSearchEngine

* Methods
    * handleSourceDeletion(sourceId: int)
    * hardPruneClaim(claimId: int)

### VectorSearchEngine
* Attributes
    * indexStore: DB
    * embeddingModel: VectorModel

* Methods
    * searchSummaries(queryVector: array): array of WikiPages
    * searchDirectClaims(queryVector: array): array of AtomicClaims
    * searchSyntheticQuestions(queryVector: array): array of SyntheticQuestions

### DAGManager
* Attributes
    * adjacencyList: map
    * activeFrontier: array of WikiPages

* Methods
    * addRelationship(sourceId: int, targetId: int, type: string)
    * detectCycles(sourceId: int, targetId: int): bool
    * downgradeEdgeToReference(sourceId: int, targetId: int)
    * calculateLearningFrontier(userMastery: UserMasteryState): array of WikiPages

### AutomatedEvaluationEngine
* Attributes
    * pyodideSandbox: PyodideRuntime
    * llmReferee: LLMService

* Methods
    * runMicroProjectTests(code: string, testHarness: string): TestResult
    * evaluateFeynmanDiagnostic(submission: string, rubric: string): EvaluationResult
    * evaluateWrongOnPurpose(submission: string, correction: string): EvaluationResult

### Chat - For Chatting and Searching
* Attributes
    * llmService: LLMService
    * vectorSearchEngine: VectorSearchEngine
    * mcpClientManager: MCPClientManager
    * sttService: SpeechToTextService
    * liveVoiceGateway: LiveVoiceGateway

* Methods
    * processChatMessage(userId: int, userQuery: string, activeWikiId: int): ChatResponse
    * searchCourseMaterials(queryText: string): array of SearchResult
    * executeMCPToolCall(toolName: string, parameters: map): MCPResult
    * createActivityViaMCP(topicId: int, claimIds: array of int, difficulty: int): Activity
    * createNewSession(userId: int): ChatSession
    * switchSession(userId: int, sessionId: int): ChatSession
    * transcribeAudioPayload(audioBlob: Blob): TimestampedTranscript
    * handleLiveVoiceStream(userId: int, stream: AudioBuffer)

### SpeechToTextService
* Attributes
    * sttEngine: WhisperAPI / GeminiAudio
    * supportedLanguages: array of string

* Methods
    * transcribeAudioStream(stream: AudioBuffer): TimestampedTranscript

### LiveVoiceGateway
* Attributes
    * webSocketServer: WSServer
    * geminiLiveClient: GeminiLiveAPI

* Methods
    * handleAudioFrame(frame: BinaryAudioFrame)
    * streamAIResponseAudio(): AudioChunk

### GamificationEngine
* Attributes
    * levelThresholds: map<int, int>

* Methods
    * calculateXPReward(difficulty: int): int
    * awardXP(userId: int, activityId: int, difficulty: int): GamificationResult
    * checkLevelUp(currentXP: int): int

### SpeechSynthesisService - External Speech Generation (TTS)
* Attributes
    * externalTTSEngine: ExternalSpeechAPI
    * audioCache: map<string, AudioStreamResult>

* Methods
    * generateSpeech(text: string, voiceId: string): AudioStreamResult
    * getCachedAudio(contentHash: string): AudioStreamResult

### Classroom
* Attributes
    * id: int
    * title: string
    * teacherId: int
    * joinCode: string
    * studentIds: array of int
    * sharedWikiIds: array of int
    * sharedSourceIds: array of int

* Methods
    * addStudent(studentId: int)
    * removeStudent(studentId: int)
    * shareWikiPage(wikiId: int)
    * shareSourceDocument(sourceId: int)
    * getEnrolledStudents(): array of int

### ClassroomManager - Teacher Service
* Attributes
    * classroomRepository: map<int, Classroom>

* Methods
    * createClassroom(teacherId: int, title: string): Classroom
    * joinClassroomByCode(studentId: int, joinCode: string): bool
    * assignActivityToClass(teacherId: int, classroomId: int, activity: Activity)
    * assignActivityToStudent(teacherId: int, studentId: int, activity: Activity)
    * editSharedWikiPage(teacherId: int, wikiId: int, newContent: string)
    * editActivity(teacherId: int, activityId: int, updatedActivity: Activity)
    * getStudentChatHistory(teacherId: int, studentId: int): array of ChatSession
    * getStudentActivityHistory(teacherId: int, studentId: int): array of Activity
    * calculateStudentProgress(teacherId: int, studentId: int): map
    * getDiagnostic(teacherId: int, classroomId: int): ClassroomDiagnostic


### ClassroomLeaderboard
* Attributes
    * id: int
    * classroomId: int
    * entries: array of LeaderboardEntry

* Methods
    * updateRankings(): array of LeaderboardEntry
    * getStudentRank(studentId: int): int


---

# MiddleWare

### Workspace
* Attributes
    * id: int
    * userId: int
    * classroomId: int
    * title: string
    * description: string
    * isClassroomShared: bool
    * currentStudy: array of AtomicClaims
    * chatSessions: array of ChatSession
    * createdAt: timestamp

* Methods
    * getTitle(): string
    * isShared(): bool
    * getCurrentStudy(): array of AtomicClaims
    * getChatSessions(): array of ChatSession


### WorkspaceManager
* Attributes
    * activeWorkspaceId: int
    * workspaces: map<int, Workspace>

* Methods
    * createWorkspace(userId: int, title: string, description: string): Workspace
    * switchWorkspace(userId: int, workspaceId: int): bool
    * getUserWorkspaces(userId: int): array of Workspace
    * deleteWorkspace(userId: int, workspaceId: int): bool

### WikiPage

* Attributes
    * id: int
    * userId: int
    * title: string
    * alias: array of string
    * prerequisites: array of WikiPages Ids
    * dependants: array of WikiPages Ids
    * overview: string
    * anchors: array - references to SourceDocuments
    * claims: array - references to AtomicClaims
    * syntheticQuestions: array - references to SyntheticQuestions
    * pageVector: PageVector - references to PageVector 
    * figures: array - references to figures in the SourceDocument

* Methods
    * getContent(): string
    * buildPageVector(): PageVector
    * addClaim(claim: AtomicClaim)
    * removeSourceCitation(sourceId: int)

### AudioStreamResult
* Attributes
    * audioUrl: string
    * durationSeconds: float
    * contentHash: string

* Methods
    * getStreamUrl(): string

### PageVector - Vector of WikiPage
* Attributes
    * vector: array of float (e.g., 1536-dim array)
    * pageId: int
    * userId: int
    * metadata: json

* Methods
    

### SourceDocument
* Attributes
    * id: int
    * userId: int
    * title: string
    * source: string - Reference in S3 Bucket
    * type: enum(PDF, Podcast, Transcript)
    * ingestedAt: timestamp
    * anchors: array of Anchor
    * figures: array of Figure

* Methods
    * getRawMarkdown(): string

### AtomicClaim
* Attributes
    * id: int
    * userId: int
    * title: string
    * content: string
    * goal: string (Assessment Target)
    * understandingRating: int - between 1-5
* Methods    
    * updateUnderstandingRating(rating: int)
    * getUnderstandingRating(): int
    * removeSource(sourceId: int)

### ClaimVector - Vector of AtomicClaim
* Attributes
    * vector: array of float
    * claimId: int
    * userId: int
    * metadata: json

* Methods
    

### Anchor - Reference from Source Document
* Attributes
    * sourceDocumentId: int
    * chapter: string
    * pageNumber: int
    * timestamp: string
    * locatorText: string

* Methods
    * getFormattedReference(): string

### Figure - Picture Diagram or Visual from source
* Attributes
    * id: int
    * sourceDocumentId: int
    * chapter: string
    * pageNumber: int
    * timestamp: string
    * description: string
     

### SyntheticQuestion
* Attributes
    * id: int
    * userId: int
    * targetClaimId: int
    * questionText: string
    * questionVector: QuestionVector

* Methods
    * getPromptText(): string

### QuestionVector - Vector of Synthetic Question
* Attributes
    * vector: array of float
    * questionId: int
    * userId: int

* Methods
    * getSimilarity(otherVector: QuestionVector): float

### LeaderboardEntry
* Attributes
    * studentId: int
    * studentName: string
    * xpTotal: int
    * level: int
    * activitiesCompletedCount: int
    * rank: int

* Methods
    * getFormattedEntry(): string

### ClassroomDiagnostic
* Attributes
    * classroomId: int
    * studentIds: array of int
    * wikiPageIds: array of int
    * claimMasteryMatrix: map<int, map<int, int>>

* Methods
    * getGridData(): json
    * getStrugglingClaims(): array of int


---

# Frontend

### Activity
* Attributes
    * id: int
    * userId: int
    * scope: enum(CLASSROOM_SHARED, STUDENT_PERSONAL)
    * title: string
    * targetClaimIds: array of int
    * is_completed: bool
    * difficulty: int (1-3)
    * frictionLevers: map (signal_to_noise, representation, distractor_strength, scaffolding_depth)
    * auditPassed: bool
    * xpReward: int


* Methods
    * markAsComplete()   
    * getScaffoldedHint(step: int): string
    * submitSolution(payload: json): EvaluationResult
    * getXPReward(): int
    * speakContent(): AudioStreamResult

### Activity-Flashcards
* Attributes
    * promptQuestion: SyntheticQuestion
    * claimAnswer: AtomicClaim

* Methods
    * flipCard()

### Activity-Quiz (Abstract Parent)
* Attributes
    * questionText: string
    * assessmentTarget: string
    * hintProgression: array of string
    * answerExplanation: string

* Methods
    * checkAnswer(userAnswer: string): bool

### Activity-Quiz-MultiChoice
* Attributes
    * options: array of string
    * correctOptionIndex: int

* Methods
    * selectOption(index: int): bool
    * checkAnswer(userAnswer: int): bool

### Activity-Quiz-TrueFalse
* Attributes
    * statement: string
    * isTrue: bool

* Methods
    * checkAnswer(userAnswer: bool): bool

### Activity-Quiz-ShortAnswer
* Attributes
    * prompt: string
    * targetKeywords: array of string

* Methods
    * evaluateShortAnswer(input: string): bool

### Activity-WrongOnPurpose
* Attributes
    * injectedError: string
    * flawedPeerStatement: string
    * expectedCorrection: string

* Methods
    * submitCorrection(studentText: string): EvaluationResult

### Activity-Scenario
* Attributes
    * scenarioTitle: string
    * domainContext: string
    * problemStatement: string
    * targetClaims: array of int

* Methods
    * submitAnalysis(decision: string): EvaluationResult

### Activity-AudioOverview
* Attributes
    * audioUrl: string
    * transcriptText: string
    * playbackSpeed: float

* Methods
    * playAudio()
    * pauseAudio()
    * seekToTimestamp(seconds: float)

### ChatInterface
* Attributes
    * activeConversation: ChatSession
    * previousChatSessions: array of ChatSession
    * searchQuery: string
    * searchResults: array of SearchResult
    * isChatDisabled: bool
    * disabledNoticeText: string

* Methods
    * sendMessage(messageText: string)
    * searchMaterials(queryText: string)
    * createNewChatSession()
    * switchChatSession(sessionId: int)
    * requestActivityGeneration(topicId: int, difficulty: int)
    * playMessageSpeech(messageId: int)
    * clearChatHistory()
    * disableChatDuringActivity(activityId: int)
    * enableChat()


### ChatSession
* Attributes
    * id: int
    * userId: int
    * title: string
    * createdAt: timestamp
    * messages: array of ChatMessage

* Methods
    * getTitle(): string
    * addMessage(message: ChatMessage)

### ChatMessage
* Attributes
    * id: int
    * sender: enum(USER, AI)
    * text: string
    * timestamp: timestamp
    * referencedClaimIds: array of int
    * referencedWikiIds: array of int
    * mcpToolCalls: array of string
    * generatedActivityId: int

* Methods
    * speakMessage(): AudioStreamResult

### ClassroomView
* Attributes
    * activeClassroom: Classroom
    * enrolledStudents: array of User
    * sharedWikis: array of WikiPage
    * sharedSources: array of SourceDocument

* Methods
    * joinClassroom(joinCode: string)
    * viewLeaderboard()
    * openSharedWiki(wikiId: int)

### TeacherDashboardView
* Attributes
    * managedClassrooms: array of Classroom
    * selectedStudentId: int
    * selectedStudentChats: array of ChatSession
    * selectedStudentActivities: array of Activity

* Methods
    * selectStudent(studentId: int)
    * viewStudentProgress(studentId: int)
    * renderDiagnostic()
    * assignActivity(studentId: int, activityId: int)
    * editWikiPage(wikiId: int)
    * editActivity(activityId: int)
    * generateActivity(topicId: int, difficulty: int)

### LeaderboardView
* Attributes
    * leaderboard: ClassroomLeaderboard

* Methods
    * renderRankings()
