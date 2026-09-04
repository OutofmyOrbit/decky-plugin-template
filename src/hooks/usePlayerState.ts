import { useEffect, useState } from 'react';
import { getPlayerState, PlayerState } from '../api';

export const EMPTY_PLAYER_STATE: PlayerState = {
  running: false,
  playing: false,
  currentTime: 0,
  duration: 0,
  chapterIndex: -1,
  chapterTitle: null,
  chapters: [],
  speed: 1,
  nowPlaying: null,
};

export function usePlayerState(): [PlayerState, () => void] {
  const [playerState, setPlayerState] = useState<PlayerState>(EMPTY_PLAYER_STATE);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const state = await getPlayerState();
        if (mounted) setPlayerState(state);
      } catch {
        // Transient polling failures should not interrupt the player view.
      }
    };

    const interval = window.setInterval(poll, 500);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  return [playerState, () => setPlayerState(EMPTY_PLAYER_STATE)];
}
