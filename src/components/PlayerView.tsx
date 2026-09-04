import { useEffect, useRef, useState } from 'react';
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Dropdown,
  ProgressBar,
  Focusable,
} from '@decky/ui';
import {
  PlayerState,
  togglePause,
  stopPlayback,
  seekRelative,
  nextChapter,
  prevChapter,
  setChapter,
  setPlaybackSpeed,
} from '../api';
import { FaDownload } from 'react-icons/fa';
import { CoverImage } from './CoverImage';
import { TwoColumnButtonRow } from './TwoColumnButtonRow';
import { clampProgress, formatTime } from '../utils/time';

const SPEEDS = [0.75, 1, 1.1, 1.2, 1.25, 1.5, 1.75, 2];

export function PlayerView({ state, onStopped }: { state: PlayerState; onStopped: () => void }) {
  const [busy, setBusy] = useState(false);
  const [displayTime, setDisplayTime] = useState(state.currentTime);
  const timeAnchor = useRef({
    time: state.currentTime,
    receivedAt: Date.now(),
    playing: state.playing,
  });
  const playerHeader = useRef<HTMLDivElement>(null);

  useEffect(() => {
    timeAnchor.current = {
      time: state.currentTime,
      receivedAt: Date.now(),
      playing: state.playing,
    };
    setDisplayTime(state.currentTime);
  }, [state.currentTime, state.playing]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      const anchor = timeAnchor.current;
      const elapsed = anchor.playing ? (Date.now() - anchor.receivedAt) / 1000 : 0;
      setDisplayTime(Math.min(state.duration, anchor.time + elapsed * state.speed));
    }, 250);
    return () => clearInterval(interval);
  }, [state.duration, state.speed]);

  const np = state.nowPlaying;
  if (!np) return null;

  const progress = state.duration > 0 ? displayTime / state.duration : 0;
  const chapter = state.chapterIndex >= 0 ? state.chapters[state.chapterIndex] : null;
  const chapterEnd = chapter?.end || state.duration;
  const chapterDuration = chapter ? chapterEnd - chapter.start : 0;
  const chapterProgress =
    chapterDuration > 0 ? (displayTime - chapter!.start) / chapterDuration : 0;

  const wrap = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const speedIndex = Math.max(
    0,
    SPEEDS.findIndex((s) => Math.abs(s - state.speed) < 0.01),
  );
  const scrollPlayerHeaderIntoView = () =>
    playerHeader.current?.scrollTo({
      top: 0,
      behavior: 'smooth',
    });

  return (
    <PanelSection title="Now Playing">
      <PanelSectionRow>
        <Focusable
          ref={playerHeader}
          onFocus={scrollPlayerHeaderIntoView}
          style={{ display: 'flex', gap: '12px', alignItems: 'center' }}
        >
          <CoverImage itemId={np.itemId} size={64} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 'bold' }}>{np.title}</div>
            {np.author && <div>{np.author}</div>}
            {np.offline && <FaDownload aria-label="Downloaded" />}
          </div>
        </Focusable>
      </PanelSectionRow>
      {chapter && (
        <>
          <PanelSectionRow>
            <div>{state.chapterTitle}</div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ProgressBar nProgress={clampProgress(chapterProgress) * 100} />
          </PanelSectionRow>
          <PanelSectionRow>
            <div>
              {formatTime(displayTime - chapter.start)} / {formatTime(chapterDuration)}
            </div>
          </PanelSectionRow>
        </>
      )}
      <PanelSectionRow>
        <ProgressBar nProgress={clampProgress(progress) * 100} />
      </PanelSectionRow>
      <PanelSectionRow>
        <div>
          {formatTime(displayTime)} / {formatTime(state.duration)}
        </div>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={busy} onClick={wrap(() => togglePause())}>
          {state.playing ? 'Pause' : 'Play'}
        </ButtonItem>
      </PanelSectionRow>
      <TwoColumnButtonRow
        left={{
          layout: 'below',
          disabled: busy,
          onClick: wrap(() => seekRelative(-10)),
          children: '< 10s',
        }}
        right={{
          layout: 'below',
          disabled: busy,
          onClick: wrap(() => seekRelative(10)),
          children: '10s >',
        }}
      />
      {state.chapters && state.chapters.length > 0 && (
        <TwoColumnButtonRow
          left={{
            layout: 'below',
            disabled: busy,
            onClick: wrap(() => prevChapter()),
            children: '< Chapter',
          }}
          right={{
            layout: 'below',
            disabled: busy,
            onClick: wrap(() => nextChapter()),
            children: 'Chapter >',
          }}
        />
      )}
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
          {'Stop'}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}
