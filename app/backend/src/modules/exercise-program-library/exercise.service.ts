// Exercise & Program module — Exercise library business logic
// (docs/04-design/api-design.md's "Exercise Library" section; domain-model.md
// BR-6 for version immutability).
//
// IMPORTANT CONTEXT: like modules/therapist/therapist.service.ts before it, this
// file's controller/routes counterparts were TODO stubs with no real code ever
// written, even though ExerciseLibraryPage.tsx's comments claimed "no
// exercise_library backend endpoint exists yet" (at least that much was
// accurately flagged, unlike the therapist module's false "fully implemented"
// claim). This is the first real implementation.
//
// SCHEMA / DESIGN GAPS this module works around (documented here once):
//
//   1. No family-level identifier. exercise_library models versioning via
//      (parent_exercise_id, version_number), but the schema/docs never pin down
//      what parent_exercise_id points to for version 3+ of a chain: the row's
//      immediate predecessor, or the original v1 row. Both are consistent with
//      the @@unique([parentExerciseId, versionNumber]) constraint and with
//      seed-full.ts (which only ever creates v1 rows with parentExerciseId left
//      null). CHOSEN CONVENTION: parentExerciseId always points at the family's
//      v1 (root) row — never at an intermediate version — so the whole
//      family's version history can be fetched with one flat query
//      (`id = root OR parentExerciseId = root`) instead of walking a chain.
//      This also matches the frontend's existing mental model (types/index.ts's
//      ExerciseLibraryItem.parentExerciseId is a stable "family id" distinct
//      from any version's own row id) more directly than the immediate-
//      predecessor reading would. If a future migration needs the chain
//      reading instead, every write site below (`createExerciseVersion`) is the
//      one place that would need to change.
//
//   2. No Thai name (`name_th`) column on exercise_library — same gap already
//      flagged in therapist.service.ts for patients. The frontend mock
//      (data/exerciseLibraryMock.ts) assumed one existed; real responses from
//      this module simply omit `nameTh`.
//
//   4. api-design.md documents POST /exercises/:id/versions (bump to a new
//      version) and PATCH /exercises/:id/publish (draft -> active) and
//      PATCH /exercises/:id/archive, but has NO route for "edit a draft's
//      fields in place" — which the existing frontend UI already assumed
//      (ExerciseLibraryPage.tsx: "Draft -> editing in place is safe; nothing
//      has ever gone live", only bumping a version when the row being edited
//      is `active`). Rather than inventing a version-bump for a draft edit
//      (which would contradict that UX) or silently dropping the draft-edit
//      capability the page already has, this module adds one additional,
//      undocumented-in-api-design.md endpoint: PATCH /exercises/:id, allowed
//      only while the target row's status is still `draft`. Flagged here and
//      in exercise.routes.ts/exercise.controller.ts rather than silently added.

import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../../common/errors";
import { displayName, relativeDateLabel } from "../../common/formatting";
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

export type ExerciseTrackingType = "pose" | "virtual_grip" | "none";
// Minigame type for virtual_grip exercises — stored in base_criteria as JSON.
export type HandTrackingGameType = "ball-grip" | "path-drag" | "falling-cup";
export type ExerciseDifficulty = "easy" | "medium" | "hard";
export type ExerciseStatus = "draft" | "active" | "archived";

export interface ExerciseBaseCriteria {
  targetAngleDeg?: number;
  targetGripStrength?: number;
  repetitions?: number;
  holdSeconds?: number;
  /**
   * AI pose-reference authored in the AI workspace (CreateExerciseView flow):
   * angle definitions + FSM rep criteria + master/wrong-form feature samples
   * (see modules/pose-scoring/poseScoring.types.ts). Passed through verbatim
   * into exercise_library.base_criteria and consumed by the pose-scoring
   * module's resolvePoseReference().
   */
  poseReference?: Record<string, unknown>;
  /** Minigame type for virtual_grip exercises — stored in base_criteria as JSON. PatientSessionPage reads baseCriteria.virtualGripGameType to know which hand-tracking minigame to load. */
  virtualGripGameType?: HandTrackingGameType;
}

export interface ExerciseVersionSummary {
  id: string;
  versionNumber: number;
  status: ExerciseStatus;
  // Per-version display fields so the frontend's History panel can open an OLD
  // version's own read-only detail view — a version bump can change any of
  // these, so they can't be taken from the family's latest row.
  name: string;
  description: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseDifficulty;
  demoVideoFileId: string | null;
  baseCriteria: ExerciseBaseCriteria;
  createdAtLabel: string;
}

