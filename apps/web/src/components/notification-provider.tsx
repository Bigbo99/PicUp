'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, X } from 'lucide-react';

type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading';
type ConfirmTone = 'default' | 'danger';

type NotifyInput = {
  type?: NotificationType;
  title: string;
  message?: string;
  duration?: number;
};

type ToastRecord = Required<Pick<NotifyInput, 'type' | 'title'>> & {
  id: string;
  message?: string;
  duration: number;
};

type ConfirmInput = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
};

type ConfirmRecord = Required<Pick<ConfirmInput, 'title' | 'confirmText' | 'cancelText' | 'tone'>> & {
  message?: string;
  resolve: (ok: boolean) => void;
};

type NotificationContextValue = {
  notify: (input: NotifyInput) => string;
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
  dismiss: (id: string) => void;
  confirm: (input: ConfirmInput) => Promise<boolean>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

const typeStyles: Record<NotificationType, {
  icon: ReactNode;
  border: string;
  iconBox: string;
  title: string;
}> = {
  success: {
    icon: <CheckCircle2 size={20} aria-hidden />,
    border: 'border-teal-200',
    iconBox: 'bg-teal-50 text-teal-700',
    title: 'text-teal-900'
  },
  error: {
    icon: <XCircle size={20} aria-hidden />,
    border: 'border-red-200',
    iconBox: 'bg-red-50 text-red-700',
    title: 'text-red-900'
  },
  warning: {
    icon: <AlertTriangle size={20} aria-hidden />,
    border: 'border-amber-200',
    iconBox: 'bg-amber-50 text-amber-700',
    title: 'text-amber-900'
  },
  info: {
    icon: <Info size={20} aria-hidden />,
    border: 'border-blue-200',
    iconBox: 'bg-blue-50 text-blue-700',
    title: 'text-blue-900'
  },
  loading: {
    icon: <Loader2 className="animate-spin" size={20} aria-hidden />,
    border: 'border-slate-200',
    iconBox: 'bg-slate-100 text-slate-700',
    title: 'text-slate-900'
  }
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmRecord | null>(null);
  const idRef = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((input: NotifyInput) => {
    const id = `notice-${Date.now()}-${idRef.current++}`;
    const toast: ToastRecord = {
      id,
      type: input.type ?? 'info',
      title: input.title,
      message: input.message,
      duration: input.duration ?? (input.type === 'loading' ? 0 : 4200)
    };

    setToasts((items) => [toast, ...items].slice(0, 4));

    if (toast.duration > 0) {
      window.setTimeout(() => dismiss(id), toast.duration);
    }

    return id;
  }, [dismiss]);

  const confirm = useCallback((input: ConfirmInput) => new Promise<boolean>((resolve) => {
    setConfirmState({
      title: input.title,
      message: input.message,
      confirmText: input.confirmText ?? '确认',
      cancelText: input.cancelText ?? '取消',
      tone: input.tone ?? 'default',
      resolve
    });
  }), []);

  const settleConfirm = useCallback((ok: boolean) => {
    setConfirmState((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!confirmState) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') settleConfirm(false);
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [confirmState, settleConfirm]);

  const value = useMemo<NotificationContextValue>(() => ({
    notify,
    success: (title, message) => notify({ type: 'success', title, message }),
    error: (title, message) => notify({ type: 'error', title, message }),
    warning: (title, message) => notify({ type: 'warning', title, message }),
    info: (title, message) => notify({ type: 'info', title, message }),
    dismiss,
    confirm
  }), [confirm, dismiss, notify]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 top-3 z-[90] grid gap-2 sm:left-auto sm:right-4 sm:top-4 sm:w-[390px]" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => {
          const styles = typeStyles[toast.type];
          return (
            <section
              key={toast.id}
              className={`pointer-events-auto flex gap-3 rounded-lg border ${styles.border} bg-white/95 p-3 shadow-[0_18px_50px_rgba(15,23,42,0.16)] backdrop-blur`}
              role={toast.type === 'error' ? 'alert' : 'status'}
            >
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${styles.iconBox}`}>
                {styles.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-bold ${styles.title}`}>{toast.title}</p>
                {toast.message && <p className="mt-1 text-sm leading-5 text-muted">{toast.message}</p>}
              </div>
              <button
                type="button"
                className="inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors hover:bg-slate-100 hover:text-ink"
                onClick={() => dismiss(toast.id)}
                aria-label="关闭通知"
                title="关闭"
              >
                <X size={18} aria-hidden />
              </button>
            </section>
          );
        })}
      </div>

      {confirmState && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/45 p-3 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="global-confirm-title">
          <button className="absolute inset-0 h-full w-full cursor-default" type="button" onClick={() => settleConfirm(false)} aria-label="关闭确认窗口" />
          <section className="relative w-full max-w-md rounded-lg border border-line bg-white p-5 shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
            <div className="flex gap-3">
              <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${confirmState.tone === 'danger' ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
                {confirmState.tone === 'danger' ? <AlertTriangle size={23} aria-hidden /> : <Info size={23} aria-hidden />}
              </div>
              <div className="min-w-0">
                <h2 id="global-confirm-title" className="text-lg font-bold leading-6 text-ink">{confirmState.title}</h2>
                {confirmState.message && <p className="mt-2 text-sm leading-6 text-muted">{confirmState.message}</p>}
              </div>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="min-h-11 cursor-pointer rounded-lg border border-line bg-white px-4 text-sm font-bold text-ink transition-colors hover:border-teal-600 hover:text-teal-700"
                onClick={() => settleConfirm(false)}
              >
                {confirmState.cancelText}
              </button>
              <button
                type="button"
                className={`min-h-11 cursor-pointer rounded-lg px-4 text-sm font-bold text-white transition-colors ${
                  confirmState.tone === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
                }`}
                onClick={() => settleConfirm(true)}
              >
                {confirmState.confirmText}
              </button>
            </div>
          </section>
        </div>
      )}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used inside NotificationProvider');
  }
  return context;
}
