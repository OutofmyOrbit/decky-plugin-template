import { useEffect, useRef, useState } from 'react';
import {
  staticClasses,
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  Focusable,
  GamepadButton,
  NavEntryPositionPreferences,
} from '@decky/ui';
import { definePlugin } from '@decky/api';
import {
  MemoryRouter,
  Redirect,
  Route,
  Switch,
  useHistory,
  useLocation,
  useParams,
} from 'react-router';
import { FaHeadphones } from 'react-icons/fa';

import { getConfig, logout } from './api';
import type { PlayerState } from './api';
import { LoginView } from './components/LoginView';
import { LibraryView } from './components/LibraryView';
import { ItemDetailView } from './components/ItemDetailView';
import { PlayerView } from './components/PlayerView';
import { usePlayerState } from './hooks/usePlayerState';

function Content() {
  const contentTopRef = useRef<HTMLDivElement>(null);
  const [initialPath, setInitialPath] = useState<string | null>(null);
  const [playerState, clearPlayerState] = usePlayerState();

  const scrollToTopOnUp = (event: CustomEvent<{ button: number; is_repeat?: boolean }>) => {
    if (event.detail.button === GamepadButton.DIR_UP && event.detail.is_repeat) {
      contentTopRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
    }
  };

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      setInitialPath(cfg.configured ? '/libraries' : '/login');
    })();
  }, []);

  if (!initialPath) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div>Loading...</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <MemoryRouter initialEntries={[initialPath]}>
      <RoutedContent
        contentTopRef={contentTopRef}
        onGamepadDirection={scrollToTopOnUp}
        playerState={playerState}
        clearPlayerState={clearPlayerState}
      />
    </MemoryRouter>
  );
}

function RoutedContent({
  contentTopRef,
  onGamepadDirection,
  playerState,
  clearPlayerState,
}: {
  contentTopRef: React.RefObject<HTMLDivElement | null>;
  onGamepadDirection: (event: CustomEvent<{ button: number; is_repeat?: boolean }>) => void;
  playerState: PlayerState;
  clearPlayerState: () => void;
}) {
  const history = useHistory();
  const location = useLocation();
  const isItemRoute = location.pathname.startsWith('/items/');
  const isLoginRoute = location.pathname === '/login';

  const onLogout = async () => {
    await logout();
    clearPlayerState();
    history.replace('/login');
  };

  return (
    <Focusable
      onGamepadDirection={onGamepadDirection}
      navEntryPreferPosition={isItemRoute ? NavEntryPositionPreferences.PREFERRED_CHILD : undefined}
      style={{ display: 'contents' }}
    >
      <div ref={contentTopRef}>
        {playerState.nowPlaying && <PlayerView state={playerState} onStopped={clearPlayerState} />}
        <Switch>
          <Route exact path="/login">
            <LoginView onLoggedIn={() => history.replace('/libraries')} />
          </Route>
          <Route exact path="/libraries">
            <LibraryView onSelectItem={(itemId) => history.push(`/items/${itemId}`)} />
          </Route>
          <Route path="/items/:itemId">
            <ItemDetailRoute onPlaying={() => history.replace('/libraries')} />
          </Route>
          <Redirect to="/libraries" />
        </Switch>
        {!isLoginRoute && (
          <PanelSection title="Account">
            <PanelSectionRow>
              <ButtonItem layout="below" onClick={onLogout}>
                {'Log Out'}
              </ButtonItem>
            </PanelSectionRow>
          </PanelSection>
        )}
      </div>
    </Focusable>
  );
}

function ItemDetailRoute({ onPlaying }: { onPlaying: () => void }) {
  const history = useHistory();
  const itemId = useParams<{ itemId: string }>().itemId;
  return (
    <ItemDetailView
      itemId={itemId}
      onBack={() => history.replace('/libraries')}
      onPlaying={onPlaying}
    />
  );
}

export default definePlugin(() => {
  return {
    name: 'Audiobookshelf',
    titleView: <div className={staticClasses.Title}>Audiobookshelf</div>,
    content: <Content />,
    icon: <FaHeadphones />,
    onDismount() {},
  };
});
