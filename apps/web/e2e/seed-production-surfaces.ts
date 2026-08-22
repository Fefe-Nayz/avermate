import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { and, asc, eq, isNull } from "drizzle-orm"
import { auth } from "../../server/src/lib/auth"
import { db } from "../../server/src/db"
import {
  artifactWorkflowRuns,
  artifactWorkflowStages,
  gradeAttachments,
  grades,
  learningConcepts,
  learningConceptSets,
  learningCopyAnalyses,
  learningObjectives,
  learningPreferences,
  managedBetaAccounts,
  materialDocuments,
  periods,
  preferences,
  studyDocuments,
  studyProjectItems,
  studyProjects,
  subjects,
  syncConnections,
  syncGradeRecords,
  type QuizContentV2,
  users,
  years,
} from "../../server/src/db/schema"
import { buildCopyProposal } from "../../server/src/learning/copy-analysis"
import { CoreArtifactGraphStore } from "../../server/src/ingestion/artifact-graph"
import { storeFile } from "../../server/src/lib/storage"
import { coreNodeRegistry } from "../../server/src/node/services"
import { coreCorpusIndexService } from "../../server/src/search/index-service"
import {
  estimateTokens,
  normalizeForSearch,
  sha256,
  utf8Size,
} from "../../server/src/search/values"
import { defaultDevZeroConfig } from "../../node/src/config"
import { loadOrCreateNodeIdentity } from "../../node/src/identity"
import { buildManifest, PairingManager } from "../../node/src/protocol"

const PASSWORD = "assistant-e2e-password"
const MAIN_EMAIL = "assistant-e2e@example.com"
const NODE_EMAIL = "node-e2e@example.com"
const CUSTOMER_EMAIL = "managed-customer-e2e@example.com"
const ADMIN_EMAIL = "managed-admin-e2e@example.com"

function requiredFixtureRoot() {
  const value = process.env.AVERMATE_ASSISTANT_E2E_ROOT
  if (!value) throw new Error("AVERMATE_ASSISTANT_E2E_ROOT is required")
  return value
}

const root = requiredFixtureRoot()

async function account(email: string, name: string, role = "user") {
  let [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  if (!user) {
    await auth.api.signUpEmail({ body: { name, email, password: PASSWORD } })
    ;[user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1)
  }
  if (!user) throw new Error(`Unable to create ${email}`)
  await db
    .update(users)
    .set({ emailVerified: true, role })
    .where(eq(users.id, user.id))
  await db.insert(preferences).values({ userId: user.id }).onConflictDoNothing()

  let [year] = await db
    .select()
    .from(years)
    .where(eq(years.userId, user.id))
    .orderBy(asc(years.sortOrder))
    .limit(1)
  if (!year) {
    ;[year] = await db
      .insert(years)
      .values({
        name: "E2E 2026–2027",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: user.id,
      })
      .returning()
    if (!year) throw new Error(`Unable to create a year for ${email}`)
    await db.insert(periods).values({
      name: "E2E Term",
      startAt: year.startsAt,
      endAt: year.endsAt,
      yearId: year.id,
      userId: user.id,
    })
  }
  return { user, year }
}

async function mainScope() {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, MAIN_EMAIL))
    .limit(1)
  if (!user) throw new Error("Run the full demo seed before the E2E fixture")
  const [year] = await db
    .select()
    .from(years)
    .where(eq(years.userId, user.id))
    .orderBy(asc(years.sortOrder))
    .limit(1)
  if (!year) throw new Error("The full demo seed did not create a year")
  const yearPeriods = await db
    .select()
    .from(periods)
    .where(and(eq(periods.userId, user.id), eq(periods.yearId, year.id)))
    .orderBy(asc(periods.sortOrder))
  const now = new Date()
  const period =
    yearPeriods.find(
      (candidate) =>
        candidate.startAt.getTime() <= now.getTime() &&
        candidate.endAt.getTime() >= now.getTime()
    ) ?? yearPeriods.at(-1)
  const [subject] = await db
    .select()
    .from(subjects)
    .where(and(eq(subjects.userId, user.id), eq(subjects.yearId, year.id)))
    .orderBy(asc(subjects.sortOrder))
    .limit(1)
  const [material] = await db
    .select()
    .from(materialDocuments)
    .where(
      and(
        eq(materialDocuments.userId, user.id),
        eq(materialDocuments.yearId, year.id),
        isNull(materialDocuments.deletedAt)
      )
    )
    .limit(1)
  if (!period || !subject || !material) {
    throw new Error("The full demo seed did not create the required scope")
  }
  return { user, year, period, subject, material }
}

