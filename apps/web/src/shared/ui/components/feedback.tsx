import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type FeedbackStatus = "info" | "success" | "warning" | "error";

export interface AlertProps {
  status?: FeedbackStatus;
  title?: string;
  children: ReactNode;
  closable?: boolean;
  onClose?: () => void;
  className?: string;
}

export function Alert({
  status = "info",
  title,
  children,
  closable = false,
  onClose,
  className = "",
}: AlertProps) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  const close = () => {
    setVisible(false);
    onClose?.();
  };
  return (
    <div className={`af-alert af-alert--${status} ${className}`.trim()} role={status === "error" ? "alert" : "status"}>
      <span className="af-alert__icon" aria-hidden="true">{status === "success" ? "✓" : status === "warning" ? "!" : status === "error" ? "×" : "i"}</span>
      <div className="af-alert__content">
        {title && <strong className="af-alert__title">{title}</strong>}
        <div>{children}</div>
      </div>
      {closable && <button type="button" className="af-alert__close" aria-label="Dismiss message" onClick={close}>×</button>}
    </div>
  );
}

export function Empty({
  title = "No data",
  description,
  action,
  icon,
  className = "",
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`af-empty ${className}`.trim()} role="status">
      <div className="af-empty__icon" aria-hidden="true">{icon ?? "◇"}</div>
      <strong className="af-empty__title">{title}</strong>
      {description && <div className="af-empty__description">{description}</div>}
      {action && <div className="af-empty__action">{action}</div>}
    </div>
  );
}

export function Skeleton({
  width = "100%",
  height = 16,
  circle = false,
  lines = 1,
  className = "",
}: {
  width?: number | string;
  height?: number | string;
  circle?: boolean;
  lines?: number;
  className?: string;
}) {
  return (
    <span className={`af-skeleton-group ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: Math.max(1, Math.floor(lines)) }, (_, index) => (
        <span
          key={index}
          className={`af-skeleton ${circle ? "af-skeleton--circle" : ""}`}
          style={{
            width: typeof width === "number" ? `${width}px` : width,
            height: typeof height === "number" ? `${height}px` : height,
          }}
        />
      ))}
    </span>
  );
}

export function Loading({
  label = "Loading",
  size = "medium",
  overlay = false,
  className = "",
}: {
  label?: string;
  size?: "small" | "medium" | "large";
  overlay?: boolean;
  className?: string;
}) {
  return (
    <div className={`af-loading ${overlay ? "af-loading--overlay" : ""} ${className}`.trim()} role="status" aria-live="polite">
      <span className={`af-loading__spinner af-loading__spinner--${size}`} aria-hidden="true" />
      <span className="af-loading__label">{label}</span>
    </div>
  );
}

export interface NotificationInput {
  status?: FeedbackStatus;
  title?: string;
  message: ReactNode;
  duration?: number;
}

interface NotificationRecord extends NotificationInput {
  id: number;
}

interface NotificationContextValue {
  notify: (notification: NotificationInput) => number;
  dismiss: (id: number) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export function NotificationProvider({
  children,
  placement = "top-right",
  maxVisible = 5,
}: {
  children: ReactNode;
  placement?: "top-right" | "top-left" | "bottom-right" | "bottom-left";
  maxVisible?: number;
}) {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const notify = useCallback((notification: NotificationInput) => {
    const id = nextId.current++;
    const duration = notification.duration ?? 4500;
    setItems((current) => [...current, { ...notification, id }].slice(-Math.max(1, maxVisible)));
    if (duration > 0) {
      const timer = setTimeout(() => {
        timers.current.delete(id);
        setItems((current) => current.filter((item) => item.id !== id));
      }, duration);
      timers.current.set(id, timer);
    }
    return id;
  }, [maxVisible]);

  useEffect(() => () => {
    timers.current.forEach((timer) => clearTimeout(timer));
    timers.current.clear();
  }, []);

  return (
    <NotificationContext.Provider value={{ notify, dismiss }}>
      {children}
      <div className={`af-notification-viewport af-notification-viewport--${placement}`} aria-label="Notifications">
        {items.map((item) => (
          <div key={item.id} className={`af-notification af-notification--${item.status ?? "info"}`} role={item.status === "error" ? "alert" : "status"}>
            <span className="af-notification__icon" aria-hidden="true">{item.status === "success" ? "✓" : item.status === "warning" ? "!" : item.status === "error" ? "×" : "i"}</span>
            <div className="af-notification__content">
              {item.title && <strong>{item.title}</strong>}
              <div>{item.message}</div>
            </div>
            <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}>×</button>
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error("useNotification must be used within NotificationProvider");
  }
  return context;
}
