-- Fix patient_therapist_assignments uniqueness (see schema.prisma's
-- PatientTherapistAssignment comment):
--   * DROP the old (patient_id, status) pair-unique — it only blocked exact
--     duplicates AND allowed at most one 'ended' row per patient ever, which
--     broke the second unassign of a re-assigned patient.
--   * ADD a partial unique index enforcing "one ACTIVE assignment per patient"
--     while still allowing unlimited historical 'ended' rows.

DROP INDEX IF EXISTS "patient_therapist_assignments_patient_id_status_key";

CREATE UNIQUE INDEX "patient_therapist_assignments_one_active_per_patient"
  ON "patient_therapist_assignments"("patient_id")
  WHERE "status" = 'active';
