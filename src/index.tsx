import { useEffect, useState } from "react";
import { staticClasses, PanelSection, PanelSectionRow, ButtonItem } from "@decky/ui";
import { definePlugin } from "@decky/api";
import { FaHeadphones } from "react-icons/fa";

import { getConfig, getPlayerState, logout, PlayerState } from "./api";
import { LoginView } from "./components/LoginView";
import { LibraryView } from "./components/LibraryView";
import { ItemDetailView } from "./components/ItemDetailView";
import { PlayerView } from "./components/PlayerView";

type Screen = "loading" | "login" | "libraries" | "item";

const EMPTY_PLAYER_STATE: PlayerState = {
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

function Content() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState>(EMPTY_PLAYER_STATE);

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      setScreen(cfg.configured ? "libraries" : "login");
    })();
  }, []);

  // Poll playback state so the mini-player (and any external QAM controls)
  // stay in sync while this panel is open.
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const state = await getPlayerState();
        setPlayerState(state);
      } catch {
        // ignore transient polling errors
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {playerState.nowPlaying && (
        <PlayerView
          state={playerState}
          onStopped={() => setPlayerState(EMPTY_PLAYER_STATE)}
        />
      )}

      {screen === "loading" && (
        <PanelSection>
          <PanelSectionRow>
            <div>Loading...</div>
          </PanelSectionRow>
        </PanelSection>
      )}

      {screen === "login" && (
        <LoginView onLoggedIn={() => setScreen("libraries")} />
      )}

      {screen === "libraries" && (
        <LibraryView
          onSelectItem={(itemId) => {
            setSelectedItemId(itemId);
            setScreen("item");
          }}
        />
      )}

      {screen === "item" && selectedItemId && (
        <ItemDetailView
          itemId={selectedItemId}
          onBack={() => setScreen("libraries")}
          onPlaying={async () => {
            setScreen("libraries");
          }}
        />
      )}

      {screen !== "login" && screen !== "loading" && (
        <PanelSection title="Account">
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={async () => {
                await logout();
                setPlayerState(EMPTY_PLAYER_STATE);
                setScreen("login");
              }}
            >
              {"Log Out"}
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      )}
    </>
  );
}

export default definePlugin(() => {
  return {
    name: "Audiobookshelf",
    titleView: <div className={staticClasses.Title}>Audiobookshelf</div>,
    content: <Content />,
    icon: <FaHeadphones />,
    onDismount() {},
  };
});