export interface ExerciseLibraryItemDto {
  id: string;
  parentExerciseId: string;
  versionNumber: number;
  name: string;
  description: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseDifficulty;
  hasDemoVideo: boolean;
  demoVideoFileId: string | null;
  demoVideoFile?: {
    id: string;
    originalName: string;
    mimeType: string | null;
    fileSize: number | null;
  } | null;
  baseCriteria: ExerciseBaseCriteria;
  status: ExerciseStatus;
  createdAtLabel: string;
  createdByName: string;
  createdById: string;
  versions: ExerciseVersionSummary[];
}

export interface ExerciseInput {
  name: string;
  description?: string;
  movementTracking: ExerciseTrackingType;
  difficultyLevel: ExerciseDifficulty;
  baseCriteria?: ExerciseBaseCriteria;
  demoVideoFileId?: string | null;
}

type ExerciseRow = Awaited<ReturnType<typeof fetchRowById>>;

// --- Shared row fetch / include -------------------------------------------

const WITH_CREATOR = {
  createdByUser: true,
  demoVideoFile: { select: { id: true, originalName: true, mimeType: true, fileSize: true } }
} as const;

async function fetchRowById(id: string) {
  return prisma.exerciseLibrary.findUnique({ where: { id }, include: WITH_CREATOR });
}

/** See gap #1 above — the stable "family id" is always the root (v1) row's id. */
function familyRootId(row: { id: string; parentExerciseId: string | null }): string {
  return row.parentExerciseId ?? row.id;
}

async function fetchFamily(rootId: string) {
  return prisma.exerciseLibrary.findMany({
    where: { OR: [{ id: rootId }, { parentExerciseId: rootId }] },
    include: WITH_CREATOR,
    orderBy: { versionNumber: "desc" }
  });
}

function toBaseCriteria(value: Prisma.JsonValue | null): ExerciseBaseCriteria {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as ExerciseBaseCriteria;
}

// create/PATCH/version all REPLACE base_criteria wholesale, and several client
// forms only know the manual criteria fields. A pose exercise's AI reference
// (base_criteria.poseReference) is what makes its sessions detect/score reps at
// all — losing it silently makes the session fall back to unrelated default
// criteria — so when an incoming pose payload carries no poseReference, keep the
// one from the row being edited (or, failing that, the newest sibling version
// that has one). Sending an explicit poseReference always wins.
function withInheritedPoseReference(
  input: ExerciseInput,
  candidates: Array<{ baseCriteria: Prisma.JsonValue | null }>
): ExerciseInput {
  if (input.movementTracking !== "pose") return input;
  const incoming = (input.baseCriteria ?? {}) as Record<string, unknown>;
  if (incoming.poseReference !== undefined) return input;
  for (const candidate of candidates) {
    const stored = toBaseCriteria(candidate.baseCriteria) as Record<string, unknown>;
    if (stored.poseReference) {
      return { ...input, baseCriteria: { ...incoming, poseReference: stored.poseReference } as ExerciseBaseCriteria };
    }
  }
  return input;
}

function buildItem(familyRows: NonNullable<ExerciseRow>[]): ExerciseLibraryItemDto {
  const sorted = [...familyRows].sort((a, b) => b.versionNumber - a.versionNumber);
  const latest = sorted[0];

  return {
    id: latest.id,
    parentExerciseId: familyRootId(latest),
    versionNumber: latest.versionNumber,
    name: latest.name,
    description: latest.description ?? "",
    movementTracking: latest.movementTracking,
    difficultyLevel: latest.difficultyLevel,
    hasDemoVideo: latest.demoVideoFileId !== null,
    demoVideoFileId: latest.demoVideoFileId,
    demoVideoFile: latest.demoVideoFile
      ? {
          id: latest.demoVideoFile.id,
          originalName: latest.demoVideoFile.originalName,
          mimeType: latest.demoVideoFile.mimeType,
          fileSize: latest.demoVideoFile.fileSize === null ? null : Number(latest.demoVideoFile.fileSize)
        }
      : null,
    baseCriteria: toBaseCriteria(latest.baseCriteria),
    status: latest.status,
    createdAtLabel: relativeDateLabel(latest.createdAt),
    createdByName: displayName(latest.createdByUser),
    createdById: latest.createdBy,
    versions: sorted.map((v) => ({
      id: v.id,
      versionNumber: v.versionNumber,
      status: v.status,
      name: v.name,
      description: v.description ?? "",
      movementTracking: v.movementTracking,
      difficultyLevel: v.difficultyLevel,
      demoVideoFileId: v.demoVideoFileId,
      baseCriteria: toBaseCriteria(v.baseCriteria),
      createdAtLabel: relativeDateLabel(v.createdAt)
    }))
  };
}

// --- Validation -------------------------------------------------------------

const TRACKING_TYPES: ExerciseTrackingType[] = ["pose", "virtual_grip", "none"];
const DIFFICULTIES: ExerciseDifficulty[] = ["easy", "medium", "hard"];

