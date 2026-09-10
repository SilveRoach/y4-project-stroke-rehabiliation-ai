import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { ApiError, getFileContent, updateUserProfile, uploadFile, type UserProfile } from "../services/api";
import { useAuth } from "../store/authStore";

// Shared hook: resolves a `files`-row id (e.g. the logged-in patient's
// profilePictureFileId) to a blob object URL the browser can render. The file
// lives behind the auth'd GET /files/:fileId/content endpoint, so an <img src>
// can't point at it directly — this fetches the bytes with the token and hands
// back an object URL, revoking it when the id changes or the component unmounts.
// Returns null while loading / when there's no file / if the fetch fails (callers
// fall back to the initials badge).
export function useProfilePicture(token: string | null | undefined, fileId: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!token || !fileId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    getFileContent(token, fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, fileId]);

  return url;
}

// Resolves the LOGGED-IN user's own profile picture (from the auth store) to a
// blob object URL — for the topbar/sidebar avatar chrome shared across pages.
// Returns null while loading / when there's no picture on file / if the fetch
// fails (callers fall back to the initials badge). Note: the picture id comes
// from the login payload, so users who logged in before this field existed
// need to re-login (or save Settings) once for it to appear.
export function useOwnProfilePicture(): string | null {
  const { token, user } = useAuth();
  return useProfilePicture(token, user?.profilePictureFileId ?? null);
}

// Shared upload flow used by every Settings page (Patient/Therapist/Admin):
// pick an image -> POST /files -> PATCH /users/:id { profilePictureFileId }.
// The caller passes its refresh callback as `onUpdated` — it receives the
// updated UserProfile (whose profilePictureFileId drives useProfilePicture).
export function useProfilePictureUpload(
  token: string | null | undefined,
  userId: string | null | undefined,
  onUpdated?: (profile: UserProfile) => void
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const openFilePicker = () => {
    if (!uploading) inputRef.current?.click();
  };

  async function uploadPicture(file: File) {
    if (!token || !userId) {
      setUploadError("Please log in again to change your profile picture.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file (JPG, PNG, etc.).");
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const { file: uploaded } = await uploadFile(token, file);
      if (uploaded.fileType !== "image") {
        throw new Error("The selected file must be an image.");
      }
      const res = await updateUserProfile(token, userId, { profilePictureFileId: uploaded.id });
      onUpdated?.(res.user);
    } catch (err) {
      setUploadError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Failed to upload your profile picture. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Allow re-picking the same file after a failure.
    event.target.value = "";
    if (file) void uploadPicture(file);
  };

  return { inputRef, uploading, uploadError, setUploadError, openFilePicker, handleFileChange };
}
