import { useEffect, useRef } from "react";

/**
 * 3D touches for the workspace, built from CSS transforms (no WebGL): light,
 * crisp at any zoom, and allowed by the editor's Content-Security-Policy.
 * Everything holds still for people who ask for reduced motion.
 */

const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Follow the pointer across the window and write it to CSS variables on the
 * element (--px and --py, from -1 to 1), once per frame and without React renders.
 */
export function usePointerVars<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || calm()) return;
    let frame = 0;
    let x = 0;
    let y = 0;
    const onMove = (e: PointerEvent) => {
      x = (e.clientX / innerWidth) * 2 - 1;
      y = (e.clientY / innerHeight) * 2 - 1;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          el.style.setProperty("--px", x.toFixed(3));
          el.style.setProperty("--py", y.toFixed(3));
        });
    };
    addEventListener("pointermove", onMove, { passive: true });
    return () => {
      removeEventListener("pointermove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/**
 * Tilt cards inside a container toward the pointer, with a soft glare.
 * Cards opt in with the class `tilt`; one listener serves them all.
 */
export function useTiltCards<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || calm() || !matchMedia("(hover: hover)").matches) return;
    let active: HTMLElement | null = null;
    let frame = 0;
    let last: PointerEvent | null = null;
    const reset = (el: HTMLElement) => {
      el.style.setProperty("--rx", "0deg");
      el.style.setProperty("--ry", "0deg");
      el.classList.remove("tilting");
    };
    const paint = () => {
      frame = 0;
      if (!active || !last) return;
      const r = active.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (last.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (last.clientY - r.top) / r.height));
      active.style.setProperty("--rx", `${((0.5 - y) * 9).toFixed(2)}deg`);
      active.style.setProperty("--ry", `${((x - 0.5) * 11).toFixed(2)}deg`);
      active.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
      active.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
    };
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element).closest<HTMLElement>(".tilt");
      if (card !== active) {
        if (active) reset(active);
        active = card && root.contains(card) ? card : null;
        active?.classList.add("tilting");
      }
      last = e;
      if (active && !frame) frame = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      if (active) reset(active);
      active = null;
    };
    root.addEventListener("pointermove", onMove, { passive: true });
    root.addEventListener("pointerleave", onLeave);
    return () => {
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

/**
 * The sign-in scene: a web page pulled apart into its layers, floating in
 * depth, with you and Claude each working on one. It turns toward the pointer.
 */
export function LayerScene() {
  const ref = usePointerVars<HTMLDivElement>();
  return (
    <div className="scene" ref={ref} aria-hidden="true">
      <div className="scene-float">
        <div className="scene-rig">
          <div className="floor" />
          <div className="ly ly-page" style={{ ["--z" as string]: "0px", ["--i" as string]: 0 }} />
          <div className="ly ly-nav" style={{ ["--z" as string]: "26px", ["--i" as string]: 1 }}>
            <i className="dot" />
            <i className="bar w20" />
            <span className="sp" />
            <i className="bar w10" />
            <i className="bar w10" />
            <i className="pill" />
          </div>
          <div className="ly ly-hero" style={{ ["--z" as string]: "58px", ["--i" as string]: 2 }}>
            <i className="bar tag" />
            <i className="bar h1" />
            <i className="bar h1 short" />
            <i className="bar p" />
            <div className="row">
              <i className="pill solid" />
              <i className="pill" />
            </div>
            <span className="cursor you">
              <svg viewBox="0 0 12 14" width="12" height="14">
                <path d="M1 1l9.5 6.2-4.3.9-2 4.4z" />
              </svg>
              <b>You</b>
            </span>
          </div>
          <div className="ly ly-img" style={{ ["--z" as string]: "40px", ["--i" as string]: 3 }} />
          <div className="ly ly-cards" style={{ ["--z" as string]: "86px", ["--i" as string]: 4 }}>
            <div className="card" />
            <div className="card agent">
              <span className="cursor claude">
                <svg viewBox="0 0 12 14" width="12" height="14">
                  <path d="M1 1l9.5 6.2-4.3.9-2 4.4z" />
                </svg>
                <b>Claude</b>
              </span>
            </div>
            <div className="card" />
          </div>
          <div className="ly ly-foot" style={{ ["--z" as string]: "16px", ["--i" as string]: 5 }}>
            <i className="bar w20" />
            <span className="sp" />
            <i className="bar w10" />
            <i className="bar w10" />
          </div>
        </div>
      </div>
    </div>
  );
}
