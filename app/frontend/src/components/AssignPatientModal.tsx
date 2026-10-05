import { Search, UserMinus, UserPlus, X } from "lucide-react";
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
        setLoadError("กรุณาเข้าสู่ระบบ");
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
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "โหลดรายชื่อผู้ป่วยไม่สำเร็จ กรุณาลองอีกครั้ง");
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
      setAssignError("กรุณาเข้าสู่ระบบ");
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
        setAssignError(body?.error?.message ?? "ผู้ป่วยรายนี้มีนักกายภาพบำบัดดูแลอยู่แล้ว");
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
      setAssignError(err instanceof Error ? err.message : "มอบหมายผู้ป่วยไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setAssigningId(null);
    }
  };

  // Remove a patient currently assigned to THIS therapist — DELETE
  // /therapists/:id/patients/:patientId (same endpoint the admin page's
  // unassign button uses). Stays in the modal and refreshes the list so the
  // row flips back to the green "Assign to me" state.
  const handleUnassign = async (patientId: string) => {
    setAssignError(null);
    setAssigningId(patientId);
    if (!token) {
      setAssignError("กรุณาเข้าสู่ระบบ");
      setAssigningId(null);
      return;
    }

    try {
      const res = await fetch(`/api/v1/therapists/${therapistId}/patients/${patientId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed (${res.status})`);
      }

      try {
        window.dispatchEvent(new CustomEvent("patientUnassigned", { detail: { patientId } }));
      } catch (e) {
        // ignore
      }

      // Refresh so the row shows "Unassigned" with the green Assign button.
      const refreshed = await fetch("/api/v1/patients", { headers: { Authorization: `Bearer ${token}` } });
      if (refreshed.ok) {
        const d = (await refreshed.json()) as { patients: PatientListItem[] };
        setPatients(d.patients);
      }
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "ยกเลิกการมอบหมายไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setAssigningId(null);
    }
  };

  return (
    <>
      <div className="therapist-panel-scrim" onClick={onClose} />
      <div className="admin-modal assign-patient-modal" role="dialog" aria-label="เพิ่มผู้ป่วย">
        <div className="therapist-detail-header">
          <strong>เพิ่มผู้ป่วย</strong>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิด">
            <X size={16} />
          </button>
        </div>

        <p className="assign-patient-subtitle">
          ค้นหารายชื่อผู้ป่วยทั้งหมดในระบบ มอบหมายผู้ป่วยที่ยังไม่มีนักกายภาพบำบัดให้กับคุณ หรือยกเลิกการมอบหมายผู้ป่วยที่คุณดูแลอยู่
        </p>

        <div className="therapist-search assign-patient-search">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาด้วยชื่อหรือนามสกุล…"
            aria-label="ค้นหาผู้ป่วยเพื่อมอบหมาย"
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
          <div className="assign-patient-header">
            <span>ผู้ป่วย</span>
            <span>สถานะ</span>
            <span>ผู้ดูแล</span>
            <span className="assign-patient-header-action">การดำเนินการ</span>
          </div>

          {loading && <p className="assign-patient-empty">กำลังโหลดรายชื่อผู้ป่วย…</p>}

          {!loading && filteredPatients.length === 0 && (
            <p className="assign-patient-empty">
              {patients.length === 0 ? "ยังไม่มีข้อมูลผู้ป่วยในระบบ" : "ไม่พบผู้ป่วยที่ตรงกับคำค้นหา"}
            </p>
          )}

          {!loading &&
            filteredPatients.map((patient) => {
              const isMine = patient.assignedTherapistId === therapistId;
              const isTakenByOther = Boolean(patient.assignedTherapistId) && !isMine;
              const isUnassigned = !patient.assignedTherapistId;
              const busy = assigningId === patient.id;

              return (
                <div className="assign-patient-row" key={patient.id}>
                  <div className="assign-patient-row-info">
                    <span className="therapist-avatar">
                      {(patient.displayName || "")
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </span>
                    <strong>{patient.displayName}</strong>
                  </div>

                  <span className={`badge-pill ${patient.status === "active" ? "good" : "fair"}`}>
                    {patient.status === "active" ? "ใช้งาน" : "ปิดใช้งาน"}
                  </span>

                  <div className="assign-patient-row-assigned">
                    {isMine ? (
                      <strong>คุณ</strong>
                    ) : isTakenByOther ? (
                      <strong>{patient.assignedTherapistName || "นักกายภาพบำบัดท่านอื่น"}</strong>
                    ) : (
                      <small>—</small>
                    )}
                  </div>

                  <div className="assign-patient-row-actions">
                    {isMine ? (
                      <button
                        type="button"
                        className="danger-button assign-patient-remove"
                        onClick={() => handleUnassign(patient.id)}
                        disabled={!canAssign || busy}
                      >
                        <UserMinus size={13} /> {busy ? "กำลังยกเลิก…" : "ยกเลิก"}
                      </button>
                    ) : isUnassigned ? (
                      <button
                        type="button"
                        className="primary-button assign-patient-assign"
                        onClick={() => handleAssign(patient.id)}
                        disabled={!canAssign || busy}
                      >
                        <UserPlus size={13} /> {busy ? "กำลังมอบหมาย…" : "มอบหมาย"}
                      </button>
                    ) : (
                      <span className="badge-pill muted">มีผู้ดูแลแล้ว</span>
                    )}
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