async function seedRetrieval(scope: Awaited<ReturnType<typeof mainScope>>) {
  const [project] = await db
    .insert(studyProjects)
    .values({
      title: "E2E Retrieval Project",
      description:
        "Production browser proof for lexical retrieval and locators.",
      yearId: scope.year.id,
      subjectId: scope.subject.id,
      retrievalMode: "lexical-only",
      retrievalFallbackPolicy: "lexical-only",
      userId: scope.user.id,
    })
    .returning()
  if (!project) throw new Error("Unable to create the retrieval project")

  const text =
    "La dérivée mesure le taux de variation local d'une fonction. Ce passage de cinématique fournit la preuve E2E exacte."
  const identity = {
    ownerId: scope.user.id,
    originKind: "material" as const,
    originId: scope.material.id,
  }
  const source = await coreCorpusIndexService.store.registerSource({
    ...identity,
    yearId: scope.year.id,
    subjectId: scope.subject.id,
    coverage: "searchable-native-text",
  })
  const staged = await coreCorpusIndexService.store.stageVersion({
    identity,
    sourceId: source.id,
    versionKey: "e2e-retrieval-v1",
    contentHash: sha256(text),
    extractorId: "e2e-browser-fixture",
    extractorVersion: "1",
    mimeType: "application/pdf",
    language: "fr",
    byteSize: utf8Size(text),
    locatorSchemaVersion: 1,
    metadata: { fixture: true, evidence: "synthetic-source-text" },
    chunks: [
      {
        ordinal: 0,
        text,
        normalizedText: normalizeForSearch(text),
        tokenEstimate: estimateTokens(text),
        contentHash: sha256(text),
        locator: {
          kind: "pdf" as const,
          page: 3,
          bbox: [0.1, 0.2, 0.9, 0.4] as [number, number, number, number],
        },
        headingPath: null,
        evidenceKind: "native-text" as const,
      },
    ],
  })
  const committed = await coreCorpusIndexService.store.commitVersion({
    ownerId: scope.user.id,
    stagingId: staged.stagingId,
    expectedSourceId: source.id,
    expectedPreviousVersionId: null,
  })
  await db.insert(studyProjectItems).values({
    projectId: project.id,
    kind: "material",
    referenceId: scope.material.id,
    sourceVersionId: committed.versionId,
    trackingMode: "pinned",
    label: "Cours de cinématique",
  })
  return {
    projectId: project.id,
    materialId: scope.material.id,
    sourceVersionId: committed.versionId,
  }
}

