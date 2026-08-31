/** Thin same-origin API client. The session lives in an HttpOnly cookie; the
 * client never sends or stores tenant identifiers. */

import type { ModulePreviewDescriptor } from '@asa-lab/module-sdk';
import { projectDraftMutationId } from './modules/project-draft-mutation';
import { fetchWithSessionRefresh, notifySessionLoggedOut } from './session-fetch';

export interface PublicUser {
  id: string;
  displayName: string;
  email: string;
}

export interface CapabilityRef {
  capability: string;
  state: string;
}

export interface WorkspaceRef {
  workspaceId: string;
  kind: string;
  title: string;
  role: string;
}

export interface SchoolWorkspace {
  workspaceId: string;
  tenantId: string;
  schoolId: string;
  userId: string;
  title: string;
  role: 'school_admin';
}

export interface SessionPayload {
  authenticated: true;
  user: PublicUser;
  account: PublicUser;
  capabilities: CapabilityRef[];
  workspaces: WorkspaceRef[];
  activeWorkspace: { workspaceId: string; kind: string };
  navigation: { classes: boolean; classroomManagement: boolean };
  /** The teacher's own zone; every classroom date is read in it. */
  timeZone: string | null;
}

export interface MaxAuthConfig {
  enabled: boolean;
  launchUrl: string | null;
}

export interface LocalPreviewAuthConfig {
  enabled: boolean;
}

export interface MaxAccountStatus {
  linked: boolean;
  verifiedAt: string | null;
  firstAuthenticatedAt: string | null;
  promptDue: boolean;
  promptDismissedUntil: string | null;
  available: boolean;
}

export interface AccountProfile {
  email: string;
  emailVerificationState: string;
  username: string;
  displayName: string;
  bio: string;
  birthDate: string;
  country: string;
  capabilities: CapabilityRef[];
  workspaces: WorkspaceRef[];
}

export interface AccountAvatar {
  avatarDataUrl: string | null;
}

export interface AccountSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
  userAgentSummary: string | null;
}

export type BotAction = 'login' | 'register' | 'class_join';

