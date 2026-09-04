import { useEffect, useState } from 'react';
import {
  PanelSection,
  PanelSectionRow,
  ButtonItem,
  TextField,
  ToggleField,
  Field,
} from '@decky/ui';
import { getConfig, login } from '../api';

export function LoginView({ onLoggedIn }: { onLoggedIn: (username: string) => void }) {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      if (cfg.server_url) setServerUrl(cfg.server_url);
      if (cfg.username) setUsername(cfg.username);
    })();
  }, []);

  const canSubmit = serverUrl.trim().length > 0 && username.trim().length > 0 && !busy;

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await login(serverUrl, username, password, remember);
      if (result.success) {
        onLoggedIn(result.username ?? username);
      } else {
        setError(result.error ?? 'Login failed');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <PanelSection title="Connect to Audiobookshelf">
      <PanelSectionRow>
        <TextField
          label="Server URL"
          description="https://abs.example.com"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <TextField
          label="Password"
          bIsPassword
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField
          label="Remember me"
          description="Save credentials so this device logs back in automatically"
          checked={remember}
          onChange={setRemember}
        />
      </PanelSectionRow>
      {error && (
        <PanelSectionRow>
          <Field label="Error" focusable={false}>
            {error}
          </Field>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <ButtonItem layout="below" disabled={!canSubmit} onClick={onSubmit}>
          {busy ? 'Connecting...' : 'Log In'}
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}