async function seedLearning(scope: Awaited<ReturnType<typeof mainScope>>) {
  const [grade] = await db
    .insert(grades)
    .values({
      name: "E2E Provider Grade",
      value: 13,
      outOf: 20,
      coefficient: 1,
      passedAt: new Date(
        scope.period.startAt.getTime() +
          (scope.period.endAt.getTime() - scope.period.startAt.getTime()) / 2
      ),
      subjectId: scope.subject.id,
      periodId: scope.period.id,
      yearId: scope.year.id,
      userId: scope.user.id,
    })
    .returning()
  if (!grade) throw new Error("Unable to create the provider grade")

  const [connection] = await db
    .insert(syncConnections)
    .values({
      provider: "pronote",
      label: "Pronote E2E fixture (not a live provider)",
      baseUrl: "https://fixture.invalid",
      capabilities: ["grades"],
      status: "active",
      remoteStudentId: "e2e-student-stable-id",
      remoteAcademicYearId: "e2e-remote-year-stable-id",
      gradesAuthority: true,
      yearId: scope.year.id,
      userId: scope.user.id,
    })
    .returning()
  if (!connection) throw new Error("Unable to create the provider projection")
  await db.insert(syncGradeRecords).values({
    connectionId: connection.id,
    externalId: "e2e-provider-grade-1",
    title: grade.name,
    providerSubjectExternalId: "e2e-provider-subject",
    providerSubjectName: scope.subject.name,
    providerPeriodExternalId: "e2e-provider-period",
    providerPeriodName: scope.period.name,
    passedAt: grade.passedAt,
    value: grade.value,
    outOf: grade.outOf,
    coefficient: grade.coefficient,
    significant: true,
    syncState: "managed",
    localGradeId: grade.id,
    yearId: scope.year.id,
    userId: scope.user.id,
  })

  const pdf = new TextEncoder().encode(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
  )
  const stored = await storeFile({
    userId: scope.user.id,
    purpose: "grade-copy",
    nameHint: "e2e-provider-copy.pdf",
    file: new File([pdf], "e2e-provider-copy.pdf", {
      type: "application/pdf",
    }),
  })
  const [attachment] = await db
    .insert(gradeAttachments)
    .values({
      gradeId: grade.id,
      fileId: stored.id,
      label: "Reviewed provider copy",
      userId: scope.user.id,
    })
    .returning()
  if (!attachment) throw new Error("Unable to create the grade attachment")

  await db
    .insert(learningPreferences)
    .values({ userId: scope.user.id, analysisEnabled: true })
    .onConflictDoUpdate({
      target: learningPreferences.userId,
      set: { analysisEnabled: true, updatedAt: new Date() },
    })
  const [set] = await db
    .insert(learningConceptSets)
    .values({
      title: "E2E Learning Objectives",
      namespace: "local",
      locale: "fr",
      yearId: scope.year.id,
      subjectId: scope.subject.id,
      userId: scope.user.id,
    })
    .returning()
  if (!set) throw new Error("Unable to create the learning concept set")
  const [concept] = await db
    .insert(learningConcepts)
    .values({
      setId: set.id,
      stableKey: "derivative-rate",
      canonicalLabel: "Dérivation",
      yearId: scope.year.id,
      subjectId: scope.subject.id,
      userId: scope.user.id,
    })
    .returning()
  if (!concept) throw new Error("Unable to create the learning concept")
  const [objective] = await db
    .insert(learningObjectives)
    .values({
      conceptId: concept.id,
      statement: "Interpréter une dérivée comme un taux de variation",
      expectedLevel: 3,
      yearId: scope.year.id,
      subjectId: scope.subject.id,
      userId: scope.user.id,
    })
    .returning()
  if (!objective) throw new Error("Unable to create the learning objective")

  const sourceDigest = createHash("sha256").update(pdf).digest("hex")
  const proposal = buildCopyProposal(
    {
      markdown:
        "Dérivation et taux de variation : 6 / 10. Attention, erreur de calcul à revoir.",
      pageCount: 1,
      providerFileId: stored.id,
      pages: [
        {
          providerIndex: 0,
          markdown:
            "Dérivation et taux de variation : 6 / 10. Attention, erreur de calcul à revoir.",
        },
      ],
    },
    [
      {
        id: objective.id,
        statement: objective.statement,
        conceptLabel: concept.canonicalLabel,
      },
    ]
  )
  const [analysis] = await db
    .insert(learningCopyAnalyses)
    .values({
      attachmentId: attachment.id,
      gradeId: grade.id,
      sourceFileId: stored.id,
      sourceDigest,
      provider: "fixture",
      model: "deterministic-copy-fixture",
      modelRevision: "e2e-v1",
      status: "proposed",
      pageCount: 1,
      proposalVersion: 1,
      proposalJson: proposal,
      yearId: scope.year.id,
      periodId: scope.period.id,
      subjectId: scope.subject.id,
      userId: scope.user.id,
    })
    .returning()
  if (!analysis) throw new Error("Unable to create the copy proposal")

  const quiz: QuizContentV2 = {
    version: 2,
    questions: [
      {
        kind: "mcq",
        id: "q-e2e-1",
        prompt: "Combien vaut 2 + 2 ?",
        choices: ["3", "4", "5"],
        answers: [1],
        why: "Deux plus deux vaut quatre.",
        objectiveIds: [objective.id],
        difficulty: 0.3,
        sourceProofs: [
          {
            sourceKind: "grade-copy",
            sourceId: analysis.id,
            sourceVersion: "1",
            locator: { kind: "pdf", page: 1 },
          },
        ],
        rubricRevision: "deterministic-v1",
        rubric: { scoringMode: "deterministic" },
        validationState: "reviewed",
      },
    ],
  }
  const [quizDocument] = await db
    .insert(studyDocuments)
    .values({
      kind: "quiz",
      title: "E2E Mastery Quiz",
      bodyMarkdown: "",
      metaVersion: 2,
      metaJson: quiz,
      subjectId: scope.subject.id,
      yearId: scope.year.id,
      userId: scope.user.id,
    })
    .returning()
  if (!quizDocument) throw new Error("Unable to create the mastery quiz")
  return {
    analysisId: analysis.id,
    gradeId: grade.id,
    objectiveId: objective.id,
    quizId: quizDocument.id,
  }
}

