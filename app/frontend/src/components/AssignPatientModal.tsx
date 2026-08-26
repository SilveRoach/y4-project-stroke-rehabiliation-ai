import { Search, UserPlus, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "../store/authStore";
import type { PatientListItem, TherapistPatientSummary } from "../types";

interface AssignPatientModalProps {
  therapistId: string;
  therapistName?: string;
  onClose: () => void;
  onAssigned: (patient: TherapistPatientSummary) => void;
}

export function AssignPatientModal({ therapistId, therapistName, onClose, onAssigned }: AssignPatientModalProps) {
  const { token, user } = useAuth();
  const [search, setSearch] = useState("");
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    async function fetchPatients() {
      if (!token) {
        setLoadError("Authentication required.");
        setLoading(false);
        return;
      }
      try {
        const qs = search && search.trim().length > 0 ? `?q=${encodeURIComponent(search.trim())}` : "";
        const res = await fetch(`/api/v1/patients${qs}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
        }
        const data = (await res.json()) as { patients: PatientListItem[] };
        if (!cancelled) setPatients(data.patients);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Couldn't load patients. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchPatients();
    return () => {
      cancelled = true;
    };
  }, [token, search]);

  const filteredPatients = useMemo(() => patients, [patients]);

  // Therapist can only assign themselves — check user.id from AuthUser
  const canAssign = !!token && !!user && user.role === "therapist" && user.id === therapistId;

  const handleAssign = async (patientId: string) => {
    setAssignError(null);
    setAssigningId(patientId);
    if (!token) {
      setAssignError("Authentication required.");
      setAssigningId(null);
      return;
    }

    try {
      const res = await fetch(`/api/v1/therapists/${therapistId}/patients`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientId })
      });

      if (res.status === 409) {
        const body = await res.json().catch(() => null);
        setAssignError(body?.error?.message ?? "This patient is already assigned to another therapist.");
        // refresh list to reflect new assignment state
        try {
          const refreshed = await fetch(`/api/v1/patients`, { headers: { Authorization: `Bearer ${token}` } });
          if (refreshed.ok) {
            const d = (await refreshed.json()) as { patients: PatientListItem[] };
            setPatients(d.patients);
          }
        } catch (e) {
          // ignore
        }
        return;
      }

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }

      const body = (await res.json()) as { patient: TherapistPatientSummary };

      onAssigned(body.patient);
      try {
        window.dispatchEvent(new CustomEvent("patientAssigned", { detail: body.patient }));
      } catch (e) {
        // ignore
      }
      onClose();
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Couldn't assign patient. Please try again.");
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="admin-modal assign-patient-modal" role="dialog" aria-label="Add patient">
        <div className="therapist-detail-header">
          <strong>Add Patient</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="assign-patient-subtitle">
          Search every patient on the server. You can only assign yourself to a patient who doesn't have a therapist yet.
        </p>

        <div className="therapist-search assign-patient-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by first or last name…"
            aria-label="Search patients to assign"
            autoFocus
          />
        </div>

        {loadError && (
          <p className="auth-error-banner" role="alert">
            {loadError}
          </p>
        )}
        {assignError && (
          <p className="auth-error-banner" role="alert">
            {assignError}
          </p>
        )}

        <div className="assign-patient-list">
          {loading && <p className="assign-patient-empty">Loading patients…</p>}

          {!loading && filteredPatients.length === 0 && (
            <p className="assign-patient-empty">
              {patients.length === 0 ? "No patients exist on the server yet." : "No patients match your search."}
            </p>
          )}

          {!loading &&
            filteredPatients.map((patient) => {
              const isMine = patient.assignedTherapistId === therapistId;
              const isTakenByOther = Boolean(patient.assignedTherapistId) && !isMine;
              const isUnassigned = !patient.assignedTherapistId;

              return (
                <div className="assign-patient-row" key={patient.id}>
                  <div className="assign-patient-row-info">
                    <span className="therapist-avatar">{(patient.displayName || "").split(" ").map(n=>n[0]).slice(0,2).join("")}</span>
                    <div>
                      <strong>{patient.displayName}</strong>
                      <small>{isUnassigned ? "Unassigned" : `Assigned to ${isMine ? "you" : patient.assignedTherapistName}`}</small>
                    </div>
                  </div>

                  <div className="assign-patient-row-actions">
                    <span className={`badge-pill ${patient.status === "active" ? "good" : "fair"}`}>
                      {patient.status === "active" ? "Active" : "Disabled"}
                    </span>

                    {isMine && <span className="badge-pill good">Yours</span>}

                    {isTakenByOther ? (
                      <button type="button" className="secondary-button" disabled title={`Already assigned to ${patient.assignedTherapistName}`}>
                        Assigned
                      </button>
                    ) : isUnassigned ? (
                      <button type="button" className="primary-button" onClick={() => handleAssign(patient.id)} disabled={!canAssign || assigningId === patient.id}>
                        <UserPlus size={13} /> {assigningId === patient.id ? "Assigning…" : "Assign to me"}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
        </div>
      </div>
    </>
  );
}

export default AssignPatientModal