function sanitizeInput(input: ExerciseInput): Required<Pick<ExerciseInput, "name" | "movementTracking" | "difficultyLevel">> &
  Pick<ExerciseInput, "description" | "baseCriteria" | "demoVideoFileId"> {
  const name = input.name?.trim() ?? "";
  if (!name) throw new ValidationError("Exercise name is required.");
  if (name.length > 150) throw new ValidationError("Exercise name must be 150 characters or fewer.");

  if (!TRACKING_TYPES.includes(input.movementTracking)) {
    throw new ValidationError('movementTracking must be "pose", "virtual_grip", or "none".');
  }
  if (!DIFFICULTIES.includes(input.difficultyLevel)) {
    throw new ValidationError('difficultyLevel must be "easy", "medium", or "hard".');
  }

  return {
    name,
    description: input.description?.trim() ?? "",
    movementTracking: input.movementTracking,
    difficultyLevel: input.difficultyLevel,
    baseCriteria: input.baseCriteria ?? {},
    demoVideoFileId: input.demoVideoFileId ?? null
  };
}

async function validateDemoVideoFile(therapistId: string, fileId: string | null) {
  if (!fileId) return;
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file) throw new ValidationError("Demo video file not found.");
  if (file.fileType !== "video") throw new ValidationError("The selected demo file must be a video.");
  if (file.uploadedBy !== therapistId) throw new ForbiddenError("You can only use files you uploaded.");
}

// --- GET /exercises -----------------------------------------------------------
// Every therapist and admin can view all exercises across the library.
// Grouped into families by familyRootId (parent_exercise_id or id).
export async function getExerciseLibrary(requester: { id: string; role: string }): Promise<ExerciseLibraryItemDto[]> {
  const rows = await prisma.exerciseLibrary.findMany({ include: WITH_CREATOR });

  const families = new Map<string, NonNullable<ExerciseRow>[]>();
  for (const row of rows) {
    const rootId = familyRootId(row);
    const bucket = families.get(rootId) ?? [];
    bucket.push(row);
    families.set(rootId, bucket);
  }

  // Most-recently-touched family first, matching the old mock/local-state
  // behavior of prepending a new/edited exercise to the top of the grid. Sorted
  // by each family's own most recent row's real createdAt Date (captured before
  // buildItem() above converts it into a display-only label), not the label
  // text itself, which isn't chronologically sortable.
  const familyEntries = Array.from(families.values()).map((rows) => ({
    item: buildItem(rows),
    lastTouchedAt: rows.reduce((latest, row) => (row.createdAt > latest ? row.createdAt : latest), rows[0].createdAt)
  }));
  familyEntries.sort((a, b) => b.lastTouchedAt.getTime() - a.lastTouchedAt.getTime());
  return familyEntries.map((entry) => entry.item);
}

// --- GET /exercises/:id --------------------------------------------------------
// Any authenticated therapist or admin can view any exercise in the library.
export async function getExerciseById(
  requester: { id: string; role: string },
  id: string
): Promise<ExerciseLibraryItemDto> {
  const row = await fetchRowById(id);
  if (!row) throw new NotFoundError("Exercise not found.");

  const family = await fetchFamily(familyRootId(row));
  return buildItem(family);
}

// --- POST /exercises ------------------------------------------------------------

export async function createExercise(therapistId: string, input: ExerciseInput): Promise<ExerciseLibraryItemDto> {
  const clean = sanitizeInput(input);
  await validateDemoVideoFile(therapistId, clean.demoVideoFileId ?? null);

  const row = await prisma.exerciseLibrary.create({
    data: {
      versionNumber: 1,
      name: clean.name,
      description: clean.description || null,
      movementTracking: clean.movementTracking,
      difficultyLevel: clean.difficultyLevel,
      baseCriteria: clean.baseCriteria as Prisma.InputJsonValue,
      demoVideoFileId: clean.demoVideoFileId,
      status: "draft",
      createdBy: therapistId
    },
    include: WITH_CREATOR
  });

  return buildItem([row]);
}

// --- PATCH /exercises/:id (addition beyond api-design.md — see gap #4) --------

export async function updateExerciseDraft(
  therapistId: string,
  id: string,
  input: ExerciseInput
): Promise<ExerciseLibraryItemDto> {
  const row = await fetchRowById(id);
  if (!row) throw new NotFoundError("Exercise not found.");
  if (row.createdBy !== therapistId) {
    throw new ForbiddenError("You can only edit your own exercises.");
  }
  if (row.status !== "draft") {
    throw new ConflictError("Only a draft version can be edited in place — publish or version it instead.");
  }

  const clean = sanitizeInput(withInheritedPoseReference(input, [row]));
  await validateDemoVideoFile(therapistId, clean.demoVideoFileId ?? null);
  const updated = await prisma.exerciseLibrary.update({
    where: { id },
    data: {
      name: clean.name,
      description: clean.description || null,
      movementTracking: clean.movementTracking,
      difficultyLevel: clean.difficultyLevel,
      baseCriteria: clean.baseCriteria as Prisma.InputJsonValue,
      demoVideoFileId: clean.demoVideoFileId
    },
    include: WITH_CREATOR
  });

  const family = await fetchFamily(familyRootId(updated));
  return buildItem(family);
}

