import { useState } from "react";
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Dropdown,
  ProgressBar,
  Focusable,
} from "@decky/ui";
import {
  PlayerState,
  togglePause,
  stopPlayback,
  seekRelative,
  nextChapter,
  prevChapter,
  setChapter,
  setPlaybackSpeed,
} from "../api";

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = m.toString().padStart(h > 0 ? 2 : 1, "0");
  const ss = s.toString().padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function PlayerView({
  state,
  onStopped,
}: {
  state: PlayerState;
  onStopped: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const np = state.nowPlaying;
  if (!np) return null;

  const progress = state.duration > 0 ? state.currentTime / state.duration : 0;

  const wrap = (fn: () => Promise<any>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const speedIndex = Math.max(0, SPEEDS.findIndex((s) => Math.abs(s - state.speed) < 0.01));

  return (
    <PanelSection title="Now Playing">
      <PanelSectionRow>
        <div style={{ fontWeight: "bold" }}>{np.title}</div>
      </PanelSectionRow>
      {np.author && (
        <PanelSectionRow>
          <div>{np.author}</div>
        </PanelSectionRow>
      )}
      {state.chapterTitle && (
        <PanelSectionRow>
          <div>{state.chapterTitle}</div>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ProgressBar nProgress={Math.min(1, Math.max(0, progress))} />
      </PanelSectionRow>
      <PanelSectionRow>
        <div>
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <Focusable style={{ display: "flex", gap: "8px" }}>
          <ButtonItem layout="below" disabled={busy} onClick={wrap(() => seekRelative(-30))}>
            {"⏪ 30s"}
          </ButtonItem>
          <ButtonItem layout="below" disabled={busy} onClick={wrap(() => togglePause())}>
            {state.playing ? "Pause" : "Play"}
          </ButtonItem>
          <ButtonItem layout="below" disabled={busy} onClick={wrap(() => seekRelative(30))}>
            {"30s ⏩"}
          </ButtonItem>
        </Focusable>
      </PanelSectionRow>
      <PanelSectionRow>
        <Focusable style={{ display: "flex", gap: "8px" }}>
          <ButtonItem layout="below" disabled={busy} onClick={wrap(() => prevChapter())}>
            {"⏮ Chapter"}
          </ButtonItem>
          <ButtonItem layout="below" disabled={busy} onClick={wrap(() => nextChapter())}>
            {"Chapter ⏭"}
          </ButtonItem>
        </Focusable>
      </PanelSectionRow>
      {state.chapters && state.chapters.length > 0 && (
        <PanelSectionRow>
          <Dropdown
            rgOptions={state.chapters.map((c) => ({ data: c.id, label: c.title }))}
            selectedOption={
              state.chapterIndex >= 0 ? state.chapters[state.chapterIndex]?.id : undefined
            }
            onChange={(opt) => setChapter(opt.data)}
            strDefaultLabel="Jump to chapter..."
          />
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <Dropdown
          rgOptions={SPEEDS.map((s) => ({ data: s, label: `${s}x` }))}
          selectedOption={SPEEDS[speedIndex] ?? 1}
          onChange={(opt) => setPlaybackSpeed(opt.data)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy}
          onClick={wrap(async () => {
            await stopPlayback();
            onStopped();
          })}
        >
          {"Stop"}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}
