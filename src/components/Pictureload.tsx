import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PICTURELOAD_STORAGE_BUCKET } from '../lib/pictureloadStorage';
import { rowToPictureloadImage } from '../lib/dbMap';
import type { PictureloadImage, PictureloadModerationStatus, SessionPermissions } from '../types';
import {
  Ban,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  Images,
  Loader2,
  Trash2,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';

const MAX_BYTES = 6 * 1024 * 1024;
/** Breit genug für iOS Fotos-App; Validierung bleibt in extFromMime/uploadSingleFile. */
const ACCEPT =
  'image/*,.jpg,.jpeg,.png,.webp,.heic,.heif,image/jpeg,image/png,image/webp,image/heic,image/heif';

type TeacherGridFilter = 'all' | 'approved' | 'pending' | 'rejected';

type UploadFileError = { fileName: string; message: string };

/** Klare Meldung bei fehlendem Bucket vs. sonstigen Storage-Fehlern. */
function formatPictureloadStorageError(message: string | undefined): string {
  const raw = (message || '').trim();
  if (!raw) return 'Speichern im Storage ist fehlgeschlagen.';
  const low = raw.toLowerCase();
  if (low.includes('bucket not found') || (low.includes('not found') && low.includes('bucket'))) {
    return (
      `Supabase Storage: Der Bucket „${PICTURELOAD_STORAGE_BUCKET}“ existiert nicht. ` +
      'Lege im Dashboard unter „Storage“ einen öffentlichen Bucket mit genau diesem Namen an, oder wende die SQL-Migrationen an (z. B. `007_pictureload.sql` und `009_pictureload_ensure_storage_bucket.sql`).'
    );
  }
  return raw;
}

function extFromMime(mime: string, fileName = ''): string | null {
  const m = (mime || '').toLowerCase().trim();
  const fn = fileName.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/heic' || m === 'image/heif') return '.heic';
  if (!m || m === 'application/octet-stream') {
    if (fn.endsWith('.heic')) return '.heic';
    if (fn.endsWith('.heif')) return '.heif';
    if (fn.endsWith('.jpg') || fn.endsWith('.jpeg')) return '.jpg';
    if (fn.endsWith('.png')) return '.png';
    if (fn.endsWith('.webp')) return '.webp';
  }
  return null;
}

function storageContentType(file: File, ext: string): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type;
  if (ext === '.heic' || ext === '.heif') return 'image/heic';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

function publicUrlForPath(path: string): string {
  const { data } = supabase.storage.from(PICTURELOAD_STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('de-DE', {
      dateStyle: 'short',
      timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

function statusLabel(st: PictureloadModerationStatus): string {
  if (st === 'pending') return 'Ausstehend';
  if (st === 'rejected') return 'Abgelehnt';
  return 'Freigegeben';
}

function statusChipClass(st: PictureloadModerationStatus): string {
  if (st === 'pending') return 'bg-amber-500/95 text-white';
  if (st === 'rejected') return 'bg-rose-600/95 text-white';
  return 'bg-emerald-600/95 text-white';
}

interface PictureloadProps {
  sessionId: string;
  isTeacher: boolean;
  permissions: SessionPermissions;
  presentationMode?: boolean;
}

async function uploadSingleFile(
  sessionId: string,
  userId: string,
  displayName: string | null,
  file: File
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ext = extFromMime(file.type, file.name);
  if (!ext) {
    return {
      ok: false,
      message: 'Ungültiger Dateityp (z. B. JPG, PNG, WEBP oder iPhone HEIC).',
    };
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: `Zu groß (max. ${Math.round(MAX_BYTES / (1024 * 1024))} MB).` };
  }

  const fileId = crypto.randomUUID();
  const path = `${sessionId}/${fileId}${ext}`;
  const ct = storageContentType(file, ext);

  const { error: upErr } = await supabase.storage.from(PICTURELOAD_STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: ct,
  });
  if (upErr) {
    return { ok: false, message: formatPictureloadStorageError(upErr.message) };
  }

  const { error: insErr } = await supabase.from('pictureload_images').insert({
    session_id: sessionId,
    storage_path: path,
    author_id: userId,
    author_display_name: displayName,
    content_type: ct,
  });
  if (insErr) {
    await supabase.storage.from(PICTURELOAD_STORAGE_BUCKET).remove([path]);
    return { ok: false, message: insErr.message || 'Metadaten speichern fehlgeschlagen.' };
  }

  return { ok: true };
}

export default function Pictureload({
  sessionId,
  isTeacher,
  permissions,
  presentationMode = false,
}: PictureloadProps) {
  const [images, setImages] = useState<PictureloadImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadFileErrors, setUploadFileErrors] = useState<UploadFileError[]>([]);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [teacherFilter, setTeacherFilter] = useState<TeacherGridFilter>('all');
  const [teacherStudentPreview, setTeacherStudentPreview] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const canUpload = isTeacher || permissions.pictureload;
  const moderationOn = permissions.pictureloadModeration === true;

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('pictureload_images')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error(error);
      return;
    }
    setImages((data ?? []).map((r) => rowToPictureloadImage(r as Record<string, unknown>)));
  }, [sessionId]);

  const displayedImages = useMemo(() => {
    if (!isTeacher) return images;
    if (teacherStudentPreview) {
      return images.filter((i) => i.moderationStatus === 'approved');
    }
    switch (teacherFilter) {
      case 'approved':
        return images.filter((i) => i.moderationStatus === 'approved');
      case 'pending':
        return images.filter((i) => i.moderationStatus === 'pending');
      case 'rejected':
        return images.filter((i) => i.moderationStatus === 'rejected');
      default:
        return images;
    }
  }, [images, isTeacher, teacherFilter, teacherStudentPreview]);

  const lightboxIndex = useMemo(() => {
    if (!lightboxId) return -1;
    return displayedImages.findIndex((i) => i.id === lightboxId);
  }, [lightboxId, displayedImages]);

  const lightbox =
    lightboxIndex >= 0 ? displayedImages[lightboxIndex] : lightboxId ? images.find((i) => i.id === lightboxId) ?? null : null;

  const goLightbox = useCallback(
    (delta: number) => {
      setLightboxId((id) => {
        if (!id) return null;
        const idx = displayedImages.findIndex((i) => i.id === id);
        if (idx < 0) return id;
        const next = idx + delta;
        if (next < 0 || next >= displayedImages.length) return id;
        return displayedImages[next].id;
      });
    },
    [displayedImages]
  );

  useEffect(() => {
    if (!uploadInfo) return;
    const t = window.setTimeout(() => setUploadInfo(null), 6200);
    return () => window.clearTimeout(t);
  }, [uploadInfo]);

  useEffect(() => {
    if (!lightboxId) return;
    const inDisplayed = displayedImages.some((i) => i.id === lightboxId);
    if (!inDisplayed) {
      const stillExists = images.some((i) => i.id === lightboxId);
      if (!stillExists) setLightboxId(null);
    }
  }, [displayedImages, images, lightboxId]);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxId(null);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goLightbox(-1);
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goLightbox(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, goLightbox]);

  useEffect(() => {
    void reload();
    const channel = supabase
      .channel(`pictureload-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'pictureload_images',
          filter: `session_id=eq.${sessionId}`,
        },
        () => {
          void reload();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, reload]);

  const pendingCount = useMemo(
    () => images.filter((i) => i.moderationStatus === 'pending').length,
    [images]
  );

  const setModerationStatus = async (img: PictureloadImage, status: PictureloadModerationStatus) => {
    if (!isTeacher) return;
    const { error } = await supabase
      .from('pictureload_images')
      .update({ moderation_status: status })
      .eq('id', img.id);
    if (error) {
      console.error(error);
      alert(error.message || 'Aktualisierung fehlgeschlagen.');
      return;
    }
    await reload();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setUploadError(null);
    setUploadFileErrors([]);

    const input = e.target;
    // Wichtig: FileList ist in WebKit/Blink oft an das Input-Element gebunden und wird durch
    // value='' geleert. Zuerst in ein Array kopieren, sonst ist list.length nach dem Reset 0.
    const files =
      input.files && input.files.length > 0 ? Array.from(input.files) : [];
    input.value = '';

    if (!files.length || !canUpload || uploading) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setUploadError('Bitte zuerst der Sitzung beitreten.');
      return;
    }

    let displayName: string | null = null;
    const { data: mem } = await supabase
      .from('session_members')
      .select('display_name')
      .eq('session_id', sessionId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (mem?.display_name != null && String(mem.display_name).trim()) {
      displayName = String(mem.display_name).trim();
    }

    setUploading(true);
    setUploadError(null);
    setUploadFileErrors([]);
    setUploadProgress({ current: 0, total: files.length });

    const errors: UploadFileError[] = [];
    let okCount = 0;

    try {
      setUploadProgress({ current: 0, total: files.length });
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ current: i, total: files.length });
        const result = await uploadSingleFile(sessionId, user.id, displayName, file);
        if (result.ok) {
          okCount += 1;
        } else {
          errors.push({ fileName: file.name || `Datei ${i + 1}`, message: result.message });
        }
        setUploadProgress({ current: i + 1, total: files.length });
      }

      if (errors.length > 0) {
        setUploadFileErrors(errors);
      }
      if (okCount === 0 && errors.length > 0) {
        setUploadError('Keine der ausgewählten Dateien konnte hochgeladen werden.');
      } else if (errors.length > 0) {
        setUploadError(
          `${errors.length} von ${files.length} Datei(en) fehlgeschlagen. Details siehe unten.`
        );
      }

      if (okCount > 0) {
        if (moderationOn && !isTeacher) {
          setUploadInfo(
            okCount === 1
              ? '1 Bild eingereicht. Es erscheint auf der Wand, sobald die Lehrkraft es freigibt.'
              : `${okCount} Bilder eingereicht. Sie erscheinen auf der Wand, sobald die Lehrkraft sie freigibt.`
          );
        } else if (!isTeacher) {
          setUploadInfo(okCount === 1 ? '1 Bild wurde hochgeladen.' : `${okCount} Bilder wurden hochgeladen.`);
        } else {
          setUploadInfo(okCount === 1 ? '1 Bild wurde hochgeladen.' : `${okCount} Bilder wurden hochgeladen.`);
        }
        await reload();
      }
    } catch (err) {
      console.error(err);
      setUploadError('Upload wurde abgebrochen (unerwarteter Fehler).');
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const removeImage = async (img: PictureloadImage) => {
    if (!isTeacher) return;
    if (!confirm('Dieses Bild wirklich löschen?')) return;
    const { error: stErr } = await supabase.storage.from(PICTURELOAD_STORAGE_BUCKET).remove([img.storagePath]);
    if (stErr) {
      console.error(stErr);
      alert(formatPictureloadStorageError(stErr.message));
      return;
    }
    const { error: delErr } = await supabase.from('pictureload_images').delete().eq('id', img.id);
    if (delErr) {
      console.error(delErr);
      alert('Löschen in der Datenbank fehlgeschlagen. Bitte erneut versuchen.');
      return;
    }
    setLightboxId((cur) => (cur === img.id ? null : cur));
    await reload();
  };

  const bulkApprovePending = async () => {
    if (!isTeacher || pendingCount === 0) return;
    if (!confirm(`${pendingCount} ausstehende Bilder freigeben?`)) return;
    setBulkBusy(true);
    try {
      const { error } = await supabase
        .from('pictureload_images')
        .update({ moderation_status: 'approved' })
        .eq('session_id', sessionId)
        .eq('moderation_status', 'pending');
      if (error) {
        console.error(error);
        alert(error.message || 'Sammel-Freigabe fehlgeschlagen.');
        return;
      }
      await reload();
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDeleteNonApproved = async () => {
    if (!isTeacher) return;
    const targets = images.filter(
      (i) => i.moderationStatus === 'pending' || i.moderationStatus === 'rejected'
    );
    if (targets.length === 0) return;
    if (!confirm(`${targets.length} nicht freigegebene Bilder unwiderruflich löschen?`)) return;
    setBulkBusy(true);
    try {
      for (const img of targets) {
        const { error: stErr } = await supabase.storage.from(PICTURELOAD_STORAGE_BUCKET).remove([img.storagePath]);
        if (stErr) console.error(stErr);
        const { error: delErr } = await supabase.from('pictureload_images').delete().eq('id', img.id);
        if (delErr) console.error(delErr);
      }
      setLightboxId((cur) => (cur && targets.some((t) => t.id === cur) ? null : cur));
      await reload();
    } finally {
      setBulkBusy(false);
    }
  };

  const gap = presentationMode ? 'gap-3 sm:gap-4' : 'gap-2.5 sm:gap-3.5';
  const cols =
    'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';

  const headerHint = (() => {
    if (!canUpload) {
      return 'Deine Lehrkraft hat das Hochladen deaktiviert. Du kannst freigegebene Bilder ansehen.';
    }
    if (moderationOn && !isTeacher) {
      return 'Lade Fotos hoch (einzeln oder mehrere gleichzeitig). Die Lehrkraft entscheidet, ob sie auf der Wand erscheinen.';
    }
    if (canUpload) {
      return 'Smartphone: „Mediathek“ (mehrere Bilder) oder „Kamera“ (ein Foto). Computer: „Fotos hochladen“. Formate z. B. JPG, PNG, HEIC – max. 6 MB pro Datei.';
    }
    return '';
  })();

  const canPrevLightbox = lightboxIndex > 0;
  const canNextLightbox = lightboxIndex >= 0 && lightboxIndex < displayedImages.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-slate-50">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm leading-relaxed text-slate-600">{headerHint}</p>
              {moderationOn && isTeacher && (
                <p className="mt-2 text-xs text-slate-500">
                  Moderation ist aktiv: SuS sehen nur freigegebene Bilder. Du siehst alle Zustände und kannst
                  freigeben, ablehnen oder löschen.
                </p>
              )}
              {uploading && uploadProgress && (
                <div className="mt-3 space-y-2" role="status" aria-live="polite">
                  <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-hidden />
                      Fertig: {uploadProgress.current} / {uploadProgress.total}
                      {uploadProgress.current < uploadProgress.total ? ' – nächste Datei …' : ''}
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {uploadProgress.total > 0
                        ? Math.round((uploadProgress.current / uploadProgress.total) * 100)
                        : 0}{' '}
                      %
                    </span>
                  </div>
                  <progress
                    className="h-2.5 w-full overflow-hidden rounded-full accent-blue-600 [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-slate-200 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-blue-600 [&::-moz-progress-bar]:rounded-full [&::-moz-progress-bar]:bg-blue-600"
                    value={uploadProgress.current}
                    max={uploadProgress.total}
                  />
                </div>
              )}
              {uploadError && (
                <p className="mt-2 text-sm font-semibold text-rose-600" role="alert">
                  {uploadError}
                </p>
              )}
              {uploadFileErrors.length > 0 && (
                <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto rounded-xl border border-rose-100 bg-rose-50/80 px-3 py-2 text-xs text-rose-900">
                  {uploadFileErrors.map((fe, i) => (
                    <li key={`${fe.fileName}-${i}`} className="leading-snug">
                      <span className="font-semibold">{fe.fileName}:</span> {fe.message}
                    </li>
                  ))}
                </ul>
              )}
              {uploadInfo && (
                <p className="mt-2 text-sm font-medium text-emerald-700" role="status">
                  {uploadInfo}
                </p>
              )}
            </div>
            {canUpload && (
              <>
                {/* iPhone / schmale Viewports: zwei native Inputs (Mediathek vs. Kamera) – zuverlässiger als ein Feld mit capture */}
                <div
                  className={`grid w-full max-w-md shrink-0 grid-cols-2 gap-2 md:hidden ${
                    bulkBusy && !uploading ? 'pointer-events-none opacity-60' : ''
                  }`}
                >
                  {uploading ? (
                    <div
                      className="col-span-2 flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-3 text-center text-xs font-bold text-white"
                      role="status"
                      aria-live="polite"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                        Upload läuft …
                      </span>
                      {uploadProgress && (
                        <span className="text-[11px] font-semibold text-blue-100">
                          {uploadProgress.current} von {uploadProgress.total} Dateien
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <label
                        className="relative flex min-h-[56px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl bg-blue-600 px-2 py-2 text-center text-xs font-bold text-white shadow-sm transition-[transform,background-color] hover:bg-blue-700 active:scale-[0.98] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-blue-600"
                        aria-label="Fotos aus der Mediathek auswählen"
                      >
                        <input
                          type="file"
                          accept={ACCEPT}
                          multiple
                          disabled={bulkBusy}
                          className="absolute inset-0 z-20 h-full min-h-[56px] w-full cursor-pointer text-[16px] leading-none opacity-0 disabled:cursor-not-allowed"
                          onChange={onFileChange}
                        />
                        <span className="pointer-events-none relative z-10 flex flex-col items-center gap-0.5">
                          <Images className="h-5 w-5 shrink-0" aria-hidden />
                          <span className="leading-tight">Mediathek</span>
                          <span className="text-[10px] font-semibold text-blue-100">Mehrere</span>
                        </span>
                      </label>
                      <label
                        className="relative flex min-h-[56px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl bg-slate-700 px-2 py-2 text-center text-xs font-bold text-white shadow-sm transition-[transform,background-color] hover:bg-slate-800 active:scale-[0.98] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-slate-700"
                        aria-label="Foto mit der Kamera aufnehmen"
                      >
                        <input
                          type="file"
                          accept={ACCEPT}
                          capture="environment"
                          disabled={bulkBusy}
                          className="absolute inset-0 z-20 h-full min-h-[56px] w-full cursor-pointer text-[16px] leading-none opacity-0 disabled:cursor-not-allowed"
                          onChange={onFileChange}
                        />
                        <span className="pointer-events-none relative z-10 flex flex-col items-center gap-0.5">
                          <Camera className="h-5 w-5 shrink-0" aria-hidden />
                          <span className="leading-tight">Kamera</span>
                          <span className="text-[10px] font-semibold text-slate-200">Ein Foto</span>
                        </span>
                      </label>
                    </>
                  )}
                </div>

                {/* Tablet/Desktop: ein kombinierter Upload (Mehrfachauswahl) */}
                <label
                  className={`relative hidden min-h-[52px] min-w-[12rem] shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm transition-[transform,opacity,background-color] hover:bg-blue-700 active:scale-[0.98] sm:min-w-[200px] md:inline-flex ${
                    uploading || bulkBusy ? 'pointer-events-none opacity-60' : ''
                  } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-white has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-blue-600`}
                  aria-label="Fotos aus Mediathek auswählen und hochladen"
                >
                  <input
                    type="file"
                    accept={ACCEPT}
                    multiple
                    disabled={uploading || bulkBusy}
                    className="absolute inset-0 z-20 h-full min-h-[52px] w-full cursor-pointer text-[16px] leading-none opacity-0 disabled:cursor-not-allowed"
                    onChange={onFileChange}
                  />
                  <span className="pointer-events-none relative z-10 flex flex-col items-center gap-0.5">
                    {uploading ? (
                      <>
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                          Upload läuft …
                        </span>
                        {uploadProgress && (
                          <span className="text-xs font-semibold text-blue-100">
                            {uploadProgress.current} von {uploadProgress.total} Dateien
                          </span>
                        )}
                      </>
                    ) : (
                      <>
                        <span className="inline-flex items-center gap-2">
                          <ImagePlus className="h-5 w-5" aria-hidden />
                          Fotos hochladen
                        </span>
                        <span className="text-[11px] font-semibold text-blue-100">Mehrfachauswahl möglich</span>
                      </>
                    )}
                  </span>
                </label>
              </>
            )}
          </div>

          {isTeacher && images.length > 0 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/80 p-3 sm:p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['all', 'Alle'],
                      ['approved', 'Freigegeben'],
                      ['pending', `Ausstehend (${pendingCount})`],
                      ['rejected', 'Abgelehnt'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      disabled={bulkBusy || teacherStudentPreview}
                      onClick={() => setTeacherFilter(key)}
                      className={`min-h-[44px] rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors ${
                        teacherFilter === key && !teacherStudentPreview
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100'
                      } disabled:opacity-50`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => {
                    setTeacherStudentPreview((v) => !v);
                    if (!teacherStudentPreview) setTeacherFilter('all');
                  }}
                  className={`min-h-[44px] rounded-xl px-3.5 py-2 text-sm font-semibold ring-1 transition-colors ${
                    teacherStudentPreview
                      ? 'bg-blue-600 text-white ring-blue-600'
                      : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {teacherStudentPreview ? 'SuS-Ansicht aktiv' : 'Wie SuS ansehen'}
                </button>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  disabled={bulkBusy || pendingCount === 0}
                  onClick={() => void bulkApprovePending()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Alle ausstehenden freigeben
                </button>
                <button
                  type="button"
                  disabled={bulkBusy}
                  onClick={() => void bulkDeleteNonApproved()}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Nicht freigegebene löschen
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-4 py-5 sm:px-6 sm:py-8 ${presentationMode ? 'sm:py-10' : ''}`}
      >
        <div className={`mx-auto max-w-[1400px] ${cols} ${gap}`}>
          {displayedImages.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center text-slate-500 shadow-sm">
              <p className="font-semibold text-slate-700">Keine Bilder in dieser Ansicht</p>
              <p className="mx-auto mt-2 max-w-md text-sm">
                {isTeacher && teacherStudentPreview
                  ? 'So sieht die Wand für SuS aus (nur freigegebene Bilder).'
                  : canUpload
                    ? 'Tippe auf „Fotos hochladen“, um die Bilderwand zu starten.'
                    : 'Sobald die Lehrkraft Bilder freigibt, erscheinen sie hier.'}
              </p>
            </div>
          )}
          {displayedImages.map((img) => {
            const url = publicUrlForPath(img.storagePath);
            return (
              <article
                key={img.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-100/80 transition-shadow hover:shadow-md"
              >
                <div className="relative aspect-square w-full overflow-hidden bg-slate-100">
                  <button
                    type="button"
                    className="absolute inset-0 flex h-full w-full items-center justify-center p-1.5 sm:p-2"
                    onClick={() => setLightboxId(img.id)}
                    aria-label={`Bild vergrößern: ${img.authorDisplayName || 'Bild'}`}
                  >
                    <img
                      src={url}
                      alt=""
                      className="max-h-full max-w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                      loading="lazy"
                    />
                  </button>
                  {isTeacher && (
                    <span
                      className={`pointer-events-none absolute left-2 top-2 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide shadow-sm ${statusChipClass(
                        img.moderationStatus
                      )}`}
                    >
                      {statusLabel(img.moderationStatus)}
                    </span>
                  )}
                </div>
                <div className="flex min-h-[5.5rem] flex-1 flex-col gap-2 border-t border-slate-100 px-2.5 py-2.5">
                  <div className="min-w-0 flex-1 text-[11px] leading-snug text-slate-600">
                    <div className="flex items-center gap-1 truncate font-medium text-slate-800">
                      <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      <span className="truncate">
                        {img.authorDisplayName?.trim() || 'Ohne Anzeigenamen'}
                      </span>
                    </div>
                    <div className="mt-0.5 tabular-nums text-slate-500">{formatWhen(img.createdAt)}</div>
                    {!isTeacher && moderationOn && (
                      <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Freigegeben
                      </div>
                    )}
                  </div>
                  {isTeacher && (
                    <div className="flex flex-wrap gap-1.5">
                      {img.moderationStatus !== 'approved' && (
                        <button
                          type="button"
                          disabled={bulkBusy}
                          onClick={() => void setModerationStatus(img, 'approved')}
                          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 sm:flex-none sm:px-3"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          OK
                        </button>
                      )}
                      {img.moderationStatus !== 'rejected' && (
                        <button
                          type="button"
                          disabled={bulkBusy}
                          onClick={() => void setModerationStatus(img, 'rejected')}
                          className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-amber-600 px-2 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 sm:flex-none sm:px-3"
                        >
                          <Ban className="h-3.5 w-3.5" />
                          Ablehnen
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={bulkBusy}
                        onClick={() => void removeImage(img)}
                        className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg bg-slate-800 px-2 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50 sm:flex-none sm:px-3"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Löschen
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex flex-col bg-black/92 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
          role="dialog"
          aria-modal="true"
          aria-label="Vollbildansicht Bilderwand"
        >
          <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-1 sm:px-4 sm:pt-2">
            <div className="min-w-0 text-xs font-medium text-white/80 sm:text-sm">
              {lightboxIndex >= 0 && displayedImages.length > 1 && (
                <span className="tabular-nums">
                  {lightboxIndex + 1} / {displayedImages.length}
                </span>
              )}
            </div>
            <button
              type="button"
              className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-full bg-white/12 text-white hover:bg-white/22"
              onClick={() => setLightboxId(null)}
              aria-label="Schließen"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 items-stretch justify-center px-1 sm:px-4">
            {canPrevLightbox && (
              <button
                type="button"
                onClick={() => goLightbox(-1)}
                className="absolute left-0 top-1/2 z-10 flex min-h-[52px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-r-xl bg-white/12 text-white hover:bg-white/22 sm:left-2 sm:min-h-14 sm:min-w-12 sm:rounded-xl"
                aria-label="Vorheriges Bild"
              >
                <ChevronLeft className="h-8 w-8 sm:h-10 sm:w-10" />
              </button>
            )}
            {canNextLightbox && (
              <button
                type="button"
                onClick={() => goLightbox(1)}
                className="absolute right-0 top-1/2 z-10 flex min-h-[52px] min-w-[44px] -translate-y-1/2 items-center justify-center rounded-l-xl bg-white/12 text-white hover:bg-white/22 sm:right-2 sm:min-h-14 sm:min-w-12 sm:rounded-xl"
                aria-label="Nächstes Bild"
              >
                <ChevronRight className="h-8 w-8 sm:h-10 sm:w-10" />
              </button>
            )}
            <div className="flex min-h-0 w-full max-w-[min(100%,1200px)] flex-1 items-center justify-center py-2">
              <img
                src={publicUrlForPath(lightbox.storagePath)}
                alt=""
                className="max-h-[min(82dvh,100%)] max-w-full rounded-lg object-contain shadow-2xl"
              />
            </div>
          </div>

          <div className="mx-auto mt-1 w-full max-w-2xl shrink-0 px-3 pb-2 sm:mt-2 sm:px-4 sm:pb-3">
            <div className="rounded-xl bg-white/10 px-4 py-3 text-center text-sm text-white/95 backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
                {lightbox.authorDisplayName && (
                  <span className="font-semibold">{lightbox.authorDisplayName}</span>
                )}
                <span className="tabular-nums text-white/85">{formatWhen(lightbox.createdAt)}</span>
              </div>
              {isTeacher && (
                <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/70">
                  {statusLabel(lightbox.moderationStatus)}
                </div>
              )}
            </div>
            {isTeacher && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {lightbox.moderationStatus !== 'approved' && (
                  <button
                    type="button"
                    onClick={() => void setModerationStatus(lightbox, 'approved')}
                    className="inline-flex min-h-12 min-w-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Freigeben
                  </button>
                )}
                {lightbox.moderationStatus !== 'rejected' && (
                  <button
                    type="button"
                    onClick={() => void setModerationStatus(lightbox, 'rejected')}
                    className="inline-flex min-h-12 min-w-[44px] items-center gap-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
                  >
                    <XCircle className="h-4 w-4" />
                    Ablehnen
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void removeImage(lightbox)}
                  className="inline-flex min-h-12 min-w-[44px] items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white hover:bg-rose-700"
                >
                  <Trash2 className="h-4 w-4" />
                  Löschen
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