export interface BotChallenge {
  action: BotAction;
  nonce: string;
  salt: string;
  difficulty: number;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

export interface BotProof extends BotChallenge {
  counter: number;
}

export interface Classroom {
  id: string;
  title: string;
  status: string;
  ageBand: '6-8' | '9-10' | '11-12' | '13-15' | '16-18' | 'mixed';
  topicKeys: string[];
  safeModeDefault: boolean;
  studentCount: number;
  /** Сдано и ещё не отвечено: сколько работ ждёт преподавателя. */
  awaitingReview?: number;
  /** Выдано заданий, сдано работ, сколько учеников не сдали ничего. */
  assignedCount?: number;
  submittedCount?: number;
  behindCount?: number;
  joinCodeVersion: number | null;
  joinCodeStatus: 'active' | 'revoked' | null;
  joinCode: string | null;
  teacherRole: 'owner' | 'co_teacher';
  workspaceKind: 'personal' | 'organization';
  workspaceTitle: string;
  createdAt: string;
  archivedAt: string | null;
}

export type ClassroomStatus = 'active' | 'archived' | 'deleted';

/** A badge a teacher gave a learner, with the reason if one was written. */
export interface SeatAward {
  awardKey: string;
  note: string | null;
  createdAt: string;
  awardedBy: string;
}

/** A task in a teacher's own library, written once and given out many times. */
export interface LibraryAssignment {
  id: string;
  title: string;
  brief: string | null;
  /** The one sentence the task turns on, shown set apart from the rest. */
  goal: string | null;
  moduleKey: string;
  /** Возраст, на который написано задание. Тот же словарь, что у классов. */
  ageBand: string | null;
  sampleImage: string | null;
  isDemo: boolean;
  /** Папка на полке преподавателя. null — задание лежит в корне. */
  folderId: string | null;
  folderTitle: string | null;
  /** Задание прошлых лет: убрано из списка, но живо вместе с работами учеников. */
  archivedAt: string | null;
  /** Кому открыто и скольким коллегам поимённо. */
  visibility: Visibility;
  sharedWith: number;
  /** В каких курсах это задание стоит. */
  courseTitles: string[];
  /** Своя переделка чужого задания: копия помнит источник. */
  copiedFrom: { id: string; title: string } | null;
  createdAt: string;
  updatedAt: string;
  handoutCount: number;
  startedCount: number;
  submittedCount: number;
  /** Кому выдавалось и в какие учебные годы — по этому и ищут через год. */
  classroomTitles: string[];
  academicYears: string[];
  lastHandedOutAt: string | null;
}

/**
 * Кому открыто содержимое.
 *
 * Один и тот же порядок у задания и у курса: только мне → названным
 * преподавателям → моей школе → всем. Вопрос один, и два разных ответа в двух
 * местах преподаватель не удержит в голове.
 */
export type Visibility = 'private' | 'teachers' | 'school' | 'public';

export const VISIBILITY_OPTIONS: ReadonlyArray<{ value: Visibility; label: string; hint: string }> =
  [
    { value: 'private', label: 'Только мне', hint: 'Никто, кроме вас, этого не видит.' },
    {
      value: 'teachers',
      label: 'Названным преподавателям',
      hint: 'Видят только те, кого вы добавите по почте.',
    },
    { value: 'school', label: 'Моей школе', hint: 'Видят все преподаватели вашей школы.' },
    {
      value: 'public',
      label: 'Всем',
      hint: 'Попадёт в общий каталог: увидит любой преподаватель.',
    },
  ];

export function visibilityLabel(value: string): string {
  return VISIBILITY_OPTIONS.find((entry) => entry.value === value)?.label ?? 'Только мне';
}

/** Курс — порядок, в котором проходят задания. */
export interface Course {
  id: string;
  title: string;
  summary: string | null;
  visibility: Visibility;
  ageBand: string | null;
  itemCount: number;
  sectionCount: number;
  lessonCount: number;
  assignmentCount: number;
  /** Скольким коллегам открыт поимённо. */
  sharedWith: number;
  copiedFromCourseId: string | null;
  publicationState: 'draft' | 'published' | 'changed';
  publishedVersion: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseItem {
  id: string;
  title: string;
  goal: string | null;
  moduleKey: string;
  sampleImage: string | null;
  position: number;
}

export type LessonBlock =
  | { id: string; type: 'paragraph'; text: string }
  | { id: string; type: 'heading'; text: string; level: 2 | 3 }
  | { id: string; type: 'callout'; text: string; tone: 'note' | 'tip' | 'warning' }
  | { id: string; type: 'image'; url: string; alt: string; caption: string }
  | { id: string; type: 'video'; url: string; title: string }
  | { id: string; type: 'audio'; url: string; title: string }
  | { id: string; type: 'file'; url: string; label: string };

export interface CourseLesson {
  id: string;
  title: string;
  summary: string | null;
  content: string | null;
  blocks: LessonBlock[];
  kind: 'material' | 'assignment';
  assignmentId: string | null;
  assignmentTitle: string | null;
  moduleKey: string | null;
  estimatedMinutes: number | null;
  position: number;
}

export interface CourseSection {
  id: string;
  title: string;
  summary: string | null;
  position: number;
  lessons: CourseLesson[];
}

export interface CourseLessonInput {
  sectionId: string;
  title: string;
  summary: string | null;
  content: string | null;
  blocks: LessonBlock[];
  kind: 'material' | 'assignment';
  assignmentId: string | null;
  estimatedMinutes: number | null;
}

export interface ClassroomCourseRunLesson {
  id: string;
  sourceLessonId: string;
  title: string;
  summary: string | null;
  content: string | null;
  blocks: LessonBlock[];
  kind: 'material' | 'assignment';
  estimatedMinutes: number | null;
  position: number;
  classroomAssignmentId: string | null;
  assignmentTitle: string | null;
  assignmentGoal: string | null;
  assignmentBrief: string | null;
  moduleKey: string | null;
  sampleImage: string | null;
  seatCount: number;
  startedCount: number;
  submittedCount: number;
  completedCount: number;
  canonicalCounts: null | CanonicalLearningCounts;
}

export interface ClassroomCourseRun {
  id: string;
  courseId: string;
  courseVersionId: string;
  versionNumber: number;
  title: string;
  summary: string | null;
  dueAt: string | null;
  status: 'open' | 'closed';
  publishedAt: string;
  startedCount: number;
  submittedCount: number;
  sections: Array<{
    id: string;
    title: string;
    summary: string | null;
    position: number;
    lessons: ClassroomCourseRunLesson[];
  }>;
}

export interface SeatCourseRunLesson extends Omit<
  ClassroomCourseRunLesson,
  'seatCount' | 'startedCount' | 'submittedCount' | 'completedCount'
> {
  projectId: string | null;
  submittedAt: string | null;
  snapshotRevision: number | null;
  updatedAt: string | null;
  completedAt: string | null;
  canonicalState: CanonicalLearningSurfaceState | null;
}

export interface SeatCourseRun {
  id: string;
  courseId: string;
  courseVersionId: string;
  versionNumber: number;
  classroomTitle: string;
  title: string;
  summary: string | null;
  dueAt: string | null;
  status: 'open' | 'closed';
  sections: Array<{
    id: string;
    title: string;
    summary: string | null;
    position: number;
    lessons: SeatCourseRunLesson[];
  }>;
}

/** Строка общего каталога: чужой курс или чужое задание. */
export interface CatalogueEntry {
  kind: 'course' | 'assignment';
  id: string;
  title: string;
  summary: string | null;
  moduleKey: string | null;
  ageBand: string | null;
  visibility: Visibility;
  sampleImage: string | null;
  itemCount: number;
  authorName: string;
  authorSchool: string | null;
  createdAt: string;
}

export interface CatalogueCoursePreview {
  versionNumber: number;
  title: string;
  summary: string | null;
  publishedAt: string;
  sections: Array<{
    id: string;
    title: string;
    summary: string | null;
    position: number;
    lessons: Array<{
      id: string;
      title: string;
      summary: string | null;
      content: string | null;
      blocks: LessonBlock[];
      kind: 'material' | 'assignment';
      estimatedMinutes: number | null;
      position: number;
    }>;
  }>;
}

export interface ContentShare {
  accountId: string;
  email: string;
  displayName: string;
  createdAt: string;
}

/** Папка банка заданий. Дерево до четырёх уровней. */
export interface AssignmentFolder {
  id: string;
  parentId: string | null;
  title: string;
  depth: number;
  /** Заданий в самой папке и вместе с вложенными. */
  directCount: number;
  totalCount: number;
}

export interface GalleryItem {
  projectId: string;
  title: string;
  moduleKey: string;
  /** How the author is named under the picture: a roster label or a display name. */
  authorLabel: string;
  publishedAt: string;
  snapshotRevision: number;
  editorsChoice: boolean;
  likeCount: number;
  wowCount: number;
  viewerLiked: boolean;
  viewerWowed: boolean;
  /** The author, or whoever put it up — the two people who may take it down. */
  viewerMayRemove: boolean;
}

/** Подборка работ из галереи, отложенных себе. */
export interface Collection {
  id: string;
  title: string;
  itemCount: number;
  createdAt: string;
}

export interface CollectionItem {
  projectId: string;
  title: string;
  moduleKey: string;
  authorLabel: string;
  snapshotRevision: number;
  editorsChoice: boolean;
  addedAt: string;
}

/** Класс, в котором учится сам владелец аккаунта. */
export interface AttendedClass {
  seatId: string;
  classroomId: string;
  classroomTitle: string;
  teacherDisplayName: string;
  openCount: number;
  unfinishedCount: number;
}

export interface GalleryWork {
  projectId: string;
  title: string;
  moduleKey: string;
  authorLabel: string;
  publishedAt: string;
  snapshotRevision: number;
  editorsChoice: boolean;
  likeCount: number;
  wowCount: number;
  viewerLiked: boolean;
  viewerWowed: boolean;
  viewerMayRemove: boolean;
  /** The author looking at their own work: no reactions, no copy. */
  viewerIsAuthor: boolean;
  /** The model itself, so the page can say what the work is built from. */
  document: unknown;
  copiedFromAuthor: string | null;
  copiedFromTitle: string | null;
  description: string | null;
  tags: readonly string[];
  license: string;
  visibility: 'link' | 'public';
  /** Сколько раз работу взяли за основу. */
  copyCount: number;
}

export interface AssignmentClassroom {
  classroomId: string;
  classroomTitle: string;
  handedOut: boolean;
  dueAt: string | null;
}

/** Work a teacher set for a class, with how far the class has got with it. */
export interface ClassroomAssignment {
  /** The handout: this task, in this class. */
  id: string;
  /** The library task behind it, shared by every class that has it. */
  assignmentId: string;
  title: string;
  brief: string | null;
  goal: string | null;
  moduleKey: string;
  dueAt: string | null;
  status: 'open' | 'closed';
  createdAt: string;
  /** One of the ten a class is given rather than one the teacher wrote. */
  isDemo: boolean;
  /** Picture of what to make: half the brief on a "make this" task. */
  sampleImage: string | null;
  seatCount: number;
  startedCount: number;
  submittedCount: number;
  /** Canonical audience, null for legacy handouts. */
  audienceType: 'whole_class' | 'named_learners' | null;
  /** Active canonical recipients, null for legacy handouts. */
  assignedCount: number | null;
}

export interface LearningAssignableActivity {
  id: string;
  versionId: string;
  title: string;
  instructions: string | null;
  kind: 'project';
  moduleKey: string;
}

export interface ClassroomAssignmentProgress {
  seatId: string;
  displayLabel: string;
  avatarKey: string | null;
  /** Null until the learner has opened the assignment. */
  projectId: string | null;
  /** Null while the editor has never saved a picture of this work. */
  snapshotRevision: number | null;
  startedAt: string | null;
  submittedAt: string | null;
  badge: string | null;
  canonicalState: CanonicalLearningSurfaceState | null;
}

export type CanonicalLearningWorkflowState =
  | 'not_applicable'
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'waiting_review'
  | 'changes_requested'
  | 'completed'
  | 'invalidated';

export interface CanonicalLearningSelectedResult {
  attemptId: string;
  resultRevisionId: string | null;
  compatibilityAssessmentResultId: string | null;
  rawPoints: number | null;
  maxPoints: number | null;
  percentageBasisPoints: number | null;
  displayGrade: string | null;
  completionValue: boolean | null;
  outcome: 'passed' | 'failed' | 'incomplete' | 'excused' | null;
  publishedAt: string;
}

export interface CanonicalLearningSurfaceState {
  workflowState: CanonicalLearningWorkflowState;
  selectedResult: CanonicalLearningSelectedResult | null;
  flags: string[];
  learnerMessageCode: string | null;
  compatibilityDiagnostic?: string;
}

export interface CanonicalLearningCounts {
  notStarted: number;
  inProgress: number;
  submitted: number;
  waitingReview: number;
  changesRequested: number;
  completed: number;
}

export type LearningAttemptState =
  | 'not_started'
  | 'in_progress'
  | 'submitted'
  | 'evaluating'
  | 'accepted'
  | 'changes_requested'
  | 'incomplete'
  | 'excused'
  | 'invalidated';

/** One canonical row from immutable attempt through the published result. */
export interface GradebookEntry {
  seatId: string;
  displayLabel: string;
  assignmentId: string;
  assignmentTitle: string;
  attemptId: string | null;
  attemptNumber: number | null;
  state: LearningAttemptState | CanonicalLearningWorkflowState;
  submittedAt: string | null;
  points: number | null;
  maxPoints: number | null;
  percentage: number | null;
  displayGrade: string | null;
  outcome: 'passed' | 'failed' | 'incomplete' | 'excused' | null;
  feedback: string | null;
  publishedAt: string | null;
  canonicalState: CanonicalLearningSurfaceState | null;
  compatibilityDiagnostic: string | null;
}

export interface LearnerResult {
  classroomTitle: string;
  assignmentId: string;
  assignmentTitle: string;
  attemptNumber: number;
  state: LearningAttemptState;
  points: number;
  maxPoints: number;
  percentage: number;
  displayGrade: string;
  outcome: 'passed' | 'failed' | 'incomplete' | 'excused';
  feedback: string | null;
  publishedAt: string;
  canonicalState: CanonicalLearningSurfaceState | null;
}

/** The same assignment as the learner sees it: theirs, and where they are. */
export interface SeatAssignment {
  id: string;
  title: string;
  brief: string | null;
  goal: string | null;
  moduleKey: string;
  dueAt: string | null;
  status: 'open' | 'closed';
  sampleImage: string | null;
  projectId: string | null;
  submittedAt: string | null;
  /** Снимок собственной работы: по нему ученик вспоминает, на чём остановился. */
  snapshotRevision: number | null;
  /** Когда работа менялась в последний раз. */
  updatedAt: string | null;
  canonicalState: CanonicalLearningSurfaceState | null;
}

export type QuizQuestionType =
  'single_choice' | 'multiple_choice' | 'boolean' | 'numeric' | 'short_text';

export interface QuestionBankItem {
  id: string;
  versionId: string;
  type: QuizQuestionType;
  promptBlocks: Array<{ type?: string; text?: string }>;
  responseSchema: { options?: Array<{ id: string; label: string }>; input?: string };
  maxPoints: number;
  scope: 'personal' | 'school';
  subject: string | null;
  ageBand: string | null;
  tags: string[];
  publishedAt: string;
}

export interface QuizVersion {
  id: string;
  title: string;
  instructions: string | null;
  questionCount: number;
  totalPoints: number;
  attemptLimit: number;
  timeLimitMinutes: number | null;
  passThreshold: number;
  feedbackReleasePolicy: 'immediate' | 'score_only' | 'after_close';
  publishedAt: string;
}

export interface LearnerQuiz {
  assignmentId: string;
  classroomTitle: string;
  quizVersionId: string;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  status: 'open' | 'closed';
  attemptLimit: number;
  attemptsUsed: number;
  timeLimitMinutes: number | null;
  totalPoints: number;
  passThreshold: number;
  latestResult: { state: string; points: number | null; percentage: number | null } | null;
  canonicalState: CanonicalLearningSurfaceState | null;
  questions: Array<{
    versionId: string;
    type: QuizQuestionType;
    promptBlocks: Array<{ type?: string; text?: string }>;
    responseSchema: { options?: Array<{ id: string; label: string }>; input?: string };
    maxPoints: number;
    position: number;
  }>;
}

export interface ClassroomTeacher {
  accountId: string;
  displayName: string;
  avatarDataUrl: string | null;
  role: 'owner' | 'co_teacher';
  joinedAt: string;
}

export interface ClassroomTeacherInvitation {
  id: string;
  status: 'pending' | 'accepted' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitePath?: string;
}

export interface ClassroomTeacherInvitationPreview {
  classroomId: string;
  classroomTitle: string;
  ownerDisplayName: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expiresAt: string;
}

export interface ClassroomStudentSeat {
  /** Выдано классу заданий, сдано этим человеком, из них ждёт ответа. */
  assignedCount?: number;
  submittedCount?: number;
  awaitingReview?: number;
  id: string;
  displayLabel: string;
  loginHandle: string;
  safeMode: boolean;
  status: 'issued' | 'active' | 'suspended';
  /** Chosen picture, or null while nobody has chosen and one is drawn by seat. */
  avatarKey: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

export interface ClassroomStudentSession {
  authenticated: true;
  student: { seatId: string; displayName: string; safeMode: boolean; avatarKey: string | null };
  classroom: { id: string; title: string; teacherDisplayName: string };
  expiresAt: string;
}

/**
 * One line in a class record. Repeated work on the same project inside a window
 * arrives as a single entry with a count, so `count` is how many times it
 * happened and `firstAt`..`at` is the stretch it happened over.
 */
export interface ClassroomActivityEntry {
  id: string;
  action: string;
  seatId: string | null;
  seatLabel: string | null;
  /** True when a teacher did this to a learner's work rather than the learner. */
  byTeacher: boolean;
  projectId: string | null;
  projectTitle: string | null;
  count: number;
  firstAt: string;
  at: string;
}

export interface ProjectFeedback {
  badge: string | null;
  comment: string | null;
  updatedAt: string;
  author: string;
}

export interface ClassroomStudentWork {
  /** Когда работа сдана и ждёт ли она ещё ответа преподавателя. */
  submittedAt?: string | null;
  awaitingReview?: boolean;
  canonicalState: CanonicalLearningSurfaceState | null;
  id: string;
  moduleKey: string;
  title: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  snapshotRevision: number | null;
  preview: ProjectPreview | null;
  lastEditedByTeacher: boolean;
  /** Что было задано: без условия работу не проверить. */
  assignment: {
    title: string;
    goal: string | null;
    brief: string | null;
    sampleImage: string | null;
  } | null;
}

export interface ClassroomStudentDetail {
  student: ClassroomStudentSeat;
  /** Сколько работ ученик сдал за всё время. */
  submittedCount: number;
  /** Из них ждут ответа преподавателя. */
  awaitingReview: number;
  projects: ClassroomStudentWork[];
  activity: ClassroomActivityEntry[];
}

export type ProjectScope = 'personal' | 'classroom';
export type ProjectStatus = 'active' | 'archived' | 'trashed';

/** The card picture the server drew when the project was last saved. */
export interface ProjectPreview {
  digest: string;
  descriptor: ModulePreviewDescriptor;
}

export interface ProjectSnapshotInfo {
  projectId: string;
  contentType: string;
  width: number;
  height: number;
  sourceRevision: number;
  capturedAt: string;
}

/**
 * Where a card fetches the editor's picture. The revision is part of the URL,
 * so the image behind any one address never changes and the browser may keep
 * it; new work produces a new address.
 */
export function projectSnapshotUrl(project: Project): string | null {
  if (project.snapshotRevision === null) return null;
  return `/api/projects/${encodeURIComponent(project.id)}/snapshot?rev=${project.snapshotRevision}`;
}

export interface Project {
  id: string;
  scope: ProjectScope;
  classroomId: string | null;
  moduleKey: string;
  title: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  preview: ProjectPreview | null;
  /** Null until an editor has captured a picture of this project. */
  snapshotRevision: number | null;
  /** Что это за работа, своими словами автора. */
  description?: string | null;
  /** До десяти коротких слов, по которым работу находят. */
  tags?: readonly string[];
  /** Под какой лицензией её можно брать: reserved | public-domain | cc-* */
  license?: string;
  /** Set when the project was taken from the gallery; never cleared. */
  copiedFrom: {
    projectId: string;
    author: string;
    title: string;
    at: string;
  } | null;
}

export interface ModuleSummary {
  moduleKey: string;
  moduleVersion: string;
  displayName: string;
  shortDescription: string;
  defaultProjectTitlePrefix: string;
  projectType: string;
  schemaVersion: number;
  editorRoute: string;
  viewerRoute: string;
  safeModeSupported: boolean;
  availability: 'active' | 'coming_soon' | 'disabled';
  previewKind: 'schematic' | 'board' | 'stage' | 'scene' | 'drawing' | 'summary';
  iconKey: string;
  categories: string[];
  creatable: boolean;
}

export interface ProjectDraft<TDocument = unknown> {
  projectId: string;
  document: TDocument;
  revision: number;
  updatedAt: string;
}

export interface ProjectVersion {
  id: string;
  versionNo: number;
  label: string | null;
  createdAt: string;
}

export type ComponentKind =
  | 'source'
  | 'resistor'
  | 'led'
  | 'rgb-led'
  | 'seven-segment'
  | 'button'
  | 'switch'
  | 'potentiometer'
  | 'photoresistor'
  | 'piezo'
  | 'diode'
  | 'transistor'
  | 'lamp'
  | 'breadboard'
  | 'visual'
  | 'wire';
export type Terminal = string;
export type Rotation = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;
export type ProductionStateValue = string | number | boolean | readonly string[];

export interface BreadboardHoleBinding {
  breadboardComponentId: string;
  holeId: string;
}

export interface SchematicComponent {
  id: string;
  kind: ComponentKind;
  componentTypeId?: string;
  variantId?: string;
  electricalModelId?: string;
  electricalModelVersion?: number;
  modelProfileId?: string;
  modelProfileVersion?: number;
  position: { x: number; y: number };
  value: number;
  rotation?: Rotation;
  name?: string;
  state?: boolean;
  wiperPosition?: number;
  stateProperties?: Record<string, ProductionStateValue>;
  pinIds?: string[];
  holeBindings?: Record<string, BreadboardHoleBinding>;
  internalConnections?: [string, string][];
}

export interface SchematicConnection {
  id: string;
  from: { componentId: string; terminal: Terminal };
  to: { componentId: string; terminal: Terminal };
  color?: string;
  vertices?: { x: number; y: number }[];
}

export interface SchematicDocument {
  schemaVersion: 4;
  components: SchematicComponent[];
  connections: SchematicConnection[];
  viewport: { x: number; y: number; zoom: number };
  simulation: { running: boolean; maxIterations: number };
}

export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  componentIds?: string[];
  wireIds?: string[];
  netIds?: string[];
  suggestedAction?: string;
  anchors?: { kind: 'component' | 'wire' | 'net'; id: string }[];
}

export interface ComponentResult {
  componentId: string;
  voltageDrop: number;
  current: number;
  terminalVoltages: Partial<Record<Terminal, number>>;
  terminalCurrents?: Partial<Record<Terminal, number>>;
  voltageConstraintResidual?: number;
  power?: number;
  brightness?: number;
  branchCurrents?: Record<string, number>;
  branchBrightness?: Record<string, number>;
  continuousCurrentLimitAmp?: number;
  destructiveCurrentLimitAmp?: number;
  reverseVoltageLimitVolt?: number;
  junctionState?: 'conducting' | 'forward_blocking' | 'reverse_blocking' | 'reverse_breakdown';
  lit?: boolean;
  energized?: boolean;
  currentUtilizationPercent?: number;
  powerUtilizationPercent?: number;
  stressState?: 'normal' | 'warning' | 'overcurrent' | 'overvoltage' | 'burned';
  deviceHealth?:
    | 'normal'
    | 'warning'
    | 'overheated'
    | 'failed_open'
    | 'failed_short'
    | 'stalled'
    | 'overvoltage'
    | 'reverse_damaged';
  damageState?: 'none' | 'destructive_preview' | 'failed';
  presentationState?: 'normal' | 'warning' | 'destructive' | 'failed' | 'stalled';
  internalResistanceOhm?: number;
  internalPower?: number;
  voltageSag?: number;
  sourceOperatingMode?: 'delivering' | 'idle' | 'absorbing';
  measurementMode?: 'dc-voltage' | 'dc-current' | 'resistance';
  measuredValue?: number;
  measurementUnit?: 'V' | 'A' | 'Ω';
  meterInputResistanceOhm?: number;
  meterShuntResistanceOhm?: number;
  meterBurdenVoltageVolt?: number;
  meterFuseRatingAmp?: number;
  meterFuseState?: 'intact' | 'blown';
  meterOverload?: boolean;
  meterTestVoltageVolt?: number;
  meterTestCurrentAmp?: number;
  meterResistanceRangeOhm?: number;
  meterOpenCircuit?: boolean;
  meterExternalPowerPresent?: boolean;
  operatingRegion?: 'cutoff' | 'active' | 'saturation' | 'ohmic';
  baseCurrent?: number;
  collectorCurrent?: number;
  emitterCurrent?: number;
  currentGain?: number;
  effectiveCurrentGain?: number;
  earlyVoltage?: number;
  maxCollectorCurrent?: number;
  maxPower?: number;
  frequencyHz?: number;
  soundLevel?: number;
  speedPercent?: number;
  direction?: 'clockwise' | 'counterclockwise' | 'stopped';
  motorRpm?: number;
  outputRpm?: number;
  motorAngularPhaseRadian?: number;
  motorOperatingMode?:
    'stopped' | 'starting' | 'running' | 'coasting' | 'reversing' | 'stalled' | 'failed';
  electromagneticTorqueNewtonMeter?: number;
  outputTorqueNewtonMeter?: number;
  outputLoadTorqueNewtonMeter?: number;
  transmissionEfficiency?: number;
  copperLossWatt?: number;
  motorMechanicalPowerWatt?: number;
  outputMechanicalPowerWatt?: number;
  operatingVoltageMinVolt?: number;
  operatingVoltageMaxVolt?: number;
  motorVoltageState?: 'below_range' | 'normal' | 'overvoltage';
  windingFailureMode?: 'none' | 'winding_open';
  capacitanceFarad?: number;
  chargeCoulomb?: number;
  storedEnergyJoule?: number;
  voltageRatingVolt?: number;
  temperatureCelsius?: number;
  thermalLoadPercent?: number;
  accumulatedDamagePercent?: number;
  effectiveResistanceOhm?: number;
  ratedVoltageVolt?: number;
  ratedCurrentAmp?: number;
  ratedPowerWatt?: number;
  voltageUtilizationPercent?: number;
  filamentState?: 'cold' | 'warming' | 'lit' | 'overheated' | 'burned';
}

export interface SolveResult {
  solved: boolean;
  status: 'solved' | 'invalid' | 'unsupported' | 'nonconvergent';
  current: number;
  components: ComponentResult[];
  nodes: { id: string; voltage: number; terminals: string[] }[];
  diagnostics: Diagnostic[];
  iterations: number;
  numericalResidual: number;
  numericalTolerance: number;
  transientState?: {
    version: 2;
    simulationTimeMs: number;
    capacitors: {
      componentId: string;
      capacitanceFarad: number;
      initialVoltageVolt: number;
      voltageRatingVolt: number;
      voltageVolt: number;
    }[];
    thermal: {
      componentId: string;
      profileKey: string;
      temperatureCelsius: number;
      loadRatio: number;
      accumulatedDamage: number;
      failureMode: 'none' | 'open';
    }[];
    bjtRegions?: {
      componentId: string;
      region: 'cutoff' | 'active' | 'saturation';
    }[];
    motors?: {
      modelVersion: 1;
      componentId: string;
      profileId: string;
      profileVersion: number;
      simulationTimeSeconds: number;
      currentAmp: number;
      motorAngularVelocityRadPerSecond: number;
      motorAngularPhaseRadian: number;
      temperatureCelsius: number;
      accumulatedDamage: number;
      failureMode: 'none' | 'winding_open';
    }[];
    multimeterFuses?: {
      componentId: string;
      profileKey: 'asa-two-terminal-dmm-current-400ma-v1';
      accumulatedI2tAmpSquaredSecond: number;
      fuseState: 'intact' | 'blown';
    }[];
  };
  transientAnalysis?: {
    acceptedSteps: number;
    rejectedSteps: number;
    minStepMs: number;
    maxStepMs: number;
  };
  quality?: {
    finite: boolean;
    passed: boolean;
    maxKclResidualAmp: number;
    maxSourceVoltageResidualVolt: number;
    powerBalanceResidualWatt: number;
    powerBalanceToleranceWatt: number;
    kclToleranceAmp: number;
    sourceVoltageToleranceVolt: number;
  };
  topologySignature?: string;
  simulationInputDigest?: string;
  solverRevision?: 'asa-electronics-solver-v8';
  modelSetDigest?: string;
  analysis?: {
    electricalMode: 'dc' | 'transient';
    controllerRuntime: 'none' | 'arduino';
  };
}

export interface ApiError {
  code: string;
  message: string;
  routes?: string[];
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  const headers: Record<string, string> = {
    ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  try {
    response = await fetchWithSessionRefresh(path, {
      ...init,
      headers,
    });
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: 'сервер недоступен' } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) {
    return { ok: true, status: response.status, data: body as T };
  }
  const error =
    (body as { error?: ApiError } | null)?.error ??
    ({ code: 'server_error', message: 'ошибка сервера' } satisfies ApiError);
  return { ok: false, status: response.status, error };
}

export interface ProjectListOptions {
  scope?: ProjectScope;
  classroomId?: string;
  status?: ProjectStatus;
}

export interface CreateProjectOptions {
  scope: ProjectScope;
  classroomId?: string | null;
  title: string;
  module: string;
  automaticTitle?: boolean;
  idempotencyKey: string;
}

export interface ProjectTitleSuggestionOptions {
  scope: ProjectScope;
  classroomId?: string | null;
  module: string;
}

export interface CheckersClassroomStudent<TProgress = unknown, TEvidence = unknown> {
  id: string;
  displayName: string;
  email: string;
  lastActivityAt: string | null;
  progress: TProgress[];
  evidence: TEvidence[];
  completedPuzzleIds: string[];
  lastMove: { ply: number; path: string[]; capturedIds: string[] } | null;
  revision: number;
  updatedAt: string | null;
}

export interface CheckersSafetySignal {
  id: string;
  gameId: string;
  reactionEventId: string;
  reactionId: string;
  reporterName: string;
  senderName: string;
  status: string;
  createdAt: string;
}

export interface CheckersClassGame<TDocument = unknown> {
  id: string;
  mode: 'friendly' | 'team' | 'teacher-event';
  status: 'pending' | 'active' | 'declined' | 'finished';
  version: number;
  side: 'light' | 'dark' | null;
  lightPlayer: { id: string; displayName: string };
  darkPlayer: { id: string; displayName: string };
  document: TDocument;
  createdAt: string;
  updatedAt: string;
  reactions: Array<{
    id: string;
    senderName: string;
    reactionId: string;
    sentAt: string;
  }>;
}

export interface CheckersClassPlay<TDocument = unknown> {
  role: 'owner' | 'student';
  muted: boolean;
  classmates: Array<{ id: string; displayName: string }>;
  games: CheckersClassGame<TDocument>[];
}

export type CheckersTeacherFeedbackId =
  'great-progress' | 'retry-capture' | 'review-turning-point' | 'ready-next';

export interface CheckersTeacherFeedback {
  id: string;
  feedbackId: CheckersTeacherFeedbackId;
  createdAt: string;
}

export const api = {
  me: () => call<SessionPayload | { authenticated: false }>('/api/auth/me'),
  localPreviewConfig: () => call<LocalPreviewAuthConfig>('/api/auth/local-preview/config'),
  localPreviewSession: () =>
    call<SessionPayload>('/api/auth/local-preview/session', { method: 'POST' }),
  maxConfig: () => call<MaxAuthConfig>('/api/auth/max/config'),
  maxStatus: () => call<MaxAccountStatus>('/api/auth/max/status'),
  dismissMaxPrompt: () =>
    call<{ dismissedUntil: string | null }>('/api/auth/max/prompt/dismiss', { method: 'POST' }),
  unlinkMax: () => call<{ unlinked: boolean }>('/api/auth/max/unlink', { method: 'POST' }),
  maxSession: (initData: string) =>
    call<SessionPayload>('/api/auth/max/session', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    }),
  maxLink: (initData: string) =>
    call<{ linked: true }>('/api/auth/max/link', {
      method: 'POST',
      body: JSON.stringify({ initData }),
    }),
  botChallenge: (action: BotAction) =>
    call<{ required: boolean; challenge: BotChallenge }>(
      `/api/auth/bot-challenge?action=${encodeURIComponent(action)}`,
    ),
  login: (identifier: string, password: string, botProof: BotProof) =>
    call<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password, botProof }),
    }),
  loginWithWorkspace: (workspace: string, email: string, password: string, botProof: BotProof) =>
    call<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ workspace, email, password, botProof }),
    }),
  register: (input: {
    email: string;
    password: string;
    username: string;
    displayName: string;
    birthDate: string;
    country: string;
    botProof: BotProof;
  }) =>
    call<SessionPayload>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  usernameAvailable: (username: string) =>
    call<{ available: boolean }>(
      `/api/auth/username-available?username=${encodeURIComponent(username)}`,
    ),
  logout: async () => {
    const result = await call<{ ok: true }>('/api/auth/logout', { method: 'POST' });
    if (result.ok) notifySessionLoggedOut();
    return result;
  },
  accountProfile: () => call<AccountProfile>('/api/account/profile'),
  accountAvatar: () => call<AccountAvatar>('/api/account/avatar'),
  updateAccountAvatar: (avatarDataUrl: string | null) =>
    call<AccountAvatar>('/api/account/avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatarDataUrl }),
    }),
  updateAccountProfile: (username: string, displayName: string, bio: string) =>
    call<AccountProfile>('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username, displayName, bio }),
    }),
  setAccountRole: (role: 'creator' | 'educator') =>
    call<{ role: 'creator' | 'educator'; state: string | null; changed: boolean }>(
      '/api/account/role',
      {
        method: 'PUT',
        body: JSON.stringify({ role }),
      },
    ),
  createSchool: (title: string) =>
    call<{ school: SchoolWorkspace }>('/api/schools', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  listWorkspaces: () =>
    call<{ items: WorkspaceRef[]; activeWorkspaceId: string }>('/api/workspaces'),
  switchWorkspace: (workspaceId: string) =>
    call<{ activeWorkspace: { workspaceId: string; kind: string } }>('/api/session/context', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  selfAttestEducator: () =>
    call<{ capability: 'educator'; state: string; created: boolean }>(
      '/api/capabilities/educator/self-attest',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  listAccountSessions: () => call<{ items: AccountSession[] }>('/api/account/sessions'),
  revokeAccountSession: (sessionId: string) =>
    call<{ ok: true }>(`/api/account/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
  revokeOtherAccountSessions: () =>
    call<{ revoked: number }>('/api/account/sessions/revoke-all', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  listModules: () => call<{ items: ModuleSummary[] }>('/api/modules'),
  listClassrooms: () => call<{ items: Classroom[]; meta: { total: number } }>('/api/classrooms'),
  getClassroom: (classroomId: string) =>
    call<{ classroom: Classroom }>(`/api/classrooms/${encodeURIComponent(classroomId)}`),
  listClassroomRoster: (classroomId: string) =>
    call<{ items: ClassroomStudentSeat[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/roster`,
    ),
  classroomActivity: (classroomId: string, options: { kind?: 'projects' } = {}) =>
    call<{ items: ClassroomActivityEntry[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/activity${
        options.kind ? `?kind=${options.kind}` : ''
      }`,
    ),
  classroomProgress: (classroomId: string) =>
    call<{
      seatCount: number;
      assignedCount: number;
      submittedCount: number;
      awaitingReview: number;
      behindCount: number;
    }>(`/api/classrooms/${encodeURIComponent(classroomId)}/progress`),
  classroomGradebook: (classroomId: string) =>
    call<{
      scheme: {
        title: string;
        version: number;
        bands: Array<{ minBasisPoints: number; label: string }>;
      } | null;
      items: GradebookEntry[];
    }>(`/api/classrooms/${encodeURIComponent(classroomId)}/gradebook`),
  publishGradingScheme: (
    classroomId: string,
    title: string,
    bands: Array<{ minBasisPoints: number; label: string }>,
  ) =>
    call<{ id: string; version: number }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/grading-scheme`,
      { method: 'POST', body: JSON.stringify({ title, bands }) },
    ),
  reviewLearningAttempt: (
    classroomId: string,
    attemptId: string,
    input: {
      decision: 'accepted' | 'changes_requested' | 'incomplete' | 'excused';
      points?: number | null;
      feedback?: string | null;
      reason?: string | null;
    },
  ) =>
    call<{
      attemptId: string;
      state: LearningAttemptState;
      assessmentResultId: string | null;
      gradebookEntryId: string | null;
      percentage: number | null;
    }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/attempts/${encodeURIComponent(attemptId)}/review`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  awaitingReviewTotal: () => call<{ total: number }>('/api/classrooms/awaiting-review'),
  classroomStudent: (classroomId: string, seatId: string) =>
    call<ClassroomStudentDetail>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/students/${encodeURIComponent(seatId)}`,
    ),
  addClassroomSeat: (
    classroomId: string,
    input: { displayLabel: string; loginHandle?: string; safeMode: boolean },
  ) =>
    call<{ student: ClassroomStudentSeat }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/seats`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  addClassroomSeatsBatch: (
    classroomId: string,
    students: Array<{ displayLabel: string; loginHandle?: string; safeMode: boolean }>,
  ) =>
    call<{
      results: Array<{
        index: number;
        ok: boolean;
        student?: ClassroomStudentSeat;
        message?: string;
      }>;
      created: number;
    }>(`/api/classrooms/${encodeURIComponent(classroomId)}/seats/batch`, {
      method: 'POST',
      body: JSON.stringify({ students }),
    }),
  updateClassroomSeat: (classroomId: string, seat: ClassroomStudentSeat) =>
    call<{ student: ClassroomStudentSeat }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/seats/${encodeURIComponent(seat.id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          displayLabel: seat.displayLabel,
          loginHandle: seat.loginHandle,
          safeMode: seat.safeMode,
          status: seat.status,
          avatarKey: seat.avatarKey,
        }),
      },
    ),
  setClassroomSeatAvatar: (avatarKey: string | null) =>
    call<ClassroomStudentSession>('/api/class-join/me/avatar', {
      method: 'PUT',
      body: JSON.stringify({ avatarKey }),
    }),
  removeClassroomSeat: (classroomId: string, seatId: string) =>
    call<{ removed: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/seats/${encodeURIComponent(seatId)}`,
      { method: 'DELETE' },
    ),
  listCollections: () => call<{ items: Collection[] }>('/api/collections'),
  collectionItems: (collectionId: string) =>
    call<{ items: CollectionItem[] }>(`/api/collections/${encodeURIComponent(collectionId)}`),
  createCollection: (title: string) =>
    call<{ id: string }>('/api/collections', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  renameCollection: (collectionId: string, title: string) =>
    call<{ ok: true }>(`/api/collections/${encodeURIComponent(collectionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  deleteCollection: (collectionId: string) =>
    call<{ removed: true }>(`/api/collections/${encodeURIComponent(collectionId)}`, {
      method: 'DELETE',
    }),
  setCollectionItem: (collectionId: string, projectId: string, inside: boolean) =>
    call<{ ok: true }>(
      `/api/collections/${encodeURIComponent(collectionId)}/items/${encodeURIComponent(projectId)}`,
      { method: 'PUT', body: JSON.stringify({ inside }) },
    ),
  collectionsHolding: (projectId: string) =>
    call<{ collectionIds: string[] }>(`/api/collections/holding/${encodeURIComponent(projectId)}`),

  /** Занять место в классе по коду, будучи собой. */
  joinClassAsAccount: (code: string) =>
    call<{ classroom: { id: string; title: string }; seatId: string; alreadyMember: boolean }>(
      '/api/class-join/account',
      { method: 'POST', body: JSON.stringify({ code }) },
    ),
  attendedClasses: () => call<{ items: AttendedClass[] }>('/api/class-join/account/classes'),
  attendedAssignments: () =>
    call<{ items: Array<SeatAssignment & { classroomTitle: string }> }>(
      '/api/class-join/account/assignments',
    ),
  gallery: (options: { sort?: 'recent' | 'popular'; module?: string; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (options.sort) query.set('sort', options.sort);
    if (options.module) query.set('module', options.module);
    if (options.offset) query.set('offset', String(options.offset));
    const suffix = query.toString();
    return call<{ items: GalleryItem[] }>(`/api/gallery${suffix ? `?${suffix}` : ''}`);
  },
  myGalleryProjects: () => call<{ projectIds: string[] }>('/api/gallery/mine'),
  galleryWork: (projectId: string) =>
    call<{ work: GalleryWork }>(`/api/gallery/${encodeURIComponent(projectId)}/work`),
  copyGalleryWork: (projectId: string, title?: string) =>
    call<{ projectId: string }>(`/api/gallery/${encodeURIComponent(projectId)}/copy`, {
      method: 'POST',
      body: JSON.stringify(title ? { title } : {}),
    }),
  galleryState: (projectId: string) =>
    call<{
      published: boolean;
      visibility?: 'link' | 'public';
      publishedAt?: string;
      likeCount?: number;
      wowCount?: number;
    }>(`/api/gallery/${encodeURIComponent(projectId)}/state`),
  saveProjectProperties: (
    projectId: string,
    input: {
      title: string;
      description: string | null;
      tags: string[];
      license: string;
      visibility: 'private' | 'link' | 'public';
    },
  ) =>
    call<{ ok: true }>(`/api/projects/${encodeURIComponent(projectId)}/properties`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  publishToGallery: (projectId: string) =>
    call<{ published: true }>(`/api/gallery/${encodeURIComponent(projectId)}`, { method: 'POST' }),
  unpublishFromGallery: (projectId: string) =>
    call<{ published: false }>(`/api/gallery/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    }),
  reactToWork: (projectId: string, kind: 'like' | 'wow', on: boolean) =>
    call<{ ok: true }>(`/api/gallery/${encodeURIComponent(projectId)}/reaction`, {
      method: 'PUT',
      body: JSON.stringify({ kind, on }),
    }),
  setEditorsChoice: (projectId: string, on: boolean) =>
    call<{ ok: true }>(`/api/gallery/${encodeURIComponent(projectId)}/editors-choice`, {
      method: 'PUT',
      body: JSON.stringify({ on }),
    }),
  listAssignmentLibrary: () => call<{ items: LibraryAssignment[] }>('/api/assignments'),
  saveLibraryAssignment: (
    assignmentId: string | null,
    input: {
      title: string;
      brief: string | null;
      goal: string | null;
      moduleKey: string;
      folderId?: string | null;
      ageBand?: string | null;
    },
  ) =>
    call<{ id: string }>(
      assignmentId ? `/api/assignments/${encodeURIComponent(assignmentId)}` : '/api/assignments',
      { method: assignmentId ? 'PATCH' : 'POST', body: JSON.stringify(input) },
    ),
  /** Attach a reference picture to a task, or clear it by passing null. */
  setAssignmentSample: (assignmentId: string, imageDataUrl: string | null) =>
    call<{ ok: true }>(`/api/assignments/${encodeURIComponent(assignmentId)}/sample`, {
      method: 'PUT',
      body: JSON.stringify({ imageDataUrl }),
    }),
  /** Картинка внутрь текста задания. Возвращает адрес, который идёт в текст. */
  addAssignmentImage: (assignmentId: string, imageDataUrl: string) =>
    call<{ id: string; url: string }>(
      `/api/assignments/${encodeURIComponent(assignmentId)}/images`,
      { method: 'POST', body: JSON.stringify({ imageDataUrl }) },
    ),
  /** Дерево папок банка со счётчиками. */
  assignmentFolders: () => call<{ items: AssignmentFolder[] }>('/api/assignments/folders'),
  createAssignmentFolder: (title: string, parentId: string | null) =>
    call<{ id: string }>('/api/assignments/folders', {
      method: 'POST',
      body: JSON.stringify({ title, parentId }),
    }),
  updateAssignmentFolder: (folderId: string, input: { title?: string; parentId?: string | null }) =>
    call<{ ok: true }>(`/api/assignments/folders/${encodeURIComponent(folderId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** Удаляется папка, а не задания: всё внутри поднимается уровнем выше. */
  deleteAssignmentFolder: (folderId: string) =>
    call<{ removed: true }>(`/api/assignments/folders/${encodeURIComponent(folderId)}`, {
      method: 'DELETE',
    }),
  moveAssignmentToFolder: (assignmentId: string, folderId: string | null) =>
    call<{ ok: true }>(`/api/assignments/${encodeURIComponent(assignmentId)}/folder`, {
      method: 'PUT',
      body: JSON.stringify({ folderId }),
    }),
  archiveAssignment: (assignmentId: string, archived: boolean) =>
    call<{ ok: true }>(`/api/assignments/${encodeURIComponent(assignmentId)}/archived`, {
      method: 'PUT',
      body: JSON.stringify({ archived }),
    }),
  /** Своя версия задания: источник остаётся нетронутым. */
  copyLibraryAssignment: (assignmentId: string, title?: string) =>
    call<{ id: string }>(`/api/assignments/${encodeURIComponent(assignmentId)}/copy`, {
      method: 'POST',
      body: JSON.stringify({ title: title ?? null }),
    }),
  // Курсы.
  listCourses: () => call<{ items: Course[] }>('/api/courses'),
  ensureDemoCourse: () =>
    call<{ id: string; created: boolean; publishedVersion: number }>('/api/courses/demo', {
      method: 'POST',
    }),
  saveCourse: (
    courseId: string | null,
    input: {
      title: string;
      summary: string | null;
      ageBand?: string | null;
      visibility?: Visibility | null;
    },
  ) =>
    call<{ id: string }>(
      courseId ? `/api/courses/${encodeURIComponent(courseId)}` : '/api/courses',
      {
        method: courseId ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      },
    ),
  /** Удаляется курс, а не задания: они остаются в банке. */
  deleteCourse: (courseId: string) =>
    call<{ removed: true }>(`/api/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' }),
  courseItems: (courseId: string) =>
    call<{ items: CourseItem[] }>(`/api/courses/${encodeURIComponent(courseId)}/items`),
  courseOutline: (courseId: string) =>
    call<{ sections: CourseSection[] }>(`/api/courses/${encodeURIComponent(courseId)}/outline`),
  publishCourse: (courseId: string) =>
    call<{
      versionId: string;
      versionNumber: number;
      publishedAt: string;
      reused: boolean;
    }>(`/api/courses/${encodeURIComponent(courseId)}/publish`, { method: 'POST' }),
  listClassroomCourseRuns: (classroomId: string) =>
    call<{ items: ClassroomCourseRun[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/course-runs`,
    ),
  assignCourseToClassroom: (classroomId: string, courseId: string, dueAt: string | null) =>
    call<{ runId: string; versionNumber: number; reused: boolean }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/course-runs`,
      { method: 'POST', body: JSON.stringify({ courseId, dueAt }) },
    ),
  setClassroomCourseRunStatus: (classroomId: string, runId: string, status: 'open' | 'closed') =>
    call<{ ok: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/course-runs/${encodeURIComponent(runId)}/status`,
      { method: 'POST', body: JSON.stringify({ status }) },
    ),
  saveCourseSection: (
    courseId: string,
    sectionId: string | null,
    input: { title: string; summary: string | null },
  ) =>
    call<{ id: string }>(
      sectionId
        ? `/api/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}`
        : `/api/courses/${encodeURIComponent(courseId)}/sections`,
      {
        method: sectionId ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      },
    ),
  moveCourseSection: (courseId: string, sectionId: string, delta: number) =>
    call<{ ok: boolean }>(
      `/api/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}/move`,
      { method: 'POST', body: JSON.stringify({ delta }) },
    ),
  deleteCourseSection: (courseId: string, sectionId: string) =>
    call<{ removed: true }>(
      `/api/courses/${encodeURIComponent(courseId)}/sections/${encodeURIComponent(sectionId)}`,
      { method: 'DELETE' },
    ),
  saveCourseLesson: (courseId: string, lessonId: string | null, input: CourseLessonInput) =>
    call<{ id: string }>(
      lessonId
        ? `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`
        : `/api/courses/${encodeURIComponent(courseId)}/lessons`,
      {
        method: lessonId ? 'PATCH' : 'POST',
        body: JSON.stringify(input),
      },
    ),
  moveCourseLesson: (courseId: string, lessonId: string, delta: number) =>
    call<{ ok: boolean }>(
      `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}/move`,
      { method: 'POST', body: JSON.stringify({ delta }) },
    ),
  deleteCourseLesson: (courseId: string, lessonId: string) =>
    call<{ removed: true }>(
      `/api/courses/${encodeURIComponent(courseId)}/lessons/${encodeURIComponent(lessonId)}`,
      { method: 'DELETE' },
    ),
  setCourseItem: (courseId: string, assignmentId: string, included: boolean) =>
    call<{ ok: true }>(
      `/api/courses/${encodeURIComponent(courseId)}/items/${encodeURIComponent(assignmentId)}`,
      { method: 'PUT', body: JSON.stringify({ included }) },
    ),
  moveCourseItem: (courseId: string, assignmentId: string, delta: number) =>
    call<{ ok: boolean }>(
      `/api/courses/${encodeURIComponent(courseId)}/items/${encodeURIComponent(assignmentId)}/move`,
      { method: 'POST', body: JSON.stringify({ delta }) },
    ),

  // Кому открыто.
  setVisibility: (kind: 'assignment' | 'course', subjectId: string, visibility: Visibility) =>
    call<{ ok: true }>(`/api/sharing/${kind}/${encodeURIComponent(subjectId)}/visibility`, {
      method: 'PUT',
      body: JSON.stringify({ visibility }),
    }),
  listShares: (kind: 'assignment' | 'course', subjectId: string) =>
    call<{ items: ContentShare[] }>(`/api/sharing/${kind}/${encodeURIComponent(subjectId)}`),
  addShare: (kind: 'assignment' | 'course', subjectId: string, email: string) =>
    call<{ ok: true }>(`/api/sharing/${kind}/${encodeURIComponent(subjectId)}`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  removeShare: (kind: 'assignment' | 'course', subjectId: string, accountId: string) =>
    call<{ removed: true }>(
      `/api/sharing/${kind}/${encodeURIComponent(subjectId)}/${encodeURIComponent(accountId)}`,
      { method: 'DELETE' },
    ),

  /** Общий каталог: чужое, открытое вам. Своё сюда не попадает. */
  catalogue: () => call<{ items: CatalogueEntry[] }>('/api/catalogue'),
  catalogueCourse: (courseId: string) =>
    call<CatalogueCoursePreview>(`/api/catalogue/courses/${encodeURIComponent(courseId)}`),
  /** Забрать себе копией: автор правит своё, вы — своё. */
  takeFromCatalogue: (kind: 'course' | 'assignment', subjectId: string) =>
    call<{ id: string }>(`/api/catalogue/${kind}/${encodeURIComponent(subjectId)}/take`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  deleteLibraryAssignment: (assignmentId: string) =>
    call<{ removed: true }>(`/api/assignments/${encodeURIComponent(assignmentId)}`, {
      method: 'DELETE',
    }),
  assignmentClassrooms: (assignmentId: string) =>
    call<{ items: AssignmentClassroom[] }>(
      `/api/assignments/${encodeURIComponent(assignmentId)}/classrooms`,
    ),
  handOutAssignment: (
    assignmentId: string,
    classroomId: string,
    given: boolean,
    dueAt: string | null,
  ) =>
    call<{ ok: true }>(
      `/api/assignments/${encodeURIComponent(assignmentId)}/classrooms/${encodeURIComponent(classroomId)}`,
      { method: 'PUT', body: JSON.stringify({ given, dueAt }) },
    ),
  listSeatAwards: (classroomId: string, seatId: string) =>
    call<{ items: SeatAward[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/students/${encodeURIComponent(seatId)}/awards`,
    ),
  setSeatAward: (
    classroomId: string,
    seatId: string,
    awardKey: string,
    granted: boolean,
    note: string | null,
  ) =>
    call<{ items: SeatAward[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/students/${encodeURIComponent(seatId)}/awards/${encodeURIComponent(awardKey)}`,
      { method: 'PUT', body: JSON.stringify({ granted, note }) },
    ),
  classroomAwards: (classroomId: string) =>
    call<{ items: Record<string, string[]> }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/awards`,
    ),
  listClassroomAssignments: (classroomId: string) =>
    call<{ items: ClassroomAssignment[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/assignments`,
    ),
  listAssignableLearningActivities: (classroomId: string) =>
    call<{ items: LearningAssignableActivity[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/learning/activities`,
    ),
  assignLearningActivity: (
    classroomId: string,
    input: {
      activityVersionId: string;
      audienceType: 'whole_class' | 'named_learners';
      seatIds: string[];
      dueAt: string | null;
      requestId: string;
    },
  ) =>
    call<{
      assignmentId: string;
      activityRunId: string;
      audienceId: string;
      assignedCount: number;
      reused: boolean;
    }>(`/api/classrooms/${encodeURIComponent(classroomId)}/learning/activity-runs`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listQuestionBank: () => call<{ items: QuestionBankItem[] }>('/api/classrooms/learning/questions'),
  createQuestion: (input: {
    type: QuizQuestionType;
    prompt: string;
    options?: Array<{ id: string; label: string }>;
    correctAnswer: string | string[] | boolean | number;
    tolerance?: number;
    maxPoints?: number;
    scope?: 'personal' | 'school';
  }) =>
    call<{ id: string; versionId: string }>('/api/classrooms/learning/questions', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listQuizzes: () => call<{ items: QuizVersion[] }>('/api/classrooms/learning/quizzes'),
  createQuiz: (input: {
    title: string;
    instructions: string | null;
    questionVersionIds: string[];
    attemptLimit: number;
    timeLimitMinutes: number | null;
    passThreshold: number;
    feedbackReleasePolicy: 'immediate' | 'score_only' | 'after_close';
  }) =>
    call<{ id: string; activityVersionId: string; totalPoints: number }>(
      '/api/classrooms/learning/quizzes',
      { method: 'POST', body: JSON.stringify(input) },
    ),
  assignQuiz: (classroomId: string, quizVersionId: string, dueAt: string | null) =>
    call<{ assignmentId: string; reused: boolean }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/quizzes`,
      { method: 'POST', body: JSON.stringify({ quizVersionId, dueAt }) },
    ),
  createClassroomAssignment: (
    classroomId: string,
    input: { title: string; brief: string | null; moduleKey: string; dueAt: string | null },
  ) =>
    call<{ created: true }>(`/api/classrooms/${encodeURIComponent(classroomId)}/assignments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  setClassroomAssignmentStatus: (
    classroomId: string,
    assignmentId: string,
    status: 'open' | 'closed',
  ) =>
    call<{ ok: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(assignmentId)}/status`,
      { method: 'POST', body: JSON.stringify({ status }) },
    ),
  deleteClassroomAssignment: (classroomId: string, assignmentId: string) =>
    call<{ removed: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(assignmentId)}`,
      { method: 'DELETE' },
    ),
  classroomAssignmentProgress: (classroomId: string, assignmentId: string) =>
    call<{ items: ClassroomAssignmentProgress[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(assignmentId)}/progress`,
    ),
  seatAssignments: () => call<{ items: SeatAssignment[] }>('/api/class-join/me/assignments'),
  seatQuizzes: () => call<{ items: LearnerQuiz[] }>('/api/class-join/me/quizzes'),
  seatResults: () => call<{ items: LearnerResult[] }>('/api/class-join/me/results'),
  accountResults: () => call<{ items: LearnerResult[] }>('/api/class-join/account/results'),
  accountQuizzes: () => call<{ items: LearnerQuiz[] }>('/api/class-join/account/quizzes'),
  submitSeatQuiz: (
    assignmentId: string,
    answers: Array<{ questionVersionId: string; answer: Record<string, unknown> }>,
  ) =>
    call<{
      attemptId: string;
      submissionId: string;
      attemptNumber: number;
      points: number;
      maxPoints: number;
      percentage: number;
      outcome: 'passed' | 'failed';
      lateState: 'on_time' | 'late';
      questionResults: Array<{
        questionVersionId: string;
        correct: boolean;
        points: number;
        maxPoints: number;
      }>;
      reused: boolean;
    }>(`/api/class-join/me/quizzes/${encodeURIComponent(assignmentId)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ answers, clientRequestId: `quiz:${crypto.randomUUID()}` }),
    }),
  seatCourseRuns: () => call<{ items: SeatCourseRun[] }>('/api/class-join/me/course-runs'),
  accountCourseRuns: () => call<{ items: SeatCourseRun[] }>('/api/class-join/account/course-runs'),
  setSeatCourseLessonProgress: (runId: string, lessonId: string, completed: boolean) =>
    call<{ completedAt: string | null }>(
      `/api/class-join/me/course-runs/${encodeURIComponent(runId)}/lessons/${encodeURIComponent(
        lessonId,
      )}/progress`,
      { method: 'POST', body: JSON.stringify({ completed }) },
    ),
  setAccountCourseLessonProgress: (runId: string, lessonId: string, completed: boolean) =>
    call<{ completedAt: string | null }>(
      `/api/class-join/account/course-runs/${encodeURIComponent(runId)}/lessons/${encodeURIComponent(
        lessonId,
      )}/progress`,
      { method: 'POST', body: JSON.stringify({ completed }) },
    ),
  mySeatAwards: () => call<{ items: SeatAward[] }>('/api/class-join/me/awards'),
  seatAssignmentCounts: () =>
    call<{ open: number; unfinished: number }>('/api/class-join/me/assignment-counts'),
  startSeatAssignment: (assignmentId: string, projectId: string) =>
    call<{
      projectId: string;
      submittedAt: string | null;
      participationId: string | null;
      attemptId: string | null;
      attemptNumber: number | null;
      state: LearningAttemptState | null;
      reused: boolean;
    }>(`/api/class-join/me/assignments/${encodeURIComponent(assignmentId)}/work`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  submitSeatAssignment: (assignmentId: string, submitted: boolean) =>
    call<{
      projectId: string;
      projectVersionId: string;
      participationId: string | null;
      attemptId: string;
      submissionId: string;
      attemptNumber: number;
      state: LearningAttemptState;
      submittedAt: string;
      lateState: 'on_time' | 'late' | 'excused';
      reused: boolean;
    }>(`/api/class-join/me/assignments/${encodeURIComponent(assignmentId)}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        submitted,
        clientRequestId: `submit:${crypto.randomUUID()}`,
      }),
    }),
  updateClassroom: (
    classroomId: string,
    input: {
      title?: string;
      ageBand?: Classroom['ageBand'];
      topicKeys?: string[];
      safeModeDefault?: boolean;
    },
  ) =>
    call<{ classroom: Classroom }>(`/api/classrooms/${encodeURIComponent(classroomId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  setClassroomStatus: (classroomId: string, status: ClassroomStatus) =>
    call<{ classroom?: Classroom; removed?: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/status`,
      { method: 'POST', body: JSON.stringify({ status }) },
    ),
  setAccountTimeZone: (timeZone: string, onlyIfUnset: boolean) =>
    call<{ timeZone: string | null }>('/api/account/time-zone', {
      method: 'PUT',
      body: JSON.stringify({ timeZone, onlyIfUnset }),
    }),
  updateClassroomPolicy: (classroomId: string, safeModeDefault: boolean) =>
    call<{ classroom: Classroom }>(`/api/classrooms/${encodeURIComponent(classroomId)}/policies`, {
      method: 'PATCH',
      body: JSON.stringify({ safeModeDefault }),
    }),
  rotateClassroomJoinCode: (classroomId: string) =>
    call<{ classroom: Classroom }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/join-code/rotate`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  revokeClassroomJoinCode: (classroomId: string) =>
    call<{ classroom: Classroom }>(`/api/classrooms/${encodeURIComponent(classroomId)}/join-code`, {
      method: 'DELETE',
    }),
  listClassroomTeachers: (classroomId: string) =>
    call<{ items: ClassroomTeacher[]; invitations: ClassroomTeacherInvitation[] }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/teachers`,
    ),
  createClassroomTeacherInvitation: (classroomId: string) =>
    call<{ invitation: ClassroomTeacherInvitation & { invitePath: string } }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/teacher-invitations`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  revokeClassroomTeacherInvitation: (classroomId: string, invitationId: string) =>
    call<{ revoked: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/teacher-invitations/${encodeURIComponent(invitationId)}`,
      { method: 'DELETE' },
    ),
  removeClassroomTeacher: (classroomId: string, teacherAccountId: string) =>
    call<{ removed: true }>(
      `/api/classrooms/${encodeURIComponent(classroomId)}/teachers/${encodeURIComponent(teacherAccountId)}`,
      { method: 'DELETE' },
    ),
  resolveClassroomTeacherInvitation: (token: string) =>
    call<{ invitation: ClassroomTeacherInvitationPreview }>(
      `/api/classroom-teacher-invitations/${encodeURIComponent(token)}`,
    ),
  acceptClassroomTeacherInvitation: (token: string) =>
    call<{ classroom: { id: string; title: string; role: 'co_teacher' } }>(
      `/api/classroom-teacher-invitations/${encodeURIComponent(token)}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  resolveClassroomCode: (code: string) =>
    call<{
      classroom: { id: string; title: string; teacherDisplayName: string; safeMode: boolean };
    }>('/api/class-join/resolve', { method: 'POST', body: JSON.stringify({ code }) }),
  signInClassroomSeat: (code: string, loginHandle: string, botProof: BotProof) =>
    call<ClassroomStudentSession>('/api/class-join/studentseat', {
      method: 'POST',
      body: JSON.stringify({ code, loginHandle, botProof }),
    }),
  classroomStudentMe: () =>
    call<ClassroomStudentSession | { authenticated: false }>('/api/class-join/me'),
  classroomStudentLogout: () =>
    call<{ ok: true }>('/api/class-join/logout', { method: 'POST', body: JSON.stringify({}) }),
  listProjects: (options: ProjectListOptions = {}) => {
    const query = new URLSearchParams();
    if (options.scope) query.set('scope', options.scope);
    if (options.classroomId) query.set('classroomId', options.classroomId);
    if (options.status) query.set('status', options.status);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return call<{ items: Project[] }>(`/api/projects${suffix}`);
  },
  suggestProjectTitle: (options: ProjectTitleSuggestionOptions) => {
    const query = new URLSearchParams({ scope: options.scope, module: options.module });
    if (options.scope === 'classroom' && options.classroomId) {
      query.set('classroomId', options.classroomId);
    }
    return call<{ title: string; sequence: number }>(
      `/api/projects/title-suggestion?${query.toString()}`,
    );
  },
  createProject: (options: CreateProjectOptions) =>
    call<{ project: Project; created: boolean }>('/api/projects', {
      method: 'POST',
      headers: { 'idempotency-key': options.idempotencyKey },
      body: JSON.stringify({
        scope: options.scope,
        classroomId: options.classroomId ?? null,
        module: options.module,
        title: options.title,
        ...(options.automaticTitle === undefined ? {} : { automaticTitle: options.automaticTitle }),
      }),
    }),
  renameProject: (projectId: string, title: string) =>
    call<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  duplicateProject: (projectId: string, title: string, idempotencyKey: string) =>
    call<{ project: Project; created: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/duplicate`,
      {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ title }),
      },
    ),
  changeProjectStatus: (projectId: string, status: ProjectStatus) =>
    call<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  openProject: <TDocument = unknown, TResult = unknown>(projectId: string) =>
    call<{
      project: Project;
      draft: ProjectDraft<TDocument>;
      versions: ProjectVersion[];
      result: TResult | null;
    }>(`/api/projects/${encodeURIComponent(projectId)}`),
  saveDraft: async <TDocument = unknown, TResult = unknown>(
    projectId: string,
    document: TDocument,
    baseRevision: number,
  ) => {
    const mutationId = await projectDraftMutationId(projectId, baseRevision, document);
    return call<{ draft: ProjectDraft<TDocument>; result: TResult | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/draft`,
      {
        method: 'PUT',
        body: JSON.stringify({ document, baseRevision, mutationId }),
      },
    );
  },
  /**
   * Uploads the editor's picture of the project. `keepalive` lets a capture
   * taken while the page is closing still leave the browser; it caps the body
   * at roughly 64 KB, which the caller enforces before getting here.
   */
  saveProjectSnapshot: (
    projectId: string,
    imageDataUrl: string,
    sourceRevision: number,
    options: { unloading?: boolean } = {},
  ) =>
    call<{ snapshot: ProjectSnapshotInfo }>(
      `/api/projects/${encodeURIComponent(projectId)}/snapshot`,
      {
        method: 'PUT',
        body: JSON.stringify({ imageDataUrl, sourceRevision }),
        ...(options.unloading === true ? { keepalive: true } : {}),
      },
    ),
  myProjectFeedback: () =>
    call<{ items: Record<string, ProjectFeedback> }>('/api/projects/feedback'),
  projectFeedback: (projectId: string) =>
    call<{ items: ProjectFeedback[] }>(`/api/projects/${encodeURIComponent(projectId)}/feedback`),
  saveProjectFeedback: (projectId: string, input: { badge: string | null; comment: string }) =>
    call<{ feedback: ProjectFeedback }>(`/api/projects/${encodeURIComponent(projectId)}/feedback`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  listVersions: (projectId: string) =>
    call<{ versions: ProjectVersion[] }>(`/api/projects/${encodeURIComponent(projectId)}/versions`),
  restoreVersion: <TDocument = unknown>(projectId: string, versionId: string) =>
    call<{ draft: ProjectDraft<TDocument>; versions: ProjectVersion[] }>(
      `/api/projects/${encodeURIComponent(projectId)}/versions/${encodeURIComponent(versionId)}/restore`,
      { method: 'POST' },
    ),
  createCheckpoint: (projectId: string, label?: string) =>
    call<{ version: ProjectVersion }>(
      `/api/projects/${encodeURIComponent(projectId)}/checkpoints`,
      { method: 'POST', body: JSON.stringify(label ? { label } : {}) },
    ),
  loadCheckersStudentState: <TDocument = unknown>(projectId: string) =>
    call<{
      role: 'student';
      document: TDocument;
      revision: number;
      updatedAt: string | null;
      teacherFeedback: CheckersTeacherFeedback[];
    }>(`/api/checkers/projects/${encodeURIComponent(projectId)}/state`),
  saveCheckersStudentState: <TDocument = unknown>(projectId: string, document: TDocument) =>
    call<{ document: TDocument; revision: number; updatedAt: string }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/state`,
      { method: 'PUT', body: JSON.stringify({ document }) },
    ),
  checkersClassroom: <TAssignment = unknown, TProgress = unknown, TEvidence = unknown>(
    projectId: string,
  ) =>
    call<{
      assignments: TAssignment[];
      students: CheckersClassroomStudent<TProgress, TEvidence>[];
      safetySignals: CheckersSafetySignal[];
    }>(`/api/checkers/projects/${encodeURIComponent(projectId)}/classroom`),
  enrolCheckersStudent: (projectId: string, email: string) =>
    call<{
      student: {
        student_user_id: string;
        student_account_id: string;
        display_name: string;
        email: string;
      };
    }>(`/api/checkers/projects/${encodeURIComponent(projectId)}/students`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  loadCheckersClassPlay: <TDocument = unknown>(projectId: string) =>
    call<CheckersClassPlay<TDocument>>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/play`,
    ),
  createCheckersChallenge: (
    projectId: string,
    opponentId: string,
    mode: 'friendly' | 'team' = 'friendly',
  ) =>
    call<{ game: { id: string; status: string; version: number } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/challenges`,
      { method: 'POST', body: JSON.stringify({ opponentId, mode }) },
    ),
  createCheckersTeacherEvent: (projectId: string, lightPlayerId: string, darkPlayerId: string) =>
    call<{ game: { id: string; status: string; version: number } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/events`,
      { method: 'POST', body: JSON.stringify({ lightPlayerId, darkPlayerId }) },
    ),
  acceptCheckersChallenge: (projectId: string, gameId: string) =>
    call<{ game: { id: string; status: string; version: number } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  playCheckersClassMove: (
    projectId: string,
    gameId: string,
    input: { expectedVersion: number; pieceId: string; path: readonly string[] },
  ) =>
    call<{ game: { document_json: unknown; status: string; version: number; updated_at: string } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/moves`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  sendCheckersReaction: (projectId: string, gameId: string, reactionId: string) =>
    call<{ reaction: { id: string; reaction_id: string; created_at: string } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/reactions`,
      { method: 'POST', body: JSON.stringify({ reactionId }) },
    ),
  muteCheckersReactions: (projectId: string, muted: boolean) =>
    call<{ muted: boolean }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/reactions/mute`,
      { method: 'PUT', body: JSON.stringify({ muted }) },
    ),
  reportCheckersReaction: (projectId: string, gameId: string, reactionEventId: string) =>
    call<{ reported: true }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/reactions/${encodeURIComponent(reactionEventId)}/report`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  sendCheckersTeacherFeedback: (
    projectId: string,
    studentId: string,
    feedbackId: CheckersTeacherFeedbackId,
  ) =>
    call<{ feedback: CheckersTeacherFeedback }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/feedback`,
      { method: 'POST', body: JSON.stringify({ studentId, feedbackId }) },
    ),
  createClassroom: (
    input: {
      title: string;
      ageBand: Classroom['ageBand'];
      topicKeys: string[];
      safeModeDefault: boolean;
    },
    idempotencyKey: string,
  ) =>
    call<{ classroom: Classroom; created: boolean }>('/api/classrooms', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify(input),
    }),
};
