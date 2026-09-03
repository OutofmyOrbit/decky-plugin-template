import { useEffect, useState } from "react";
import { PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { getItemDetails, playItem, ItemDetails } from "../api";

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

  useEffect(() => {
    (async () => {
      const result = await getItemDetails(itemId);
      setDetails(result);
      if (!result.success) {
        setError(result.error ?? "Failed to load item");
      }
    })();
  }, [itemId]);

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

  const hasProgress = (details?.currentTime ?? 0) > 1;

  return (
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
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={onPlay}>
          {busy ? "Starting..." : hasProgress ? `Resume at ${formatTime(details!.currentTime!)}` : "Play"}
        </ButtonItem>
      </PanelSectionRow>
      {details?.chapters && details.chapters.length > 0 && (
        <PanelSectionRow>
          <div>{details.chapters.length} chapters</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}
