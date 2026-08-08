import { createPlexure, type PlexureInput, type PlexureInstance } from 'plexure';
import {
  type CSSProperties,
  createElement,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';

export type { PlexureInput, PlexureInstance, PlexureOptions } from 'plexure';

export interface PlexureProps extends PlexureInput {
  /** Class for the host div the field mounts into. Position it yourself (e.g. absolute inset-0). */
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders a host div and mounts a plexure field into it. Option changes apply live via
 * setOptions; the field is destroyed on unmount. A ref exposes the core handle.
 */
export const Plexure = forwardRef<PlexureInstance, PlexureProps>(
  ({ className, style, ...options }, ref) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const fieldRef = useRef<PlexureInstance | null>(null);
    // Read by the mount effect on creation, and pushed into setOptions on option changes.
    const optionsRef = useRef(options);
    optionsRef.current = options;

    // A stable delegating handle: the layout-effect phase runs before the mount effect
    // below creates the field, so exposing fieldRef.current directly would stay null.
    useImperativeHandle(
      ref,
      () => ({
        setOptions: (o: PlexureInput) => fieldRef.current?.setOptions(o),
        pause: () => fieldRef.current?.pause(),
        resume: () => fieldRef.current?.resume(),
        refresh: () => fieldRef.current?.refresh(),
        destroy: () => fieldRef.current?.destroy(),
        get isRunning() {
          return fieldRef.current?.isRunning ?? false;
        },
      }),
      [],
    );

    // Mount once; later option changes flow through setOptions in the effect below.
    useEffect(() => {
      if (!hostRef.current) return;
      const field = createPlexure(hostRef.current, optionsRef.current);
      fieldRef.current = field;
      return () => {
        fieldRef.current = null;
        field.destroy();
      };
    }, []);

    // Re-apply only when options actually change, not on every parent render. clipTo is
    // deped by identity separately because a Path2D does not JSON-serialise.
    const optionsKey = JSON.stringify(options, (_, v) =>
      typeof Path2D !== 'undefined' && v instanceof Path2D ? null : v,
    );
    // biome-ignore lint/correctness/useExhaustiveDependencies: optionsKey covers the options content
    useEffect(() => {
      fieldRef.current?.setOptions(optionsRef.current);
    }, [optionsKey, options.clipTo]);

    return createElement('div', {
      ref: hostRef,
      className,
      style,
      'data-plexure': '',
    });
  },
);

Plexure.displayName = 'Plexure';