// --- POST /exercises/:id/versions -----------------------------------------------
// FR-EX-02 / domain-model.md BR-6: editing an ACTIVE exercise creates a new
// version rather than mutating the live row, so plans that already reference
// the old version keep their exact criteria. Any version of the family that's
// currently `active` gets archived in the same transaction (in practice this is
// just the row being edited, since only one version per family is expected to
// be active at a time, but this archives by family+status rather than assuming
// that invariant holds).

export async function createExerciseVersion(
  therapistId: string,
  id: string,
  input: ExerciseInput
): Promise<ExerciseLibraryItemDto> {
  const row = await fetchRowById(id);
  if (!row) throw new NotFoundError("Exercise not found.");
  if (row.createdBy !== therapistId) {
    throw new ForbiddenError("You can only version your own exercises.");
  }

  const rootId = familyRootId(row);
  const family = await fetchFamily(rootId);
  const clean = sanitizeInput(
    withInheritedPoseReference(input, [row, ...[...family].sort((a, b) => b.versionNumber - a.versionNumber)])
  );
  await validateDemoVideoFile(therapistId, clean.demoVideoFileId ?? null);
  const nextVersionNumber = Math.max(...family.map((v) => v.versionNumber)) + 1;
  const activeSiblingIds = family.filter((v) => v.status === "active").map((v) => v.id);

  await prisma.$transaction([
    ...(activeSiblingIds.length > 0
      ? [prisma.exerciseLibrary.updateMany({ where: { id: { in: activeSiblingIds } }, data: { status: "archived" } })]
      : []),
    prisma.exerciseLibrary.create({
      data: {
        parentExerciseId: rootId,
        versionNumber: nextVersionNumber,
        name: clean.name,
        description: clean.description || null,
        movementTracking: clean.movementTracking,
        difficultyLevel: clean.difficultyLevel,
        baseCriteria: clean.baseCriteria as Prisma.InputJsonValue,
        demoVideoFileId: clean.demoVideoFileId,
        status: "draft",
        createdBy: therapistId
      }
    })
  ]);

  const refreshedFamily = await fetchFamily(rootId);
  return buildItem(refreshedFamily);
}

// --- PATCH /exercises/:id/publish -------------------------------------------
// Not currently wired into ExerciseLibraryPage.tsx's UI (it has no "Publish"/
// "Activate" action at all — new exercises are created straight to `draft` and
// the page never offers a way to move one to `active`, which predates this
// pass). Implemented here to match api-design.md and left available for a
// future UI addition, rather than silently omitted.

export async function publishExercise(therapistId: string, id: string): Promise<ExerciseLibraryItemDto> {
  const row = await fetchRowById(id);
  if (!row) throw new NotFoundError("Exercise not found.");
  if (row.createdBy !== therapistId) {
    throw new ForbiddenError("You can only publish your own exercises.");
  }
  if (row.status !== "draft") {
    throw new ConflictError("Only a draft version can be published.");
  }
  // A pose exercise without its AI reference cannot detect or score reps in a
  // patient session, so it must not go live in that state.
  if (row.movementTracking === "pose" && !(toBaseCriteria(row.baseCriteria) as Record<string, unknown>).poseReference) {
    throw new ConflictError(
      "This pose exercise has no AI reference yet — scan its demo video in the AI exercise workspace (and save) before publishing."
    );
  }

  const updated = await prisma.exerciseLibrary.update({ where: { id }, data: { status: "active" }, include: WITH_CREATOR });
  const family = await fetchFamily(familyRootId(updated));
  return buildItem(family);
}

// --- PATCH /exercises/:id/archive -----------------------------------------------

export async function archiveExercise(therapistId: string, id: string): Promise<ExerciseLibraryItemDto> {
  const row = await fetchRowById(id);
  if (!row) throw new NotFoundError("Exercise not found.");
  if (row.createdBy !== therapistId) {
    throw new ForbiddenError("You can only archive your own exercises.");
  }

  // Idempotent rather than a 409 — archiving an already-archived version is
  // harmless and api-design.md's Error Handling table doesn't call out a
  // conflict case for this route (unlike the medical-history attachment
  // routes, which explicitly do).
  if (row.status !== "archived") {
    await prisma.exerciseLibrary.update({ where: { id }, data: { status: "archived" } });
  }

  const family = await fetchFamily(familyRootId(row));
  return buildItem(family);
}
