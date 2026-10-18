import {
  useEffect,
  useRef,
  useId,
  Children,
  isValidElement,
  cloneElement,
  useLayoutEffect,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { X, ArrowUpRight, Check, AlertCircle } from 'lucide-react';
export function Button({
  children,
  onClick,
  variant = '',
  type = 'button',
  disabled = false,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`button ${variant}`}
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}
export function AutoTextarea({
  className = '',
  value,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { value: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const resize = () => {
      element.style.height = 'auto';
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    const parent = element.parentElement;
    if (!parent) return;
    let width = parent.clientWidth;
    const observer = new ResizeObserver(() => {
      if (parent.clientWidth === width) return;
      width = parent.clientWidth;
      resize();
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, [value]);
  return (
    <textarea {...props} ref={ref} className={`auto-textarea ${className}`.trim()} value={value} />
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const id = useId();
  const required = Children.toArray(children).some(
    (child) => isValidElement<{ required?: boolean }>(child) && !!child.props.required,
  );
  return (
    <div className="field">
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {Children.map(children, (child) =>
        isValidElement(child) &&
        (['input', 'select', 'textarea'].includes(String(child.type)) ||
          child.type === AutoTextarea)
          ? cloneElement(child as ReactElement<Record<string, unknown>>, {
              id,
              'aria-label': label,
              'aria-describedby': hint ? `${id}-hint` : undefined,
            })
          : child,
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-mark">
        <ArrowUpRight size={25} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Notice({
  children,
  error = false,
  icon,
}: {
  children: ReactNode;
  error?: boolean;
  icon?: ReactNode;
}) {
  return (
    <div className={`notice ${error ? 'error' : ''}`} role={error ? 'alert' : undefined}>
      {icon ? icon : error ? <AlertCircle size={17} /> : <Check size={17} />}
      <div>{children}</div>
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
  floatingAction,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  floatingAction?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const el = ref.current;
    const focusable = () =>
      [
        ...(el?.querySelectorAll<HTMLElement>(
          'button,input,select,textarea,a[href],[tabindex="0"]',
        ) || []),
      ].filter((e) => !e.hasAttribute('disabled'));
    (el?.querySelector<HTMLElement>('[data-initial-focus]') || focusable()[0])?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      }
      if (e.key === 'Tab') {
        const fs = focusable();
        if (e.shiftKey && document.activeElement === fs[0]) {
          e.preventDefault();
          fs.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === fs.at(-1)) {
          e.preventDefault();
          fs[0]?.focus();
        }
      }
    }
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <div
        className={`modal ${wide ? 'wide' : ''} ${floatingAction ? 'has-floating-action' : ''}`}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button aria-label="Cerrar" className="icon-button" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {floatingAction}
      </div>
    </div>
  );
}
