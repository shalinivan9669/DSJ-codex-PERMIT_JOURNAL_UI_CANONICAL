-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'COMPANY_ADMIN', 'SAFETY_ENGINEER', 'EMPLOYEE_SIGNER');

-- CreateEnum
CREATE TYPE "EmployeeStatus" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "EmployeeKind" AS ENUM ('INTERNAL', 'CONTRACTOR');

-- CreateEnum
CREATE TYPE "BriefingType" AS ENUM ('INTRODUCTORY', 'PRIMARY', 'REPEATED', 'UNSCHEDULED', 'TARGETED');

-- CreateEnum
CREATE TYPE "BriefingJournalKind" AS ENUM ('INTRODUCTORY', 'WORKPLACE');

-- CreateEnum
CREATE TYPE "BriefingStatus" AS ENUM ('DRAFT', 'READY_FOR_SIGNING', 'SIGNED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EmployeeInstructionStatus" AS ENUM ('ASSIGNED', 'OPENED', 'ACKNOWLEDGED', 'SIGNED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "SignatureProvider" AS ENUM ('MOCK_NCALAYER', 'NCALAYER', 'MOCK_PROVIDER', 'NCALAYER_PROVIDER', 'EGOV_MOBILE_QR_PROVIDER', 'SMART_BRIDGE_PROVIDER', 'DIGITAL_ID_PROVIDER', 'TABLET_SIGNATURE_PROVIDER');

-- CreateEnum
CREATE TYPE "SignatureStatus" AS ENUM ('PREPARED', 'SIGNED', 'VERIFIED', 'FAILED', 'REVOKED');

-- CreateEnum
CREATE TYPE "SigningSessionStatus" AS ENUM ('CREATED', 'QR_GENERATED', 'WAITING_FOR_USER', 'CALLBACK_RECEIVED', 'SIGNATURE_RECEIVED', 'VERIFYING', 'COMPLETED', 'EXPIRED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SigningDocumentType" AS ENUM ('BRIEFING_RECORD', 'BRIEFING_JOURNAL_ENTRY', 'EMPLOYEE_DOCUMENT', 'PROTOCOL', 'RESPONSIBILITY_ORDER', 'WORK_PERMIT');

-- CreateEnum
CREATE TYPE "SigningCallbackValidationStatus" AS ENUM ('RECEIVED', 'AUTHENTICATED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SigningCallbackProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "SignatureEvidenceVerificationStatus" AS ENUM ('PENDING', 'PASS', 'FAIL', 'INDETERMINATE');

-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('REPEATED_BRIEFING_DUE', 'REPEATED_BRIEFING_OVERDUE', 'UNSIGNED_RECORD_PENDING', 'SIGNING_LINK_INVITE');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'sent', 'resolved', 'failed');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "NotificationJobStatus" AS ENUM ('queued', 'processing', 'sent', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CERTIFICATE', 'PROTOCOL', 'STATEMENT', 'COMPLETION_CONFIRMATION', 'SAFETY_CERTIFICATE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CompanyDocumentCategory" AS ENUM ('LOCAL_ACT', 'ORDER', 'INSTRUCTION', 'JOURNAL', 'TRAINING_CERTIFICATION');

-- CreateEnum
CREATE TYPE "CompanyDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SafetyCertificateStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TrainingAssignmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ExamAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "CardRequestMode" AS ENUM ('EMPLOYEE', 'REQUEST');

-- CreateEnum
CREATE TYPE "CardRequestType" AS ENUM ('BIOT', 'PTM', 'PB', 'PS');

-- CreateEnum
CREATE TYPE "BiotDocumentKind" AS ENUM ('WORKER_CARD', 'ITR_CERTIFICATE');

-- CreateEnum
CREATE TYPE "CorrespondenceKind" AS ENUM ('LETTER', 'COMMERCIAL_PROPOSAL');

-- CreateEnum
CREATE TYPE "CorrespondenceStatus" AS ENUM ('DRAFT', 'READY_TO_SEND', 'PARTIALLY_SENT', 'SENT', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CorrespondenceRecipientStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ORGANIZATION', 'BRANCH', 'DEPARTMENT', 'WORK_SITE');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('USER', 'ROLE', 'CONTRACTOR_ORGANIZATION', 'CONTRACTOR_WORKER');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('READ', 'WRITE', 'APPROVE', 'SIGN', 'ARCHIVE');

-- CreateEnum
CREATE TYPE "BriefingParticipantStatus" AS ENUM ('ASSIGNED', 'OPENED', 'ACKNOWLEDGED', 'SIGNED', 'OVERDUE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QualificationDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'ANNULLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QualificationDocumentKind" AS ENUM ('CERTIFICATE', 'LICENSE', 'MEDICAL_CLEARANCE', 'ATTESTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplianceDocumentTypeCategory" AS ENUM ('DOCUMENT', 'TRAINING', 'INSTRUCTION');

-- CreateEnum
CREATE TYPE "EmployeeDocumentVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('EMPLOYEE_DOCUMENT', 'QUALIFICATION_DOCUMENT', 'TRAINING_PLAN', 'ORDER', 'BRIEFING_JOURNAL', 'BRIEFING_JOURNAL_ENTRY', 'PROTOCOL', 'WORK_PERMIT', 'CONTRACTOR_ACCESS_ACT');

-- CreateEnum
CREATE TYPE "DocumentEnvelopeStatus" AS ENUM ('DRAFT', 'IN_APPROVAL', 'SIGNING_READY', 'SIGNED', 'ACTIVE', 'SUPERSEDED', 'ANNULLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('DRAFT', 'FINAL', 'SIGNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "DocumentTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalRouteStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ApprovalStepAction" AS ENUM ('REVIEW', 'APPROVE', 'SIGN', 'ACKNOWLEDGE');

-- CreateEnum
CREATE TYPE "SignatureVerificationResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "ArchiveRecordStatus" AS ENUM ('PENDING', 'SEALED', 'ARCHIVED', 'LEGAL_HOLD', 'DISPOSAL_SCHEDULED', 'DESTROYED');

-- CreateEnum
CREATE TYPE "RetentionUnit" AS ENUM ('DAYS', 'MONTHS', 'YEARS', 'INDEFINITE');

-- CreateEnum
CREATE TYPE "AttachmentOwnerType" AS ENUM ('DOCUMENT_ENVELOPE', 'DOCUMENT_VERSION', 'WORK_PERMIT', 'WORK_PERMIT_VERSION', 'BRIEFING_JOURNAL_ENTRY', 'ORDER_VERSION', 'ARCHIVE_RECORD');

-- CreateEnum
CREATE TYPE "ExportSnapshotFormat" AS ENUM ('PDF_A_1', 'PDF', 'JSON', 'ZIP');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('DOPUSHEN', 'OGRANICHENNO_DOPUSHEN', 'NE_DOPUSHEN');

-- CreateEnum
CREATE TYPE "AdmissionSubjectType" AS ENUM ('EMPLOYEE', 'CONTRACTOR_WORKER');

-- CreateEnum
CREATE TYPE "AdmissionSeverity" AS ENUM ('BLOCKER', 'WARNING');

-- CreateEnum
CREATE TYPE "WorkPermitType" AS ENUM ('HOT_WORK', 'CONFINED_SPACE', 'ELECTRICAL', 'LIFTING', 'OTHER');

-- CreateEnum
CREATE TYPE "PermitType" AS ENUM ('HIGH_RISK_WORK', 'CONTRACTOR_ACCESS', 'SELF_WORK_ADMISSION', 'AFTER_BRIEFING_ADMISSION', 'AFTER_TRAINING_ADMISSION', 'MEDICAL_BASED_ADMISSION', 'PPE_BASED_ADMISSION');

-- CreateEnum
CREATE TYPE "PermitWorkType" AS ENUM ('GENERAL_HIGH_RISK', 'HEIGHT_WORK', 'HOT_WORK', 'GAS_HAZARDOUS_WORK', 'ELECTRICAL_WORK', 'EARTH_WORK', 'CONFINED_SPACE', 'LIFTING_WORK', 'CONTRACTOR_SITE_ACCESS');

-- CreateEnum
CREATE TYPE "MatrixStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MatrixVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'ACTIVE', 'SUPERSEDED', 'ANNULLED');

-- CreateEnum
CREATE TYPE "TrainingPlanStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'REVISED', 'SUPERSEDED', 'ANNULLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingPlanVersionStatus" AS ENUM ('DRAFT', 'FINAL', 'SIGNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'IN_APPROVAL', 'APPROVED', 'SIGNING_READY', 'SIGNED', 'ACTIVE', 'CANCELED', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "OrderVersionStatus" AS ENUM ('DRAFT', 'FINAL', 'SIGNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "BriefingJournalStatus" AS ENUM ('DRAFT', 'IN_APPROVAL', 'SIGNING_READY', 'SIGNED', 'ACTIVE', 'SUPERSEDED', 'ANNULLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BriefingJournalEntryStatus" AS ENUM ('DRAFT', 'OPENED', 'ACKNOWLEDGED', 'SIGNING_READY', 'PARTIALLY_SIGNED', 'SIGNED', 'SUPERSEDED', 'ANNULLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkPermitStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'MISSING_DOCUMENTS', 'IN_APPROVAL', 'APPROVED', 'SIGNING_READY', 'SIGNED', 'ACTIVE', 'CLOSED', 'SUSPENDED', 'EXTENDED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ANNULLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkPermitVersionStatus" AS ENUM ('DRAFT', 'FINAL', 'SIGNED', 'VOIDED');

-- CreateEnum
CREATE TYPE "WorkPermitApprovalRole" AS ENUM ('WORK_PRODUCER', 'RESPONSIBLE_MANAGER', 'PERMIT_ISSUER', 'ADMITTER');

-- CreateEnum
CREATE TYPE "WorkPermitApprovalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'APPROVED', 'SIGNED', 'ACTIVATED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkPermitPrecheckResult" AS ENUM ('PASS', 'FAIL');

-- CreateEnum
CREATE TYPE "PpeIssueStatus" AS ENUM ('ACTIVE', 'RETURNED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractorAccessActStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProtocolStatus" AS ENUM ('DRAFT', 'SIGNING_READY', 'SIGNED', 'ANNULLED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ResponsibilityOrderStatus" AS ENUM ('DRAFT', 'SIGNING_READY', 'SIGNED', 'ACTIVE', 'ANNULLED', 'SUPERSEDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ResponsibilityType" AS ENUM ('OCCUPATIONAL_SAFETY_RESPONSIBLE', 'FIRE_SAFETY_RESPONSIBLE', 'DEPARTMENT_RESPONSIBLE', 'OBJECT_RESPONSIBLE', 'INSTRUCTOR_APPOINTMENT', 'BRIEFING_AUTHORIZED_PERSON', 'PERMIT_ISSUER_AUTHORIZED_PERSON', 'RESPONSIBLE_WORK_MANAGER');

-- CreateEnum
CREATE TYPE "ProtocolCommissionRole" AS ENUM ('CHAIRMAN', 'MEMBER');

-- CreateEnum
CREATE TYPE "ResponsibleType" AS ENUM ('EMPLOYEE', 'CONTRACTOR_WORKER', 'ROLE');

-- CreateEnum
CREATE TYPE "BrigadeMemberStatus" AS ENUM ('ASSIGNED', 'READY', 'SIGNED', 'REJECTED');

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bin" TEXT,
    "industry" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "departmentId" TEXT,
    "siteId" TEXT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "departmentId" TEXT,
    "siteId" TEXT,
    "positionId" TEXT,
    "userId" TEXT,
    "contractorCompanyId" TEXT,
    "fullName" TEXT NOT NULL,
    "iinEncrypted" TEXT NOT NULL,
    "iinHash" TEXT NOT NULL,
    "iinLast4" TEXT NOT NULL,
    "employeeNumber" TEXT NOT NULL,
    "jobTitle" TEXT NOT NULL,
    "jobTitleKz" TEXT,
    "photoDataUrl" TEXT,
    "photoFileName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "employeeKind" "EmployeeKind" NOT NULL DEFAULT 'INTERNAL',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorCompany" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bin" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "participantCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefingBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingRecord" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "briefingBatchId" TEXT,
    "departmentId" TEXT,
    "siteId" TEXT,
    "employeeId" TEXT NOT NULL,
    "instructorUserId" TEXT NOT NULL,
    "briefingType" "BriefingType" NOT NULL,
    "briefingDate" TIMESTAMP(3) NOT NULL,
    "completionDueAt" TIMESTAMP(3),
    "nextBriefingDueAt" TIMESTAMP(3),
    "topic" TEXT NOT NULL,
    "notes" TEXT,
    "materialContent" TEXT,
    "materialFileName" TEXT,
    "materialFileUrl" TEXT,
    "status" "BriefingStatus" NOT NULL DEFAULT 'DRAFT',
    "employeeStatus" "EmployeeInstructionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "openedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "documentNumber" TEXT,
    "documentHash" TEXT,
    "inviteToken" TEXT,
    "inviteTokenHash" TEXT,
    "inviteTokenExpiresAt" TIMESTAMP(3),
    "inviteSentAt" TIMESTAMP(3),
    "registrationCompletedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingAssignmentId" TEXT,
    "documentTypeDefinitionId" TEXT,
    "documentEnvelopeId" TEXT,
    "title" TEXT NOT NULL,
    "documentNumber" TEXT,
    "documentType" "DocumentType" NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "issuerName" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationStatus" "EmployeeDocumentVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "verificationNotes" TEXT,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "category" "CompanyDocumentCategory" NOT NULL,
    "documentName" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "body" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3),
    "status" "CompanyDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SafetyCertificate" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingAssignmentId" TEXT,
    "documentId" TEXT,
    "certificateNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3) NOT NULL,
    "issuerName" TEXT NOT NULL,
    "status" "SafetyCertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "fileName" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SafetyCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingProgram" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "materialContent" TEXT,
    "materialFileName" TEXT,
    "materialFileUrl" TEXT,
    "videoUrl" TEXT,
    "issuerName" TEXT,
    "requiresExam" BOOLEAN NOT NULL DEFAULT false,
    "createsDocument" BOOLEAN NOT NULL DEFAULT false,
    "createsSafetyCertificate" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingAssignment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "trainingProgramId" TEXT NOT NULL,
    "assignedByUserId" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "TrainingAssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "examPassedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trainingProgramId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "passingScore" INTEGER NOT NULL,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamQuestion" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamAttempt" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "trainingAssignmentId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "ExamAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "score" INTEGER,
    "passed" BOOLEAN,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "answers" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardGenerationRequest" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "certificateType" "CardRequestType" NOT NULL,
    "biotDocumentKind" "BiotDocumentKind" NOT NULL DEFAULT 'WORKER_CARD',
    "includeCard" BOOLEAN NOT NULL DEFAULT true,
    "includeProtocol" BOOLEAN NOT NULL DEFAULT true,
    "includeWitness" BOOLEAN NOT NULL DEFAULT false,
    "requestMode" "CardRequestMode" NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "seriesNumber" TEXT NOT NULL,
    "trainingSubject" TEXT NOT NULL,
    "requestCompanyRu" TEXT,
    "requestCompanyKz" TEXT,
    "itemsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardGenerationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardGenerationRequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "employeeId" TEXT,
    "trainingAssignmentId" TEXT,
    "fullName" TEXT NOT NULL,
    "fullNameKz" TEXT,
    "issuedTo" TEXT,
    "positionRu" TEXT,
    "positionKz" TEXT,
    "workplaceRu" TEXT,
    "workplaceKz" TEXT,
    "photoDataUrl" TEXT,
    "photoFileName" TEXT,
    "certificateNumber" TEXT NOT NULL,
    "protocolNumber" TEXT NOT NULL,
    "witnessCertificateNumber" TEXT,
    "witnessRegistrationNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardGenerationRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Correspondence" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "registryNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "CorrespondenceKind" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "CorrespondenceStatus" NOT NULL DEFAULT 'DRAFT',
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrespondenceRecipient" (
    "id" TEXT NOT NULL,
    "correspondenceId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPosition" TEXT,
    "status" "CorrespondenceRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorrespondenceRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Signature" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "organizationId" TEXT,
    "briefingRecordId" TEXT,
    "briefingJournalEntryId" TEXT,
    "documentEnvelopeId" TEXT,
    "documentVersionId" TEXT,
    "signerUserId" TEXT,
    "signerEmployeeId" TEXT,
    "signerRole" TEXT,
    "provider" "SignatureProvider" NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PREPARED',
    "signerName" TEXT NOT NULL,
    "signerIinMasked" TEXT NOT NULL,
    "certificateSerial" TEXT NOT NULL,
    "certificateMetadataId" TEXT,
    "documentHash" TEXT NOT NULL,
    "signatureHash" TEXT,
    "signedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "signingSessionId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Signature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningSession" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentType" "SigningDocumentType" NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentEnvelopeId" TEXT,
    "documentVersionId" TEXT,
    "signerUserId" TEXT,
    "signerEmployeeId" TEXT,
    "initiatedByUserId" TEXT,
    "signerIinMasked" TEXT,
    "signerIinHash" TEXT,
    "provider" "SignatureProvider" NOT NULL,
    "status" "SigningSessionStatus" NOT NULL DEFAULT 'CREATED',
    "providerSessionId" TEXT,
    "documentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "idempotencyKey" TEXT,
    "providerPublicJson" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SigningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningProviderConfig" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" "SignatureProvider" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" TEXT NOT NULL DEFAULT 'local',
    "publicConfigJson" JSONB,
    "secretRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SigningProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureEvidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "signingSessionId" TEXT NOT NULL,
    "signatureId" TEXT,
    "documentType" "SigningDocumentType" NOT NULL,
    "documentId" TEXT NOT NULL,
    "documentEnvelopeId" TEXT,
    "documentVersionId" TEXT,
    "provider" "SignatureProvider" NOT NULL,
    "documentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'SHA-256',
    "signatureFormat" TEXT NOT NULL,
    "signaturePayloadLocation" TEXT,
    "signaturePayloadHash" TEXT,
    "certificateSubject" TEXT,
    "certificateIssuer" TEXT,
    "certificateSerial" TEXT,
    "signedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verificationStatus" "SignatureEvidenceVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "redactedProviderResponse" JSONB,
    "storageKey" TEXT,
    "correlationId" TEXT NOT NULL,
    "supersedesEvidenceId" TEXT,
    "immutableCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderCallbackEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "signingSessionId" TEXT,
    "provider" "SignatureProvider" NOT NULL,
    "providerSessionId" TEXT,
    "callbackKey" TEXT,
    "validationStatus" "SigningCallbackValidationStatus" NOT NULL DEFAULT 'RECEIVED',
    "processingStatus" "SigningCallbackProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "redactedPayloadJson" JSONB,
    "rawPayloadEncrypted" TEXT,
    "rawPayloadHash" TEXT,
    "rawPayloadStorageKey" TEXT,
    "error" TEXT,
    "correlationId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCallbackEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "briefingRecordId" TEXT,
    "employeeId" TEXT,
    "type" "ReminderType" NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reminderId" TEXT,
    "briefingRecordId" TEXT,
    "assigneeUserId" TEXT,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "type" "ReminderType" NOT NULL,
    "status" "NotificationJobStatus" NOT NULL DEFAULT 'queued',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "actorUserId" TEXT,
    "briefingRecordId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "metadata" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "legacyCompanyId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bin" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Branch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkSite" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScopeGrant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "principalId" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "accessLevel" "AccessLevel" NOT NULL,
    "businessProcessType" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScopeGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorOrganization" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "bin" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorOrganization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorWorker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "contractorOrganizationId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "iinEncrypted" TEXT NOT NULL,
    "iinHash" TEXT NOT NULL,
    "iinLast4" TEXT NOT NULL,
    "workerNumber" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "positionTitle" TEXT,
    "employeeKind" "EmployeeKind" NOT NULL DEFAULT 'CONTRACTOR',
    "status" "EmployeeStatus" NOT NULL DEFAULT 'active',
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClearanceType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validityDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClearanceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "validityDays" INTEGER,
    "requiresExam" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDocumentType" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ComplianceDocumentTypeCategory" NOT NULL,
    "description" TEXT,
    "defaultValidityDays" INTEGER,
    "requiresExpiry" BOOLEAN NOT NULL DEFAULT true,
    "requiresVerification" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "documentKind" "DocumentKind" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "DocumentTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "schemaJson" JSONB NOT NULL,
    "renderPolicyJson" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRoute" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "routeCode" TEXT NOT NULL,
    "documentKind" "DocumentKind" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "routeVersion" INTEGER NOT NULL,
    "status" "ApprovalRouteStatus" NOT NULL DEFAULT 'DRAFT',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "groupKey" TEXT,
    "quorum" INTEGER NOT NULL DEFAULT 1,
    "action" "ApprovalStepAction" NOT NULL,
    "requiredRoleCode" TEXT,
    "requiredPrincipalType" TEXT,
    "requiredPrincipalId" TEXT,
    "requiredDepartmentId" TEXT,
    "requiredBranchId" TEXT,
    "requiredWorkSiteId" TEXT,
    "slaHours" INTEGER,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEnvelope" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentKind" "DocumentKind" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "businessObjectType" TEXT NOT NULL,
    "businessObjectId" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DocumentEnvelopeStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT,
    "approvalRouteId" TEXT,
    "currentVersionId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentEnvelope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "templateId" TEXT,
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "payloadJson" JSONB NOT NULL,
    "renderedHash" TEXT,
    "changeReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signedAt" TIMESTAMP(3),
    "annulledAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CertificateMetadata" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "thumbprint" TEXT NOT NULL,
    "subjectDn" TEXT NOT NULL,
    "issuerDn" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "revocationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateMetadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureVerification" (
    "id" TEXT NOT NULL,
    "signatureId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "result" "SignatureVerificationResult" NOT NULL,
    "chainStatus" TEXT,
    "revocationStatus" TEXT,
    "evidenceJson" JSONB,
    "errorCode" TEXT,
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ownerType" "AttachmentOwnerType" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageUri" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "versionId" TEXT,
    "format" "ExportSnapshotFormat" NOT NULL DEFAULT 'PDF_A_1',
    "storageUri" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "manifestJson" JSONB,
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExportSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "retentionCode" TEXT NOT NULL,
    "documentKind" "DocumentKind" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "retentionValue" INTEGER NOT NULL,
    "retentionUnit" "RetentionUnit" NOT NULL,
    "archiveFormat" "ExportSnapshotFormat" NOT NULL DEFAULT 'PDF_A_1',
    "legalBasis" TEXT NOT NULL,
    "holdAllowed" BOOLEAN NOT NULL DEFAULT true,
    "destructionApprovalRequired" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "versionId" TEXT,
    "retentionPolicyId" TEXT NOT NULL,
    "status" "ArchiveRecordStatus" NOT NULL DEFAULT 'PENDING',
    "sealedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "disposalEligibleAt" TIMESTAMP(3),
    "disposedAt" TIMESTAMP(3),
    "archiveManifestHash" TEXT NOT NULL,
    "storageUri" TEXT,
    "holdReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchiveRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequirementMatrix" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "positionId" TEXT,
    "matrixCode" TEXT NOT NULL,
    "status" "MatrixStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRequirementMatrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRequirementMatrixVersion" (
    "id" TEXT NOT NULL,
    "matrixId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "MatrixVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "payloadJson" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "JobRequirementMatrixVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "positionId" TEXT,
    "matrixVersionId" TEXT,
    "status" "TrainingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "requiresExam" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingPlanVersion" (
    "id" TEXT NOT NULL,
    "trainingPlanId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "TrainingPlanVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "payloadJson" JSONB NOT NULL,
    "documentEnvelopeId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderCode" TEXT NOT NULL,
    "orderType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "basisDocumentId" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderVersion" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "OrderVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "payloadJson" JSONB NOT NULL,
    "documentEnvelopeId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibleAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderVersionId" TEXT NOT NULL,
    "responsibleType" "ResponsibleType" NOT NULL,
    "employeeId" TEXT,
    "contractorWorkerId" TEXT,
    "roleCode" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsibleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingJournal" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "status" "BriefingJournalStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefingJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefingJournalEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "entryNo" INTEGER NOT NULL,
    "registrationNo" TEXT,
    "journalKind" "BriefingJournalKind" NOT NULL,
    "employeeId" TEXT NOT NULL,
    "instructorUserId" TEXT NOT NULL,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "briefingType" "BriefingType" NOT NULL,
    "status" "BriefingJournalEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "employeeStatus" "BriefingParticipantStatus" NOT NULL DEFAULT 'ASSIGNED',
    "briefingDate" TIMESTAMP(3) NOT NULL,
    "briefingTime" TIMESTAMP(3),
    "topic" TEXT NOT NULL,
    "program" TEXT,
    "basis" TEXT,
    "unscheduledReason" TEXT,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "finalSignedAt" TIMESTAMP(3),
    "documentHash" TEXT,
    "documentEnvelopeId" TEXT,
    "archiveRecordId" TEXT,
    "retentionPolicyId" TEXT,
    "replacesEntryId" TEXT,
    "annulReason" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BriefingJournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "permitCode" TEXT NOT NULL,
    "journalRegistrationNumber" TEXT NOT NULL,
    "permitType" "PermitType" NOT NULL,
    "workType" "PermitWorkType" NOT NULL,
    "title" TEXT NOT NULL,
    "workDescription" TEXT NOT NULL,
    "workplace" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "contractorOrganizationId" TEXT,
    "contractorRepresentativeId" TEXT,
    "contractorAccessActId" TEXT,
    "issuerEmployeeId" TEXT,
    "responsibleManagerEmployeeId" TEXT,
    "workProducerEmployeeId" TEXT,
    "admitterEmployeeId" TEXT,
    "observerEmployeeId" TEXT,
    "status" "WorkPermitStatus" NOT NULL DEFAULT 'DRAFT',
    "documentEnvelopeId" TEXT,
    "currentVersionId" TEXT,
    "issuedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "signedPayloadHash" TEXT,
    "rejectionReason" TEXT,
    "suspensionReason" TEXT,
    "cancellationReason" TEXT,
    "archiveRecordId" TEXT,
    "retentionPolicyId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPermit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorAccessAct" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actNumber" TEXT NOT NULL,
    "status" "ContractorAccessActStatus" NOT NULL DEFAULT 'DRAFT',
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "contractorOrganizationId" TEXT NOT NULL,
    "contractorRepresentativeId" TEXT,
    "hostRepresentativeEmployeeId" TEXT,
    "hostUnitChiefEmployeeId" TEXT,
    "workName" TEXT NOT NULL,
    "workDescription" TEXT,
    "workArea" TEXT NOT NULL,
    "workAreaBoundaries" TEXT,
    "workAreaCoordinates" JSONB,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3) NOT NULL,
    "safetyMeasures" JSONB NOT NULL,
    "specialConditions" TEXT,
    "legalBasis" TEXT NOT NULL,
    "legalBasisVersion" TEXT NOT NULL,
    "legalBasisEffectiveDate" TIMESTAMP(3) NOT NULL,
    "documentEnvelopeId" TEXT,
    "currentVersionId" TEXT,
    "signedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "archivedAt" TIMESTAMP(3),
    "archiveRecordId" TEXT,
    "retentionPolicyId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractorAccessAct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermitVersion" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "status" "WorkPermitVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "payloadJson" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "signedPayloadHash" TEXT,
    "documentEnvelopeId" TEXT,
    "documentVersionId" TEXT,
    "createdByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPermitVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermitApproval" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "stepNo" INTEGER NOT NULL,
    "role" "WorkPermitApprovalRole" NOT NULL,
    "status" "WorkPermitApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "assignedEmployeeId" TEXT,
    "decidedByUserId" TEXT,
    "comment" TEXT,
    "rejectionReason" TEXT,
    "metadataJson" JSONB,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPermitApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermitPrecheckRun" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "result" "WorkPermitPrecheckResult" NOT NULL,
    "checksJson" JSONB NOT NULL,
    "snapshotsJson" JSONB NOT NULL,
    "snapshotHash" TEXT NOT NULL,
    "checkedByUserId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkPermitPrecheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPermitClosure" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "inspection" TEXT NOT NULL,
    "notes" TEXT,
    "closedByUserId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkPermitClosure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PpeIssueRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "contractorWorkerId" TEXT,
    "itemCode" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "status" "PpeIssueStatus" NOT NULL DEFAULT 'ACTIVE',
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "sourceDocumentId" TEXT,
    "sourceHash" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PpeIssueRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Protocol" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "protocolType" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "status" "ProtocolStatus" NOT NULL DEFAULT 'DRAFT',
    "decision" TEXT NOT NULL,
    "notes" TEXT,
    "documentEnvelopeId" TEXT,
    "currentVersionId" TEXT,
    "currentVersionNo" INTEGER,
    "signedAt" TIMESTAMP(3),
    "archiveRecordId" TEXT,
    "retentionPolicyId" TEXT,
    "replacesProtocolId" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Protocol_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibilityOrder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "responsibilityType" "ResponsibilityType" NOT NULL,
    "title" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "notes" TEXT,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "status" "ResponsibilityOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "documentEnvelopeId" TEXT,
    "currentVersionId" TEXT,
    "currentVersionNo" INTEGER,
    "signedAt" TIMESTAMP(3),
    "archiveRecordId" TEXT,
    "retentionPolicyId" TEXT,
    "replacesOrderId" TEXT,
    "annulReason" TEXT,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsibilityOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResponsibilityAppointment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "responsibilityType" "ResponsibilityType" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "zoneOfResponsibility" TEXT,
    "roleNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResponsibilityAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolEmployee" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fullName" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "jobTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolEmployee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProtocolCommissionMember" (
    "id" TEXT NOT NULL,
    "protocolId" TEXT NOT NULL,
    "role" "ProtocolCommissionRole" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "fullName" TEXT NOT NULL,
    "jobTitle" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProtocolCommissionMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brigade" (
    "id" TEXT NOT NULL,
    "permitId" TEXT NOT NULL,
    "brigadeCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "leaderEmployeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brigade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrigadeMember" (
    "id" TEXT NOT NULL,
    "brigadeId" TEXT NOT NULL,
    "employeeId" TEXT,
    "contractorWorkerId" TEXT,
    "roleCode" TEXT NOT NULL,
    "status" "BrigadeMemberStatus" NOT NULL DEFAULT 'ASSIGNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrigadeMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "employeeId" TEXT,
    "contractorWorkerId" TEXT,
    "clearanceTypeId" TEXT,
    "trainingTypeId" TEXT,
    "documentKind" "QualificationDocumentKind" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "expiryDate" TIMESTAMP(3),
    "status" "QualificationDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "documentEnvelopeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdmissionEvaluation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "subjectType" "AdmissionSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "employeeId" TEXT,
    "contractorWorkerId" TEXT,
    "branchId" TEXT,
    "departmentId" TEXT,
    "workSiteId" TEXT,
    "positionId" TEXT,
    "workType" "WorkPermitType" NOT NULL,
    "matrixId" TEXT,
    "matrixVersionId" TEXT,
    "trainingPlanVersionId" TEXT,
    "briefingJournalEntryId" TEXT,
    "protocolId" TEXT,
    "workPermitId" TEXT,
    "status" "AdmissionStatus" NOT NULL,
    "decisionCode" TEXT NOT NULL,
    "ruleVersion" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "nextReviewAt" TIMESTAMP(3),
    "checksJson" JSONB NOT NULL,
    "warningsJson" JSONB NOT NULL,
    "nextActionsJson" JSONB NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdmissionEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_bin_key" ON "Company"("bin");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_companyId_role_idx" ON "User"("companyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "Department_companyId_name_key" ON "Department"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Site_companyId_name_key" ON "Site"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE INDEX "Employee_companyId_fullName_idx" ON "Employee"("companyId", "fullName");

-- CreateIndex
CREATE INDEX "Employee_companyId_status_idx" ON "Employee"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_iinHash_key" ON "Employee"("companyId", "iinHash");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_companyId_employeeNumber_key" ON "Employee"("companyId", "employeeNumber");

-- CreateIndex
CREATE INDEX "ContractorCompany_companyId_isActive_idx" ON "ContractorCompany"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorCompany_companyId_name_key" ON "ContractorCompany"("companyId", "name");

-- CreateIndex
CREATE INDEX "BriefingBatch_companyId_createdAt_idx" ON "BriefingBatch"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingBatch_companyId_batchNumber_key" ON "BriefingBatch"("companyId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingRecord_inviteToken_key" ON "BriefingRecord"("inviteToken");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingRecord_inviteTokenHash_key" ON "BriefingRecord"("inviteTokenHash");

-- CreateIndex
CREATE INDEX "BriefingRecord_companyId_status_briefingDate_idx" ON "BriefingRecord"("companyId", "status", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingRecord_companyId_employeeStatus_completionDueAt_idx" ON "BriefingRecord"("companyId", "employeeStatus", "completionDueAt");

-- CreateIndex
CREATE INDEX "BriefingRecord_companyId_briefingType_briefingDate_idx" ON "BriefingRecord"("companyId", "briefingType", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingRecord_employeeId_briefingDate_idx" ON "BriefingRecord"("employeeId", "briefingDate");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingRecord_companyId_documentNumber_key" ON "BriefingRecord"("companyId", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeDocument_documentEnvelopeId_key" ON "EmployeeDocument"("documentEnvelopeId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_companyId_employeeId_issueDate_idx" ON "EmployeeDocument"("companyId", "employeeId", "issueDate");

-- CreateIndex
CREATE INDEX "EmployeeDocument_companyId_status_expiryDate_idx" ON "EmployeeDocument"("companyId", "status", "expiryDate");

-- CreateIndex
CREATE INDEX "EmployeeDocument_companyId_documentTypeDefinitionId_idx" ON "EmployeeDocument"("companyId", "documentTypeDefinitionId");

-- CreateIndex
CREATE INDEX "EmployeeDocument_companyId_verificationStatus_expiryDate_idx" ON "EmployeeDocument"("companyId", "verificationStatus", "expiryDate");

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_category_updatedAt_idx" ON "CompanyDocument"("companyId", "category", "updatedAt");

-- CreateIndex
CREATE INDEX "CompanyDocument_companyId_status_updatedAt_idx" ON "CompanyDocument"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyCertificate_documentId_key" ON "SafetyCertificate"("documentId");

-- CreateIndex
CREATE INDEX "SafetyCertificate_companyId_employeeId_expiryDate_idx" ON "SafetyCertificate"("companyId", "employeeId", "expiryDate");

-- CreateIndex
CREATE INDEX "SafetyCertificate_companyId_status_expiryDate_idx" ON "SafetyCertificate"("companyId", "status", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "SafetyCertificate_companyId_certificateNumber_key" ON "SafetyCertificate"("companyId", "certificateNumber");

-- CreateIndex
CREATE INDEX "TrainingProgram_companyId_isActive_idx" ON "TrainingProgram"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingProgram_companyId_title_key" ON "TrainingProgram"("companyId", "title");

-- CreateIndex
CREATE INDEX "TrainingAssignment_companyId_status_dueAt_idx" ON "TrainingAssignment"("companyId", "status", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAssignment_employeeId_trainingProgramId_key" ON "TrainingAssignment"("employeeId", "trainingProgramId");

-- CreateIndex
CREATE UNIQUE INDEX "Exam_trainingProgramId_key" ON "Exam"("trainingProgramId");

-- CreateIndex
CREATE INDEX "Exam_companyId_isActive_idx" ON "Exam"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "ExamQuestion_examId_sortOrder_idx" ON "ExamQuestion"("examId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExamOption_questionId_sortOrder_idx" ON "ExamOption"("questionId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExamAttempt_companyId_employeeId_startedAt_idx" ON "ExamAttempt"("companyId", "employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "ExamAttempt_trainingAssignmentId_createdAt_idx" ON "ExamAttempt"("trainingAssignmentId", "createdAt");

-- CreateIndex
CREATE INDEX "CardGenerationRequest_companyId_createdAt_idx" ON "CardGenerationRequest"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "CardGenerationRequest_companyId_certificateType_issueDate_idx" ON "CardGenerationRequest"("companyId", "certificateType", "issueDate");

-- CreateIndex
CREATE INDEX "CardGenerationRequestItem_requestId_createdAt_idx" ON "CardGenerationRequestItem"("requestId", "createdAt");

-- CreateIndex
CREATE INDEX "CardGenerationRequestItem_employeeId_idx" ON "CardGenerationRequestItem"("employeeId");

-- CreateIndex
CREATE INDEX "CardGenerationRequestItem_trainingAssignmentId_idx" ON "CardGenerationRequestItem"("trainingAssignmentId");

-- CreateIndex
CREATE INDEX "Correspondence_companyId_kind_createdAt_idx" ON "Correspondence"("companyId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Correspondence_companyId_status_updatedAt_idx" ON "Correspondence"("companyId", "status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Correspondence_companyId_registryNumber_key" ON "Correspondence"("companyId", "registryNumber");

-- CreateIndex
CREATE INDEX "CorrespondenceRecipient_correspondenceId_createdAt_idx" ON "CorrespondenceRecipient"("correspondenceId", "createdAt");

-- CreateIndex
CREATE INDEX "CorrespondenceRecipient_status_sentAt_idx" ON "CorrespondenceRecipient"("status", "sentAt");

-- CreateIndex
CREATE INDEX "Signature_companyId_briefingRecordId_idx" ON "Signature"("companyId", "briefingRecordId");

-- CreateIndex
CREATE INDEX "Signature_organizationId_documentEnvelopeId_idx" ON "Signature"("organizationId", "documentEnvelopeId");

-- CreateIndex
CREATE INDEX "Signature_signingSessionId_idx" ON "Signature"("signingSessionId");

-- CreateIndex
CREATE INDEX "SigningSession_organizationId_documentType_documentId_idx" ON "SigningSession"("organizationId", "documentType", "documentId");

-- CreateIndex
CREATE INDEX "SigningSession_provider_providerSessionId_idx" ON "SigningSession"("provider", "providerSessionId");

-- CreateIndex
CREATE INDEX "SigningSession_initiatedByUserId_idx" ON "SigningSession"("initiatedByUserId");

-- CreateIndex
CREATE INDEX "SigningSession_status_expiresAt_idx" ON "SigningSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SigningSession_correlationId_idx" ON "SigningSession"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "SigningSession_organizationId_idempotencyKey_key" ON "SigningSession"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SigningProviderConfig_provider_enabled_idx" ON "SigningProviderConfig"("provider", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "SigningProviderConfig_organizationId_provider_key" ON "SigningProviderConfig"("organizationId", "provider");

-- CreateIndex
CREATE INDEX "SignatureEvidence_signingSessionId_idx" ON "SignatureEvidence"("signingSessionId");

-- CreateIndex
CREATE INDEX "SignatureEvidence_signatureId_idx" ON "SignatureEvidence"("signatureId");

-- CreateIndex
CREATE INDEX "SignatureEvidence_organizationId_documentType_documentId_idx" ON "SignatureEvidence"("organizationId", "documentType", "documentId");

-- CreateIndex
CREATE INDEX "SignatureEvidence_correlationId_idx" ON "SignatureEvidence"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderCallbackEvent_callbackKey_key" ON "ProviderCallbackEvent"("callbackKey");

-- CreateIndex
CREATE INDEX "ProviderCallbackEvent_provider_providerSessionId_createdAt_idx" ON "ProviderCallbackEvent"("provider", "providerSessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProviderCallbackEvent_signingSessionId_processingStatus_idx" ON "ProviderCallbackEvent"("signingSessionId", "processingStatus");

-- CreateIndex
CREATE INDEX "ProviderCallbackEvent_correlationId_idx" ON "ProviderCallbackEvent"("correlationId");

-- CreateIndex
CREATE INDEX "Reminder_companyId_status_dueAt_idx" ON "Reminder"("companyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "NotificationJob_companyId_status_scheduledAt_idx" ON "NotificationJob"("companyId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_createdAt_idx" ON "AuditLog"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_legacyCompanyId_key" ON "Organization"("legacyCompanyId");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_code_key" ON "Organization"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_bin_key" ON "Organization"("bin");

-- CreateIndex
CREATE INDEX "Organization_isActive_idx" ON "Organization"("isActive");

-- CreateIndex
CREATE INDEX "Branch_organizationId_isActive_idx" ON "Branch"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Branch_organizationId_code_key" ON "Branch"("organizationId", "code");

-- CreateIndex
CREATE INDEX "WorkSite_organizationId_isActive_idx" ON "WorkSite"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "WorkSite_branchId_isActive_idx" ON "WorkSite"("branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkSite_organizationId_code_key" ON "WorkSite"("organizationId", "code");

-- CreateIndex
CREATE INDEX "Position_organizationId_isActive_idx" ON "Position"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Position_organizationId_code_key" ON "Position"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ScopeGrant_organizationId_principalType_principalId_idx" ON "ScopeGrant"("organizationId", "principalType", "principalId");

-- CreateIndex
CREATE INDEX "ScopeGrant_organizationId_scopeType_accessLevel_idx" ON "ScopeGrant"("organizationId", "scopeType", "accessLevel");

-- CreateIndex
CREATE INDEX "ScopeGrant_branchId_departmentId_workSiteId_idx" ON "ScopeGrant"("branchId", "departmentId", "workSiteId");

-- CreateIndex
CREATE INDEX "ContractorOrganization_organizationId_isActive_idx" ON "ContractorOrganization"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorOrganization_organizationId_code_key" ON "ContractorOrganization"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ContractorWorker_organizationId_fullName_idx" ON "ContractorWorker"("organizationId", "fullName");

-- CreateIndex
CREATE INDEX "ContractorWorker_organizationId_status_idx" ON "ContractorWorker"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorWorker_organizationId_iinHash_key" ON "ContractorWorker"("organizationId", "iinHash");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorWorker_organizationId_workerNumber_key" ON "ContractorWorker"("organizationId", "workerNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ClearanceType_organizationId_code_key" ON "ClearanceType"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingType_organizationId_code_key" ON "TrainingType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "ComplianceDocumentType_organizationId_category_isActive_idx" ON "ComplianceDocumentType"("organizationId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceDocumentType_organizationId_code_key" ON "ComplianceDocumentType"("organizationId", "code");

-- CreateIndex
CREATE INDEX "DocumentTemplate_organizationId_documentKind_scopeType_stat_idx" ON "DocumentTemplate"("organizationId", "documentKind", "scopeType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplate_organizationId_templateCode_templateVersio_key" ON "DocumentTemplate"("organizationId", "templateCode", "templateVersion");

-- CreateIndex
CREATE INDEX "ApprovalRoute_organizationId_documentKind_scopeType_status_idx" ON "ApprovalRoute"("organizationId", "documentKind", "scopeType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRoute_organizationId_routeCode_routeVersion_key" ON "ApprovalRoute"("organizationId", "routeCode", "routeVersion");

-- CreateIndex
CREATE INDEX "ApprovalStep_routeId_action_idx" ON "ApprovalStep"("routeId", "action");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalStep_routeId_stepNo_key" ON "ApprovalStep"("routeId", "stepNo");

-- CreateIndex
CREATE INDEX "DocumentEnvelope_organizationId_status_idx" ON "DocumentEnvelope"("organizationId", "status");

-- CreateIndex
CREATE INDEX "DocumentEnvelope_organizationId_scopeType_branchId_workSite_idx" ON "DocumentEnvelope"("organizationId", "scopeType", "branchId", "workSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentEnvelope_organizationId_documentKind_documentNumber_key" ON "DocumentEnvelope"("organizationId", "documentKind", "documentNumber");

-- CreateIndex
CREATE INDEX "DocumentVersion_envelopeId_status_idx" ON "DocumentVersion"("envelopeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_envelopeId_versionNo_key" ON "DocumentVersion"("envelopeId", "versionNo");

-- CreateIndex
CREATE INDEX "CertificateMetadata_thumbprint_idx" ON "CertificateMetadata"("thumbprint");

-- CreateIndex
CREATE UNIQUE INDEX "CertificateMetadata_organizationId_serial_key" ON "CertificateMetadata"("organizationId", "serial");

-- CreateIndex
CREATE UNIQUE INDEX "SignatureVerification_signatureId_key" ON "SignatureVerification"("signatureId");

-- CreateIndex
CREATE INDEX "Attachment_organizationId_ownerType_ownerId_idx" ON "Attachment"("organizationId", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "Attachment_organizationId_sha256_idx" ON "Attachment"("organizationId", "sha256");

-- CreateIndex
CREATE INDEX "ExportSnapshot_organizationId_envelopeId_format_idx" ON "ExportSnapshot"("organizationId", "envelopeId", "format");

-- CreateIndex
CREATE INDEX "RetentionPolicy_organizationId_documentKind_scopeType_idx" ON "RetentionPolicy"("organizationId", "documentKind", "scopeType");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_organizationId_retentionCode_effectiveFrom_key" ON "RetentionPolicy"("organizationId", "retentionCode", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ArchiveRecord_organizationId_envelopeId_idx" ON "ArchiveRecord"("organizationId", "envelopeId");

-- CreateIndex
CREATE INDEX "ArchiveRecord_organizationId_status_idx" ON "ArchiveRecord"("organizationId", "status");

-- CreateIndex
CREATE INDEX "JobRequirementMatrix_organizationId_status_idx" ON "JobRequirementMatrix"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirementMatrix_organizationId_matrixCode_key" ON "JobRequirementMatrix"("organizationId", "matrixCode");

-- CreateIndex
CREATE INDEX "JobRequirementMatrixVersion_matrixId_status_idx" ON "JobRequirementMatrixVersion"("matrixId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JobRequirementMatrixVersion_matrixId_versionNo_key" ON "JobRequirementMatrixVersion"("matrixId", "versionNo");

-- CreateIndex
CREATE INDEX "TrainingPlan_organizationId_status_idx" ON "TrainingPlan"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlan_organizationId_planCode_key" ON "TrainingPlan"("organizationId", "planCode");

-- CreateIndex
CREATE INDEX "TrainingPlanVersion_trainingPlanId_status_idx" ON "TrainingPlanVersion"("trainingPlanId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingPlanVersion_trainingPlanId_versionNo_key" ON "TrainingPlanVersion"("trainingPlanId", "versionNo");

-- CreateIndex
CREATE INDEX "Order_organizationId_status_idx" ON "Order"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_organizationId_orderCode_key" ON "Order"("organizationId", "orderCode");

-- CreateIndex
CREATE INDEX "OrderVersion_orderId_status_idx" ON "OrderVersion"("orderId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrderVersion_orderId_versionNo_key" ON "OrderVersion"("orderId", "versionNo");

-- CreateIndex
CREATE INDEX "ResponsibleAssignment_organizationId_orderVersionId_idx" ON "ResponsibleAssignment"("organizationId", "orderVersionId");

-- CreateIndex
CREATE INDEX "ResponsibleAssignment_organizationId_responsibleType_idx" ON "ResponsibleAssignment"("organizationId", "responsibleType");

-- CreateIndex
CREATE INDEX "BriefingJournal_organizationId_status_idx" ON "BriefingJournal"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingJournal_organizationId_journalCode_key" ON "BriefingJournal"("organizationId", "journalCode");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_organizationId_status_briefingDate_idx" ON "BriefingJournalEntry"("organizationId", "status", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_organizationId_employeeId_briefingDate_idx" ON "BriefingJournalEntry"("organizationId", "employeeId", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_organizationId_instructorUserId_briefi_idx" ON "BriefingJournalEntry"("organizationId", "instructorUserId", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_organizationId_journalKind_briefingTyp_idx" ON "BriefingJournalEntry"("organizationId", "journalKind", "briefingType", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_organizationId_departmentId_briefingDa_idx" ON "BriefingJournalEntry"("organizationId", "departmentId", "briefingDate");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_journalId_status_idx" ON "BriefingJournalEntry"("journalId", "status");

-- CreateIndex
CREATE INDEX "BriefingJournalEntry_replacesEntryId_idx" ON "BriefingJournalEntry"("replacesEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingJournalEntry_journalId_entryNo_key" ON "BriefingJournalEntry"("journalId", "entryNo");

-- CreateIndex
CREATE UNIQUE INDEX "BriefingJournalEntry_organizationId_registrationNo_key" ON "BriefingJournalEntry"("organizationId", "registrationNo");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermit_documentEnvelopeId_key" ON "WorkPermit"("documentEnvelopeId");

-- CreateIndex
CREATE INDEX "WorkPermit_organizationId_status_effectiveFrom_idx" ON "WorkPermit"("organizationId", "status", "effectiveFrom");

-- CreateIndex
CREATE INDEX "WorkPermit_organizationId_permitType_workType_idx" ON "WorkPermit"("organizationId", "permitType", "workType");

-- CreateIndex
CREATE INDEX "WorkPermit_organizationId_contractorOrganizationId_idx" ON "WorkPermit"("organizationId", "contractorOrganizationId");

-- CreateIndex
CREATE INDEX "WorkPermit_organizationId_contractorAccessActId_idx" ON "WorkPermit"("organizationId", "contractorAccessActId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermit_organizationId_permitCode_key" ON "WorkPermit"("organizationId", "permitCode");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermit_organizationId_journalRegistrationNumber_key" ON "WorkPermit"("organizationId", "journalRegistrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorAccessAct_documentEnvelopeId_key" ON "ContractorAccessAct"("documentEnvelopeId");

-- CreateIndex
CREATE INDEX "ContractorAccessAct_organizationId_status_validFrom_idx" ON "ContractorAccessAct"("organizationId", "status", "validFrom");

-- CreateIndex
CREATE INDEX "ContractorAccessAct_organizationId_contractorOrganizationId_idx" ON "ContractorAccessAct"("organizationId", "contractorOrganizationId");

-- CreateIndex
CREATE INDEX "ContractorAccessAct_organizationId_scopeType_branchId_depar_idx" ON "ContractorAccessAct"("organizationId", "scopeType", "branchId", "departmentId", "workSiteId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractorAccessAct_organizationId_actNumber_key" ON "ContractorAccessAct"("organizationId", "actNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermitVersion_documentVersionId_key" ON "WorkPermitVersion"("documentVersionId");

-- CreateIndex
CREATE INDEX "WorkPermitVersion_permitId_status_idx" ON "WorkPermitVersion"("permitId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermitVersion_permitId_versionNo_key" ON "WorkPermitVersion"("permitId", "versionNo");

-- CreateIndex
CREATE INDEX "WorkPermitApproval_permitId_status_idx" ON "WorkPermitApproval"("permitId", "status");

-- CreateIndex
CREATE INDEX "WorkPermitApproval_assignedEmployeeId_status_idx" ON "WorkPermitApproval"("assignedEmployeeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermitApproval_permitId_stepNo_key" ON "WorkPermitApproval"("permitId", "stepNo");

-- CreateIndex
CREATE INDEX "WorkPermitPrecheckRun_permitId_checkedAt_idx" ON "WorkPermitPrecheckRun"("permitId", "checkedAt");

-- CreateIndex
CREATE INDEX "WorkPermitPrecheckRun_versionId_idx" ON "WorkPermitPrecheckRun"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkPermitClosure_permitId_key" ON "WorkPermitClosure"("permitId");

-- CreateIndex
CREATE INDEX "PpeIssueRecord_organizationId_employeeId_status_validUntil_idx" ON "PpeIssueRecord"("organizationId", "employeeId", "status", "validUntil");

-- CreateIndex
CREATE INDEX "PpeIssueRecord_organizationId_contractorWorkerId_status_val_idx" ON "PpeIssueRecord"("organizationId", "contractorWorkerId", "status", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_documentEnvelopeId_key" ON "Protocol"("documentEnvelopeId");

-- CreateIndex
CREATE INDEX "Protocol_organizationId_status_date_idx" ON "Protocol"("organizationId", "status", "date");

-- CreateIndex
CREATE INDEX "Protocol_organizationId_departmentId_status_idx" ON "Protocol"("organizationId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "Protocol_organizationId_branchId_workSiteId_idx" ON "Protocol"("organizationId", "branchId", "workSiteId");

-- CreateIndex
CREATE INDEX "Protocol_replacesProtocolId_idx" ON "Protocol"("replacesProtocolId");

-- CreateIndex
CREATE UNIQUE INDEX "Protocol_organizationId_number_key" ON "Protocol"("organizationId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsibilityOrder_documentEnvelopeId_key" ON "ResponsibilityOrder"("documentEnvelopeId");

-- CreateIndex
CREATE INDEX "ResponsibilityOrder_organizationId_status_date_idx" ON "ResponsibilityOrder"("organizationId", "status", "date");

-- CreateIndex
CREATE INDEX "ResponsibilityOrder_organizationId_responsibilityType_statu_idx" ON "ResponsibilityOrder"("organizationId", "responsibilityType", "status");

-- CreateIndex
CREATE INDEX "ResponsibilityOrder_organizationId_departmentId_status_idx" ON "ResponsibilityOrder"("organizationId", "departmentId", "status");

-- CreateIndex
CREATE INDEX "ResponsibilityOrder_organizationId_branchId_workSiteId_idx" ON "ResponsibilityOrder"("organizationId", "branchId", "workSiteId");

-- CreateIndex
CREATE INDEX "ResponsibilityOrder_replacesOrderId_idx" ON "ResponsibilityOrder"("replacesOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsibilityOrder_organizationId_number_key" ON "ResponsibilityOrder"("organizationId", "number");

-- CreateIndex
CREATE INDEX "ResponsibilityAppointment_organizationId_orderId_idx" ON "ResponsibilityAppointment"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "ResponsibilityAppointment_organizationId_employeeId_effecti_idx" ON "ResponsibilityAppointment"("organizationId", "employeeId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ResponsibilityAppointment_organizationId_responsibilityType_idx" ON "ResponsibilityAppointment"("organizationId", "responsibilityType", "scopeType", "branchId", "departmentId", "workSiteId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "ResponsibilityAppointment_orderId_employeeId_key" ON "ResponsibilityAppointment"("orderId", "employeeId");

-- CreateIndex
CREATE INDEX "ProtocolEmployee_protocolId_sortOrder_idx" ON "ProtocolEmployee"("protocolId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProtocolEmployee_employeeId_protocolId_idx" ON "ProtocolEmployee"("employeeId", "protocolId");

-- CreateIndex
CREATE UNIQUE INDEX "ProtocolEmployee_protocolId_employeeId_key" ON "ProtocolEmployee"("protocolId", "employeeId");

-- CreateIndex
CREATE INDEX "ProtocolCommissionMember_protocolId_role_sortOrder_idx" ON "ProtocolCommissionMember"("protocolId", "role", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Brigade_permitId_brigadeCode_key" ON "Brigade"("permitId", "brigadeCode");

-- CreateIndex
CREATE INDEX "BrigadeMember_brigadeId_status_idx" ON "BrigadeMember"("brigadeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeMember_brigadeId_employeeId_key" ON "BrigadeMember"("brigadeId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "BrigadeMember_brigadeId_contractorWorkerId_key" ON "BrigadeMember"("brigadeId", "contractorWorkerId");

-- CreateIndex
CREATE INDEX "QualificationDocument_organizationId_status_expiryDate_idx" ON "QualificationDocument"("organizationId", "status", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationDocument_organizationId_documentNumber_key" ON "QualificationDocument"("organizationId", "documentNumber");

-- CreateIndex
CREATE INDEX "AdmissionEvaluation_organizationId_subjectType_subjectId_ev_idx" ON "AdmissionEvaluation"("organizationId", "subjectType", "subjectId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "AdmissionEvaluation_organizationId_status_evaluatedAt_idx" ON "AdmissionEvaluation"("organizationId", "status", "evaluatedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_contractorCompanyId_fkey" FOREIGN KEY ("contractorCompanyId") REFERENCES "ContractorCompany"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorCompany" ADD CONSTRAINT "ContractorCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingBatch" ADD CONSTRAINT "BriefingBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_briefingBatchId_fkey" FOREIGN KEY ("briefingBatchId") REFERENCES "BriefingBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingRecord" ADD CONSTRAINT "BriefingRecord_instructorUserId_fkey" FOREIGN KEY ("instructorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_documentTypeDefinitionId_fkey" FOREIGN KEY ("documentTypeDefinitionId") REFERENCES "ComplianceDocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeDocument" ADD CONSTRAINT "EmployeeDocument_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDocument" ADD CONSTRAINT "CompanyDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDocument" ADD CONSTRAINT "CompanyDocument_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCertificate" ADD CONSTRAINT "SafetyCertificate_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCertificate" ADD CONSTRAINT "SafetyCertificate_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCertificate" ADD CONSTRAINT "SafetyCertificate_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SafetyCertificate" ADD CONSTRAINT "SafetyCertificate_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "EmployeeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingProgram" ADD CONSTRAINT "TrainingProgram_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_trainingProgramId_fkey" FOREIGN KEY ("trainingProgramId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_trainingProgramId_fkey" FOREIGN KEY ("trainingProgramId") REFERENCES "TrainingProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamQuestion" ADD CONSTRAINT "ExamQuestion_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamOption" ADD CONSTRAINT "ExamOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ExamQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamAttempt" ADD CONSTRAINT "ExamAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardGenerationRequest" ADD CONSTRAINT "CardGenerationRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardGenerationRequest" ADD CONSTRAINT "CardGenerationRequest_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardGenerationRequestItem" ADD CONSTRAINT "CardGenerationRequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "CardGenerationRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardGenerationRequestItem" ADD CONSTRAINT "CardGenerationRequestItem_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardGenerationRequestItem" ADD CONSTRAINT "CardGenerationRequestItem_trainingAssignmentId_fkey" FOREIGN KEY ("trainingAssignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correspondence" ADD CONSTRAINT "Correspondence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Correspondence" ADD CONSTRAINT "Correspondence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrespondenceRecipient" ADD CONSTRAINT "CorrespondenceRecipient_correspondenceId_fkey" FOREIGN KEY ("correspondenceId") REFERENCES "Correspondence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_briefingRecordId_fkey" FOREIGN KEY ("briefingRecordId") REFERENCES "BriefingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_briefingJournalEntryId_fkey" FOREIGN KEY ("briefingJournalEntryId") REFERENCES "BriefingJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_certificateMetadataId_fkey" FOREIGN KEY ("certificateMetadataId") REFERENCES "CertificateMetadata"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_signerEmployeeId_fkey" FOREIGN KEY ("signerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Signature" ADD CONSTRAINT "Signature_signingSessionId_fkey" FOREIGN KEY ("signingSessionId") REFERENCES "SigningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSession" ADD CONSTRAINT "SigningSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSession" ADD CONSTRAINT "SigningSession_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSession" ADD CONSTRAINT "SigningSession_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSession" ADD CONSTRAINT "SigningSession_signerUserId_fkey" FOREIGN KEY ("signerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSession" ADD CONSTRAINT "SigningSession_signerEmployeeId_fkey" FOREIGN KEY ("signerEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningSession" ADD CONSTRAINT "SigningSession_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningProviderConfig" ADD CONSTRAINT "SigningProviderConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_signingSessionId_fkey" FOREIGN KEY ("signingSessionId") REFERENCES "SigningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureEvidence" ADD CONSTRAINT "SignatureEvidence_supersedesEvidenceId_fkey" FOREIGN KEY ("supersedesEvidenceId") REFERENCES "SignatureEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCallbackEvent" ADD CONSTRAINT "ProviderCallbackEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderCallbackEvent" ADD CONSTRAINT "ProviderCallbackEvent_signingSessionId_fkey" FOREIGN KEY ("signingSessionId") REFERENCES "SigningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_briefingRecordId_fkey" FOREIGN KEY ("briefingRecordId") REFERENCES "BriefingRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "Reminder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_briefingRecordId_fkey" FOREIGN KEY ("briefingRecordId") REFERENCES "BriefingRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationJob" ADD CONSTRAINT "NotificationJob_assigneeUserId_fkey" FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_briefingRecordId_fkey" FOREIGN KEY ("briefingRecordId") REFERENCES "BriefingRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSite" ADD CONSTRAINT "WorkSite_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSite" ADD CONSTRAINT "WorkSite_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeGrant" ADD CONSTRAINT "ScopeGrant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeGrant" ADD CONSTRAINT "ScopeGrant_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScopeGrant" ADD CONSTRAINT "ScopeGrant_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorOrganization" ADD CONSTRAINT "ContractorOrganization_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorWorker" ADD CONSTRAINT "ContractorWorker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorWorker" ADD CONSTRAINT "ContractorWorker_contractorOrganizationId_fkey" FOREIGN KEY ("contractorOrganizationId") REFERENCES "ContractorOrganization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClearanceType" ADD CONSTRAINT "ClearanceType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingType" ADD CONSTRAINT "TrainingType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocumentType" ADD CONSTRAINT "ComplianceDocumentType_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplate" ADD CONSTRAINT "DocumentTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRoute" ADD CONSTRAINT "ApprovalRoute_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "ApprovalRoute"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEnvelope" ADD CONSTRAINT "DocumentEnvelope_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEnvelope" ADD CONSTRAINT "DocumentEnvelope_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEnvelope" ADD CONSTRAINT "DocumentEnvelope_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEnvelope" ADD CONSTRAINT "DocumentEnvelope_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEnvelope" ADD CONSTRAINT "DocumentEnvelope_approvalRouteId_fkey" FOREIGN KEY ("approvalRouteId") REFERENCES "ApprovalRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEnvelope" ADD CONSTRAINT "DocumentEnvelope_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CertificateMetadata" ADD CONSTRAINT "CertificateMetadata_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureVerification" ADD CONSTRAINT "SignatureVerification_signatureId_fkey" FOREIGN KEY ("signatureId") REFERENCES "Signature"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportSnapshot" ADD CONSTRAINT "ExportSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportSnapshot" ADD CONSTRAINT "ExportSnapshot_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExportSnapshot" ADD CONSTRAINT "ExportSnapshot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionPolicy" ADD CONSTRAINT "RetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveRecord" ADD CONSTRAINT "ArchiveRecord_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatrix" ADD CONSTRAINT "JobRequirementMatrix_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatrix" ADD CONSTRAINT "JobRequirementMatrix_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatrix" ADD CONSTRAINT "JobRequirementMatrix_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "JobRequirementMatrixVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRequirementMatrixVersion" ADD CONSTRAINT "JobRequirementMatrixVersion_matrixId_fkey" FOREIGN KEY ("matrixId") REFERENCES "JobRequirementMatrix"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlan" ADD CONSTRAINT "TrainingPlan_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "TrainingPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanVersion" ADD CONSTRAINT "TrainingPlanVersion_trainingPlanId_fkey" FOREIGN KEY ("trainingPlanId") REFERENCES "TrainingPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingPlanVersion" ADD CONSTRAINT "TrainingPlanVersion_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_basisDocumentId_fkey" FOREIGN KEY ("basisDocumentId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "OrderVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderVersion" ADD CONSTRAINT "OrderVersion_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderVersion" ADD CONSTRAINT "OrderVersion_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibleAssignment" ADD CONSTRAINT "ResponsibleAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibleAssignment" ADD CONSTRAINT "ResponsibleAssignment_orderVersionId_fkey" FOREIGN KEY ("orderVersionId") REFERENCES "OrderVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibleAssignment" ADD CONSTRAINT "ResponsibleAssignment_contractorWorkerId_fkey" FOREIGN KEY ("contractorWorkerId") REFERENCES "ContractorWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingJournal" ADD CONSTRAINT "BriefingJournal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingJournal" ADD CONSTRAINT "BriefingJournal_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingJournal" ADD CONSTRAINT "BriefingJournal_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingJournalEntry" ADD CONSTRAINT "BriefingJournalEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "BriefingJournal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefingJournalEntry" ADD CONSTRAINT "BriefingJournalEntry_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "WorkPermitVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_archiveRecordId_fkey" FOREIGN KEY ("archiveRecordId") REFERENCES "ArchiveRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermit" ADD CONSTRAINT "WorkPermit_contractorAccessActId_fkey" FOREIGN KEY ("contractorAccessActId") REFERENCES "ContractorAccessAct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_contractorOrganizationId_fkey" FOREIGN KEY ("contractorOrganizationId") REFERENCES "ContractorOrganization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_contractorRepresentativeId_fkey" FOREIGN KEY ("contractorRepresentativeId") REFERENCES "ContractorWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_hostRepresentativeEmployeeId_fkey" FOREIGN KEY ("hostRepresentativeEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_hostUnitChiefEmployeeId_fkey" FOREIGN KEY ("hostUnitChiefEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_archiveRecordId_fkey" FOREIGN KEY ("archiveRecordId") REFERENCES "ArchiveRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorAccessAct" ADD CONSTRAINT "ContractorAccessAct_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitVersion" ADD CONSTRAINT "WorkPermitVersion_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitVersion" ADD CONSTRAINT "WorkPermitVersion_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitVersion" ADD CONSTRAINT "WorkPermitVersion_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitApproval" ADD CONSTRAINT "WorkPermitApproval_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitPrecheckRun" ADD CONSTRAINT "WorkPermitPrecheckRun_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPermitClosure" ADD CONSTRAINT "WorkPermitClosure_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PpeIssueRecord" ADD CONSTRAINT "PpeIssueRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_archiveRecordId_fkey" FOREIGN KEY ("archiveRecordId") REFERENCES "ArchiveRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_replacesProtocolId_fkey" FOREIGN KEY ("replacesProtocolId") REFERENCES "Protocol"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_archiveRecordId_fkey" FOREIGN KEY ("archiveRecordId") REFERENCES "ArchiveRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "RetentionPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_replacesOrderId_fkey" FOREIGN KEY ("replacesOrderId") REFERENCES "ResponsibilityOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAppointment" ADD CONSTRAINT "ResponsibilityAppointment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAppointment" ADD CONSTRAINT "ResponsibilityAppointment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ResponsibilityOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAppointment" ADD CONSTRAINT "ResponsibilityAppointment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAppointment" ADD CONSTRAINT "ResponsibilityAppointment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAppointment" ADD CONSTRAINT "ResponsibilityAppointment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResponsibilityAppointment" ADD CONSTRAINT "ResponsibilityAppointment_workSiteId_fkey" FOREIGN KEY ("workSiteId") REFERENCES "WorkSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolEmployee" ADD CONSTRAINT "ProtocolEmployee_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolEmployee" ADD CONSTRAINT "ProtocolEmployee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProtocolCommissionMember" ADD CONSTRAINT "ProtocolCommissionMember_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brigade" ADD CONSTRAINT "Brigade_permitId_fkey" FOREIGN KEY ("permitId") REFERENCES "WorkPermit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeMember" ADD CONSTRAINT "BrigadeMember_brigadeId_fkey" FOREIGN KEY ("brigadeId") REFERENCES "Brigade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrigadeMember" ADD CONSTRAINT "BrigadeMember_contractorWorkerId_fkey" FOREIGN KEY ("contractorWorkerId") REFERENCES "ContractorWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_contractorWorkerId_fkey" FOREIGN KEY ("contractorWorkerId") REFERENCES "ContractorWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_clearanceTypeId_fkey" FOREIGN KEY ("clearanceTypeId") REFERENCES "ClearanceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_trainingTypeId_fkey" FOREIGN KEY ("trainingTypeId") REFERENCES "TrainingType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationDocument" ADD CONSTRAINT "QualificationDocument_documentEnvelopeId_fkey" FOREIGN KEY ("documentEnvelopeId") REFERENCES "DocumentEnvelope"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_matrixId_fkey" FOREIGN KEY ("matrixId") REFERENCES "JobRequirementMatrix"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_matrixVersionId_fkey" FOREIGN KEY ("matrixVersionId") REFERENCES "JobRequirementMatrixVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_trainingPlanVersionId_fkey" FOREIGN KEY ("trainingPlanVersionId") REFERENCES "TrainingPlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_briefingJournalEntryId_fkey" FOREIGN KEY ("briefingJournalEntryId") REFERENCES "BriefingJournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_protocolId_fkey" FOREIGN KEY ("protocolId") REFERENCES "Protocol"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdmissionEvaluation" ADD CONSTRAINT "AdmissionEvaluation_workPermitId_fkey" FOREIGN KEY ("workPermitId") REFERENCES "WorkPermit"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Experimental preservation of objects present in available historical migrations.
CREATE INDEX "BriefingRecord_briefingBatchId_idx" ON "BriefingRecord"("briefingBatchId");
CREATE INDEX "Employee_positionId_idx" ON "Employee"("positionId");
CREATE INDEX "Signature_briefingJournalEntryId_idx" ON "Signature"("briefingJournalEntryId");
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Protocol" ADD CONSTRAINT "Protocol_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResponsibilityOrder" ADD CONSTRAINT "ResponsibilityOrder_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BrigadeMember" ADD CONSTRAINT "BrigadeMember_subject_check" CHECK (("employeeId" IS NOT NULL) <> ("contractorWorkerId" IS NOT NULL));
ALTER TABLE "PpeIssueRecord" ADD CONSTRAINT "PpeIssueRecord_subject_check" CHECK (("employeeId" IS NOT NULL) <> ("contractorWorkerId" IS NOT NULL));
