-- CreateEnum
CREATE TYPE "users_role" AS ENUM ('patient', 'therapist', 'admin');

-- CreateEnum
CREATE TYPE "users_status" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "patients_gender" AS ENUM ('male', 'female', 'other', 'unknown');

-- CreateEnum
CREATE TYPE "exercise_library_movement_tracking" AS ENUM ('pose', 'virtual_grip', 'none');

-- CreateEnum
CREATE TYPE "exercise_library_difficulty" AS ENUM ('easy', 'medium', 'hard');

-- CreateEnum
CREATE TYPE "exercise_library_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "patient_rehabilitation_plans_status" AS ENUM ('draft', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "patient_therapist_assignments_status" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "rehabilitation_schedule_days_status" AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "scheduled_exercises_target_type" AS ENUM ('repetitions', 'duration', 'sets', 'distance', 'free');

-- CreateEnum
CREATE TYPE "scheduled_exercises_status" AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "exercise_performance_results_evaluation_source" AS ENUM ('ai', 'pt', 'manual');

-- CreateEnum
CREATE TYPE "files_type" AS ENUM ('image', 'video', 'document', 'audio', 'other');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "username" VARCHAR(100) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "email" VARCHAR(255),
    "phone_number" VARCHAR(20),
    "role" "users_role" NOT NULL,
    "status" "users_status" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMP(3),
    "profile_picture_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3),
    "updated_by" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patients" (
    "user_id" UUID NOT NULL,
    "first_name" VARCHAR(100),
    "last_name" VARCHAR(100),
    "gender" "patients_gender" NOT NULL DEFAULT 'unknown',
    "date_of_birth" DATE,
    "height_cm" DECIMAL(5,2),
    "weight_kg" DECIMAL(5,2),
    "address" TEXT,
    "emergency_contact_name" VARCHAR(100),
    "emergency_contact_phone" VARCHAR(20),

    CONSTRAINT "patients_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "therapists" (
    "user_id" UUID NOT NULL,
    "license_number" VARCHAR(100),
    "license_issued_date" DATE,
    "license_expiry_date" DATE,

    CONSTRAINT "therapists_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "admins" (
    "user_id" UUID NOT NULL,
    "employee_id" VARCHAR(50),

    CONSTRAINT "admins_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "exercise_library" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "parent_exercise_id" UUID,
    "version_number" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "movement_tracking" "exercise_library_movement_tracking" NOT NULL,
    "difficulty_level" "exercise_library_difficulty" NOT NULL,
    "demo_video_file_id" UUID,
    "base_criteria" JSONB,
    "status" "exercise_library_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "exercise_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_rehabilitation_plans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "description" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "status" "patient_rehabilitation_plans_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3),
    "updated_by" UUID,

    CONSTRAINT "patient_rehabilitation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehabilitation_plan_attachments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rehabilitation_plan_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "description" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" UUID,

    CONSTRAINT "rehabilitation_plan_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_therapist_assignments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "patient_id" UUID NOT NULL,
    "therapist_id" UUID NOT NULL,
    "status" "patient_therapist_assignments_status" NOT NULL DEFAULT 'active',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" UUID,
    "ended_at" TIMESTAMP(3),
    "ended_by" UUID,

    CONSTRAINT "patient_therapist_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rehabilitation_schedule_days" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "rehabilitation_plan_id" UUID NOT NULL,
    "scheduled_date" DATE NOT NULL,
    "status" "rehabilitation_schedule_days_status" NOT NULL DEFAULT 'pending',
    "therapist_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3),
    "updated_by" UUID,

    CONSTRAINT "rehabilitation_schedule_days_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_exercises" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "schedule_day_id" UUID NOT NULL,
    "exercise_library_id" UUID NOT NULL,
    "order_number" INTEGER,
    "target_type" "scheduled_exercises_target_type" NOT NULL,
    "target_value" JSONB,
    "therapist_instruction" TEXT,
    "status" "scheduled_exercises_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMP(3),
    "updated_by" UUID,

    CONSTRAINT "scheduled_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exercise_performance_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scheduled_exercise_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "reference_video" UUID,
    "completed_at" TIMESTAMP(3),
    "ai_score" DECIMAL(5,2),
    "ai_feedback" TEXT,
    "ai_metrics" JSONB,
    "ai_evaluated_at" TIMESTAMP(3),
    "pt_score" DECIMAL(5,2),
    "pt_feedback" TEXT,
    "pt_evaluated_by" UUID,
    "pt_evaluated_at" TIMESTAMP(3),
    "final_score" DECIMAL(5,2),
    "evaluation_source" "exercise_performance_results_evaluation_source",
    "performance_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exercise_performance_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "file_type" "files_type" NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "stored_name" VARCHAR(255) NOT NULL,
    "mime_type" VARCHAR(100),
    "file_size" BIGINT,
    "storage_path" TEXT NOT NULL,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "therapists_license_number_key" ON "therapists"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "admins_employee_id_key" ON "admins"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_library_parent_exercise_id_version_number_key" ON "exercise_library"("parent_exercise_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "patient_therapist_assignments_patient_id_status_key" ON "patient_therapist_assignments"("patient_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rehabilitation_schedule_days_rehabilitation_plan_id_schedul_key" ON "rehabilitation_schedule_days"("rehabilitation_plan_id", "scheduled_date");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_exercises_schedule_day_id_order_number_key" ON "scheduled_exercises"("schedule_day_id", "order_number");

-- CreateIndex
CREATE UNIQUE INDEX "exercise_performance_results_scheduled_exercise_id_attempt__key" ON "exercise_performance_results"("scheduled_exercise_id", "attempt_number");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_profile_picture_file_id_fkey" FOREIGN KEY ("profile_picture_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "therapists" ADD CONSTRAINT "therapists_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_library" ADD CONSTRAINT "exercise_library_parent_exercise_id_fkey" FOREIGN KEY ("parent_exercise_id") REFERENCES "exercise_library"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_library" ADD CONSTRAINT "exercise_library_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_library" ADD CONSTRAINT "exercise_library_demo_video_file_id_fkey" FOREIGN KEY ("demo_video_file_id") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_rehabilitation_plans" ADD CONSTRAINT "patient_rehabilitation_plans_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_rehabilitation_plans" ADD CONSTRAINT "patient_rehabilitation_plans_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapists"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_rehabilitation_plans" ADD CONSTRAINT "patient_rehabilitation_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_rehabilitation_plans" ADD CONSTRAINT "patient_rehabilitation_plans_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_plan_attachments" ADD CONSTRAINT "rehabilitation_plan_attachments_rehabilitation_plan_id_fkey" FOREIGN KEY ("rehabilitation_plan_id") REFERENCES "patient_rehabilitation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_plan_attachments" ADD CONSTRAINT "rehabilitation_plan_attachments_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_plan_attachments" ADD CONSTRAINT "rehabilitation_plan_attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_therapist_assignments" ADD CONSTRAINT "patient_therapist_assignments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_therapist_assignments" ADD CONSTRAINT "patient_therapist_assignments_therapist_id_fkey" FOREIGN KEY ("therapist_id") REFERENCES "therapists"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_therapist_assignments" ADD CONSTRAINT "patient_therapist_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_therapist_assignments" ADD CONSTRAINT "patient_therapist_assignments_ended_by_fkey" FOREIGN KEY ("ended_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_schedule_days" ADD CONSTRAINT "rehabilitation_schedule_days_rehabilitation_plan_id_fkey" FOREIGN KEY ("rehabilitation_plan_id") REFERENCES "patient_rehabilitation_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_schedule_days" ADD CONSTRAINT "rehabilitation_schedule_days_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rehabilitation_schedule_days" ADD CONSTRAINT "rehabilitation_schedule_days_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_exercises" ADD CONSTRAINT "scheduled_exercises_schedule_day_id_fkey" FOREIGN KEY ("schedule_day_id") REFERENCES "rehabilitation_schedule_days"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_exercises" ADD CONSTRAINT "scheduled_exercises_exercise_library_id_fkey" FOREIGN KEY ("exercise_library_id") REFERENCES "exercise_library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_exercises" ADD CONSTRAINT "scheduled_exercises_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_exercises" ADD CONSTRAINT "scheduled_exercises_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_performance_results" ADD CONSTRAINT "exercise_performance_results_scheduled_exercise_id_fkey" FOREIGN KEY ("scheduled_exercise_id") REFERENCES "scheduled_exercises"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_performance_results" ADD CONSTRAINT "exercise_performance_results_pt_evaluated_by_fkey" FOREIGN KEY ("pt_evaluated_by") REFERENCES "therapists"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exercise_performance_results" ADD CONSTRAINT "exercise_performance_results_reference_video_fkey" FOREIGN KEY ("reference_video") REFERENCES "files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
