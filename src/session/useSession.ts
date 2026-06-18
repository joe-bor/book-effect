import { useCallback, useEffect, useState } from 'react';

import type { CompiledBook } from '../content/types';
import type { SessionController } from './SessionController';
import type { SessionError, SessionStatus } from './types';

export type UseSessionResult = {
  status: SessionStatus;
  error: SessionError | undefined;
  start(): Promise<void>;
  stop(): Promise<void>;
  recover(): void;
};

export function useSession(controller: SessionController, book: CompiledBook): UseSessionResult {
  const [status, setStatus] = useState<SessionStatus>(controller.status);
  const [error, setError] = useState<SessionError | undefined>(controller.error);

  useEffect(() => {
    const refresh = () => {
      setStatus(controller.status);
      setError(controller.error);
    };

    refresh();
    return controller.subscribe(refresh);
  }, [controller]);

  useEffect(() => {
    return () => {
      void controller.stop();
    };
  }, [controller]);

  const start = useCallback(() => controller.start(book), [book, controller]);
  const stop = useCallback(() => controller.stop(), [controller]);
  const recover = useCallback(() => {
    controller.recover();
    setStatus(controller.status);
    setError(controller.error);
  }, [controller]);

  return { status, error, start, stop, recover };
}
