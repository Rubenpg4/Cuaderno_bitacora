import { describe, expect, it } from 'vitest';
import {
  AUTO_SCROLL_MAX_SPEED,
  AUTO_SCROLL_MIN_SPEED,
  AUTO_SCROLL_THRESHOLD,
  getAutoScrollSpeed,
  getScrollContainer,
} from '../src/views/boardAutoScroll';

describe('boardAutoScroll', () => {
  describe('getAutoScrollSpeed', () => {
    it('devuelve 0 cuando el cursor está fuera de la zona superior (en o por debajo del umbral)', () => {
      expect(getAutoScrollSpeed(AUTO_SCROLL_THRESHOLD)).toBe(0);
      expect(getAutoScrollSpeed(AUTO_SCROLL_THRESHOLD + 1)).toBe(0);
      expect(getAutoScrollSpeed(200)).toBe(0);
      expect(getAutoScrollSpeed(500)).toBe(0);
    });

    it('devuelve velocidad proporcional creciente al acercarse al borde superior', () => {
      // Justo debajo del umbral devuelve la velocidad mínima
      const nearThreshold = getAutoScrollSpeed(AUTO_SCROLL_THRESHOLD - 1);
      expect(nearThreshold).toBeGreaterThanOrEqual(AUTO_SCROLL_MIN_SPEED);

      // A mitad de camino
      const halfway = getAutoScrollSpeed(Math.round(AUTO_SCROLL_THRESHOLD / 2));
      expect(halfway).toBeGreaterThan(nearThreshold);

      // En el borde superior (0) alcanza la velocidad máxima
      const atTop = getAutoScrollSpeed(0);
      expect(atTop).toBe(AUTO_SCROLL_MAX_SPEED);
    });

    it('mantiene la velocidad máxima si el cursor sobrepasa el borde superior de la ventana (clientY negativo)', () => {
      expect(getAutoScrollSpeed(-10)).toBe(AUTO_SCROLL_MAX_SPEED);
      expect(getAutoScrollSpeed(-100)).toBe(AUTO_SCROLL_MAX_SPEED);
    });

    it('admite umbrales y rangos de velocidad personalizados', () => {
      const customThreshold = 100;
      const minSpeed = 5;
      const maxSpeed = 30;

      expect(getAutoScrollSpeed(100, customThreshold, minSpeed, maxSpeed)).toBe(0);
      expect(getAutoScrollSpeed(150, customThreshold, minSpeed, maxSpeed)).toBe(0);
      expect(getAutoScrollSpeed(0, customThreshold, minSpeed, maxSpeed)).toBe(30);
      expect(getAutoScrollSpeed(50, customThreshold, minSpeed, maxSpeed)).toBe(18);
    });

    it('no genera desplazamiento al mover el ratón lateralmente en zonas inferiores', () => {
      // Movimientos horizontales entre columnas (a distintas posiciones Y por debajo del umbral)
      const columnPositions = [
        { clientX: 100, clientY: 300 },
        { clientX: 350, clientY: 300 },
        { clientX: 600, clientY: 320 },
        { clientX: 850, clientY: 280 },
      ];

      for (const pos of columnPositions) {
        expect(getAutoScrollSpeed(pos.clientY)).toBe(0);
      }
    });
  });

  describe('getScrollContainer', () => {
    it('devuelve el objeto de scroll predeterminado vinculado a la ventana', () => {
      const target = getScrollContainer(null);
      expect(typeof target.getTop).toBe('function');
      expect(typeof target.scrollBy).toBe('function');
    });

    it('detecta un contenedor ancestro con scroll si está configurado', () => {
      const parent = {
        scrollHeight: 1000,
        clientHeight: 500,
        scrollTop: 120,
        scrollBy(this: { scrollTop: number }, opts: { top: number }) {
          this.scrollTop += opts.top;
        },
        parentElement: null,
      } as unknown as HTMLElement;

      const child = {
        parentElement: parent,
      } as unknown as HTMLElement;

      const originalWindow = globalThis.window;
      (globalThis as unknown as { window: unknown }).window = {
        getComputedStyle: () => ({ overflowY: 'auto' }),
      };

      try {
        const target = getScrollContainer(child);
        expect(target.getTop()).toBe(120);

        target.scrollBy(-20);
        expect(parent.scrollTop).toBe(100);
      } finally {
        (globalThis as unknown as { window: unknown }).window = originalWindow;
      }
    });
  });
});
