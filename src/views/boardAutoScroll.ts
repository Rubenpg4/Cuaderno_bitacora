import { useEffect } from 'react';

export const AUTO_SCROLL_THRESHOLD = 150;
export const AUTO_SCROLL_MIN_SPEED = 8;
export const AUTO_SCROLL_MAX_SPEED = 24;

/**
 * Calcula la velocidad de auto-scroll según la proximidad del puntero al borde superior del viewport.
 * Devuelve 0 si clientY es igual o superior al umbral (threshold).
 * Devuelve una velocidad entre minSpeed y maxSpeed cuando clientY se encuentra en la zona de proximidad (< threshold).
 */
export function getAutoScrollSpeed(
  clientY: number,
  threshold: number = AUTO_SCROLL_THRESHOLD,
  minSpeed: number = AUTO_SCROLL_MIN_SPEED,
  maxSpeed: number = AUTO_SCROLL_MAX_SPEED,
): number {
  if (clientY >= threshold) return 0;
  const clampedY = Math.max(0, clientY);
  const ratio = (threshold - clampedY) / threshold;
  return Math.round(minSpeed + ratio * (maxSpeed - minSpeed));
}

export interface ScrollTarget {
  getTop: () => number;
  scrollBy: (deltaY: number) => void;
}

export function getScrollContainer(element?: HTMLElement | null): ScrollTarget {
  if (typeof window === 'undefined') {
    return { getTop: () => 0, scrollBy: () => {} };
  }

  const doc = typeof document !== 'undefined' ? document : null;
  let parent = element?.parentElement;
  while (parent && parent !== doc?.body && parent !== doc?.documentElement) {
    const { overflowY } = window.getComputedStyle(parent);
    if (
      (overflowY === 'auto' || overflowY === 'scroll') &&
      parent.scrollHeight > parent.clientHeight
    ) {
      const container = parent;
      return {
        getTop: () => container.scrollTop,
        scrollBy: (deltaY: number) => {
          if (typeof container.scrollBy === 'function') {
            container.scrollBy({ top: deltaY, behavior: 'auto' });
          } else {
            container.scrollTop += deltaY;
          }
        },
      };
    }
    parent = parent.parentElement;
  }

  return {
    getTop: () => window.scrollY || doc?.documentElement?.scrollTop || doc?.body?.scrollTop || 0,
    scrollBy: (deltaY: number) => {
      if (typeof window.scrollBy === 'function') {
        window.scrollBy({ top: deltaY, behavior: 'auto' });
      } else if (doc?.documentElement) {
        doc.documentElement.scrollTop += deltaY;
      }
    },
  };
}

export interface UseBoardAutoScrollOptions {
  enabled: boolean;
  element?: HTMLElement | null;
  threshold?: number;
}

export function useBoardAutoScroll({
  enabled,
  element,
  threshold = AUTO_SCROLL_THRESHOLD,
}: UseBoardAutoScrollOptions) {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let animId: number | null = null;
    let currentClientY: number | null = null;

    const target = getScrollContainer(element);

    const performScroll = () => {
      if (currentClientY !== null && currentClientY < threshold) {
        const currentScroll = target.getTop();
        if (currentScroll > 0) {
          const speed = getAutoScrollSpeed(currentClientY, threshold);
          target.scrollBy(-speed);
          animId = requestAnimationFrame(performScroll);
          return;
        }
      }
      animId = null;
    };

    const handleDragOver = (event: globalThis.DragEvent) => {
      currentClientY = event.clientY;
      const speed = getAutoScrollSpeed(currentClientY, threshold);
      const currentScroll = target.getTop();

      if (speed > 0 && currentScroll > 0) {
        if (!animId) {
          animId = requestAnimationFrame(performScroll);
        }
      } else if (animId && speed === 0) {
        cancelAnimationFrame(animId);
        animId = null;
      }
    };

    const stopAutoScroll = () => {
      if (animId) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      currentClientY = null;
    };

    window.addEventListener('dragover', handleDragOver, { passive: true });
    window.addEventListener('dragend', stopAutoScroll);
    window.addEventListener('drop', stopAutoScroll);

    return () => {
      stopAutoScroll();
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragend', stopAutoScroll);
      window.removeEventListener('drop', stopAutoScroll);
    };
  }, [enabled, element, threshold]);
}