async function seedNode() {
  const identity = await loadOrCreateNodeIdentity(
    join(root, "node-identity.json")
  )
  const config = defaultDevZeroConfig(join(root, "node-data"))
  const pairing = new PairingManager(identity)
  const created = pairing.create()
  const manifest = buildManifest({
    identity,
    config,
    features: {
      storage: {
        version: 1,
        maxObjectBytes: config.storage.maxObjectBytes,
        multipart: false,
        directTransfer: false,
        encryptionModes: ["transport-tls"],
      },
    },
    storageUsedBytes: 0,
  })
  await coreNodeRegistry.registerPairing(
    pairing.registration(created.offer, manifest)
  )
  return {
    pairingCode: created.code,
    nodeId: identity.nodeId,
    fingerprint: created.offer.fingerprint,
  }
}

async function seedMedia(
  scope: Awaited<ReturnType<typeof mainScope>>,
  retrieval: Awaited<ReturnType<typeof seedRetrieval>>
) {
  const graph = new CoreArtifactGraphStore()
  const firstBytes = new TextEncoder().encode(
    "%PDF-1.4\n% E2E revision one\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
  )
  const secondBytes = new TextEncoder().encode(
    "%PDF-1.4\n% E2E revision two\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n"
  )
  const [firstFile, secondFile] = await Promise.all([
    storeFile({
      userId: scope.user.id,
      purpose: "document-artifact",
      nameHint: "e2e-study-guide-r1.pdf",
      file: new File([firstBytes], "e2e-study-guide-r1.pdf", {
        type: "application/pdf",
      }),
    }),
    storeFile({
      userId: scope.user.id,
      purpose: "document-artifact",
      nameHint: "e2e-study-guide-r2.pdf",
      file: new File([secondBytes], "e2e-study-guide-r2.pdf", {
        type: "application/pdf",
      }),
    }),
  ])
  const planned = await graph.plan({
    ownerId: scope.user.id,
    projectId: retrieval.projectId,
    kind: "pdf",
    title: "E2E Revisioned Study Guide",
    sourceVersionIds: [retrieval.sourceVersionId],
    placement: "core",
    policyRef: "e2e-media-fixture-v1",
    idempotencyKey: "e2e-media-artifact",
  })
  const first = await graph.publishRevision({
    ownerId: scope.user.id,
    artifactId: planned.artifactId,
    workflowRunId: planned.id,
    sourceVersionIds: [retrieval.sourceVersionId],
    renderer: {
      profile: "fixture.pdf.v1",
      imageDigest: null,
      toolVersions: { fixture: "1" },
      reproducibility: "full",
    },
    output: {
      fileId: firstFile.id,
      digest: createHash("sha256").update(firstBytes).digest("hex"),
      bytes: firstBytes.byteLength,
      mime: "application/pdf",
    },
  })
  await graph.promote({
    ownerId: scope.user.id,
    artifactId: planned.artifactId,
    artifactRevisionId: first.artifactRevisionId,
    expectedIdentityRevision: 1,
  })
  const second = await graph.publishRevision({
    ownerId: scope.user.id,
    artifactId: planned.artifactId,
    workflowRunId: planned.id,
    parentArtifactRevisionIds: [first.artifactRevisionId],
    sourceVersionIds: [retrieval.sourceVersionId],
    renderer: {
      profile: "fixture.pdf.v2",
      imageDigest: null,
      toolVersions: { fixture: "2" },
      reproducibility: "full",
    },
    output: {
      fileId: secondFile.id,
      digest: createHash("sha256").update(secondBytes).digest("hex"),
      bytes: secondBytes.byteLength,
      mime: "application/pdf",
    },
  })
  await graph.promote({
    ownerId: scope.user.id,
    artifactId: planned.artifactId,
    artifactRevisionId: second.artifactRevisionId,
    expectedIdentityRevision: 2,
  })
  const completedAt = new Date()
  await db
    .update(artifactWorkflowStages)
    .set({
      status: "completed",
      attempt: 1,
      processed: 1,
      total: 1,
      outputArtifactRevisionId: second.artifactRevisionId,
      startedAt: completedAt,
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(artifactWorkflowStages.runId, planned.id))
  await db
    .update(artifactWorkflowRuns)
    .set({
      status: "completed",
      completedAt,
      updatedAt: completedAt,
    })
    .where(eq(artifactWorkflowRuns.id, planned.id))
  return { artifactId: planned.artifactId, completedRunId: planned.id }
}

async function seedManaged() {
  const customer = await account(CUSTOMER_EMAIL, "Managed E2E customer")
  await db.insert(managedBetaAccounts).values({
    accountId: customer.user.id,
    cohort: "e2e",
    region: "eu-west",
    state: "active",
    acceptedTermsRevision: "e2e-terms-v1",
    acceptedPrivacyRevision: "e2e-privacy-v1",
    managedDataConsent: true,
    consentedCategoriesJson: ["files", "retrieval"],
    capabilitiesJson: ["storage.bytes", "ocr.pages"],
    policyRevision: "e2e-policy-v1",
    activatedAt: new Date(),
  })
  await account(ADMIN_EMAIL, "Managed E2E operator", "admin")
}

const scope = await mainScope()
const retrieval = await seedRetrieval(scope)
const learning = await seedLearning(scope)
await account(NODE_EMAIL, "Node E2E owner")
const node = await seedNode()
await seedManaged()
const media = await seedMedia(scope, retrieval)

await mkdir(root, { recursive: true })
await writeFile(
  join(root, "e2e-fixture.json"),
  `${JSON.stringify(
    {
      retrieval,
      learning,
      node,
      media,
    },
    null,
    2
  )}\n`,
  "utf8"
)

const digest = createHash("sha256")
  .update(JSON.stringify(retrieval))
  .digest("hex")
console.log(`Production E2E surface fixture ready (${digest.slice(0, 12)}).`)
