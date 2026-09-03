import { callable } from "@decky/api";

export interface Library {
  id: string;
  name: string;
}

export interface LibraryItemSummary {
  id: string;
  title: string;
  author: string;
  duration: number;
  progress: number;
  isFinished: boolean;
  currentTime: number;
  coverUrl: string;
}

export interface Chapter {
  id: number | string;
  title: string;
  start: number;
  end: number;
}

export interface ItemDetails {
  success: boolean;
  error?: string;
  id?: string;
  title?: string;
  author?: string;
  duration?: number;
  currentTime?: number;
  coverUrl?: string;
  chapters?: Chapter[];
}

export interface NowPlaying {
  itemId: string;
  title: string;
  author: string;
  coverUrl: string;
}

export interface PlayerState {
  running: boolean;
  playing: boolean;
  currentTime: number;
  duration: number;
  chapterIndex: number;
  chapterTitle: string | null;
  chapters: Chapter[];
  speed: number;
  nowPlaying: NowPlaying | null;
}

export interface ConfigResult {
  configured: boolean;
  server_url: string;
  username: string;
}

export interface BasicResult {
  success: boolean;
  error?: string;
}

// ---- config / auth ----
export const getConfig = callable<[], ConfigResult>("get_config");
export const login = callable<
  [server_url: string, username: string, password: string],
  BasicResult & { username?: string }
>("login");
export const logout = callable<[], BasicResult>("logout");
export const checkConnection = callable<[], BasicResult & { username?: string }>(
  "check_connection"
);

// ---- library browsing ----
export const getLibraries = callable<
  [],
  BasicResult & { libraries: Library[] }
>("get_libraries");
export const getLibraryItems = callable<
  [library_id: string, search: string],
  BasicResult & { items: LibraryItemSummary[] }
>("get_library_items");
export const getItemDetails = callable<[item_id: string], ItemDetails>(
  "get_item_details"
);

// ---- playback ----
export const playItem = callable<[item_id: string], BasicResult>("play_item");
export const togglePause = callable<[], BasicResult>("toggle_pause");
export const stopPlayback = callable<[], BasicResult>("stop_playback");
export const seekRelative = callable<[seconds: number], BasicResult>(
  "seek_relative"
);
export const seekTo = callable<[seconds: number], BasicResult>("seek_to");
export const nextChapter = callable<[], BasicResult>("next_chapter");
export const prevChapter = callable<[], BasicResult>("prev_chapter");
export const setChapter = callable<[chapter_id: number | string], BasicResult>(
  "set_chapter"
);
export const setPlaybackSpeed = callable<[speed: number], BasicResult>(
  "set_playback_speed"
);
export const getPlayerState = callable<[], PlayerState>("get_player_state");
