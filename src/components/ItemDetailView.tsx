import { useEffect, useRef, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, ProgressBar } from "@decky/ui";
import type { ComponentProps, ComponentType } from "react";
import {
  getItemDetails,
  playItem,
  downloadItem,
  cancelDownload,
  deleteDownload,
  getDownloadStatus,
  getMpvStatus,
  installMpv,
  ItemDetails,
  DownloadStatus,
} from "../api";
import { CoverImage } from "./CoverImage";

type PreferredButtonItemProps = ComponentProps<typeof ButtonItem> & { preferredFocus?: boolean };
const PreferredButtonItem = ButtonItem as ComponentType<PreferredButtonItemProps>;

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = m.toString().padStart(h > 0 ? 2 : 1, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function ItemDetailView({
  itemId,
  onBack,
  onPlaying,
}: {
  itemId: string;
  onBack: () => void;
  onPlaying: () => void;
}) {
  const [details, setDetails] = useState<ItemDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadStatus>({ state: "none", progress: 0 });
  const [mpvAvailable, setMpvAvailable] = useState(true);
  const [installingMpv, setInstallingMpv] = useState(false);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const result = await getItemDetails(itemId);
      setDetails(result);
      if (result.success) {
        setDownload(result.downloadStatus ?? { state: "none", progress: 0 });
      } else {
        setError(result.error ?? "Failed to load item");
      }
      const mpv = await getMpvStatus();
      setMpvAvailable(mpv.available);
    })();
  }, [itemId]);

  // Poll download progress while a download is in flight.
  useEffect(() => {
    if (download.state !== "downloading") {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    pollRef.current = window.setInterval(async () => {
      const status = await getDownloadStatus(itemId);
      setDownload(status);
    }, 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [download.state, itemId]);

  const onPlay = async () => {
    setBusy(true);
    setError(null);
    const result = await playItem(itemId);
    setBusy(false);
    if (result.success) {
      onPlaying();
    } else {
      setError(result.error ?? "Failed to start playback");
    }
  };

  const onInstallMpv = async () => {
    setInstallingMpv(true);
    setError(null);
    const result = await installMpv();
    setInstallingMpv(false);
    if (result.success) {
      setMpvAvailable(true);
    } else {
      setError(result.error ?? "Failed to install mpv");
    }
  };

  const onDownload = async () => {
    setError(null);
    const result = await downloadItem(itemId);
    if (result.success) {
      setDownload({ state: "downloading", progress: 0 });
    } else {
      setError(result.error ?? "Failed to start download");
    }
  };

  const onCancelDownload = async () => {
    await cancelDownload(itemId);
    setDownload({ state: "none", progress: 0 });
  };

  const onDeleteDownload = async () => {
    await deleteDownload(itemId);
    setDownload({ state: "none", progress: 0 });
  };

  const hasProgress = (details?.currentTime ?? 0) > 1;

  return (
    <>
      <PanelSection>
        <PanelSectionRow>
          <div style={{ width: "100%", display: "flex", justifyContent: "center" }}>
            <CoverImage itemId={itemId} size={160} />
          </div>
        </PanelSectionRow>
      </PanelSection>
      <PanelSection title={details?.title ?? "Loading..."}>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onBack}>
          {"< Back"}
        </ButtonItem>
      </PanelSectionRow>
      {details?.author && (
        <PanelSectionRow>
          <div>{details.author}</div>
        </PanelSectionRow>
      )}
      {details?.duration && (
        <PanelSectionRow>
          <div>Length: {formatTime(details.duration)}</div>
        </PanelSectionRow>
      )}
      {error && (
        <PanelSectionRow>
          <div>{error}</div>
        </PanelSectionRow>
      )}
      {!mpvAvailable && (
        <>
          <PanelSectionRow>
            <div>mpv is required for playback and wasn't found on this system.</div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" disabled={installingMpv} onClick={onInstallMpv}>
              {installingMpv ? "Installing mpv..." : "Install mpv (via Flatpak)"}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
      <PanelSectionRow>
        <PreferredButtonItem preferredFocus layout="below" disabled={busy || !mpvAvailable} onClick={onPlay}>
          {busy ? "Starting..." : hasProgress ? `Resume at ${formatTime(details!.currentTime!)}` : "Play"}
        </PreferredButtonItem>
      </PanelSectionRow>
      {details?.chapters && details.chapters.length > 0 && (
        <PanelSectionRow>
          <div>{details.chapters.length} chapters</div>
        </PanelSectionRow>
      )}
      {download.state === "downloading" && (
        <>
          <PanelSectionRow>
            <ProgressBar nProgress={Math.min(100, Math.max(0, download.progress * 100))} />
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={onCancelDownload}>
              {`Cancel download (${Math.round(download.progress * 100)}%)`}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
      {download.state === "done" && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onDeleteDownload}>
            {"Remove downloaded copy"}
          </ButtonItem>
        </PanelSectionRow>
      )}
      {(download.state === "none" || download.state === "error") && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onDownload}>
            {"Download for offline playback"}
          </ButtonItem>
        </PanelSectionRow>
      )}
      {download.state === "error" && download.error && (
        <PanelSectionRow>
          <div>Download failed: {download.error}</div>
        </PanelSectionRow>
      )}
      </PanelSection>
    </>
  );
}
