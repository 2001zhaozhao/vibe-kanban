import { useEffect, useRef } from 'react';
import { useUserSystem } from '@/components/ConfigProvider';
import { oauthApi } from '@/lib/api';
import { tokenManager } from '@/lib/auth/tokenManager';

/**
 * Auto-login hook for single-user mode.
 * When the remote server is in single-user mode and the user is not logged in,
 * this hook automatically performs the login and refreshes the system state.
 */
export function useSingleUserAutoLogin() {
  const { loginStatus, singleUserMode, reloadSystem } = useUserSystem();
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;
    if (!singleUserMode) return;
    if (loginStatus?.status === 'loggedin') return;

    attemptedRef.current = true;

    oauthApi
      .singleUserLogin()
      .then(() => reloadSystem())
      .then(() => tokenManager.triggerRefresh())
      .catch((err) => console.error('Single-user auto-login failed:', err));
  }, [loginStatus, singleUserMode, reloadSystem]);
}
