"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  polarSpeed,
  angleDiff,
  optimumUpwind,
  clamp,
} from "@/lib/polar";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

const OPT = optimumUpwind();
const OPT_TWA = OPT.twa;
const OPT_VMG = OPT.vmg;

const PX_PER_KN = 9.2; // knots -> pixels/second
const TURN_RATE = 96; // player turn rate, deg/sec
const GHOST_TURN = 170; // ghost easing rate, deg/sec
const MARK_TOP = 46; // mark distance from top, px
const START_BOTTOM = 46; // start line distance from bottom, px
const EDGE = 22; // keep boats this far inside the edges
const FINISH_RADIUS = 15; // px
const SAFETY_TIMEOUT = 60; // seconds
const TRAIL_MAX = 64;
const BL = 16; // pixels per boat length

const COLORS = {
  abyss: "#05080f",
  navy: "#0a1424",
  card: "rgba(9,20,33,0.74)",
  hair: "rgba(70,227,234,0.22)",
  cyan: "#46e3ea",
  cyan2: "#1fb6c8",
  amber: "#ffba49",
  green: "#7af0a8",
  red: "#ff6b6b",
  text: "#e9f1f8",
  mut: "#8da0b3",
};

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

type Phase = "countdown" | "racing" | "finished";

interface Vec {
  x: number;
  y: number;
}

interface Boat {
  x: number;
  y: number;
  heading: number; // degrees, 0 = up, clockwise
  speed: number; // knots
  trail: Vec[];
}

interface Sim {
  clock: number; // seconds since load (drives wind)
  raceTime: number;
  wind: number;
  player: Boat;
  ghost: Boat;
  ghostTack: 1 | -1;
  perfInstant: number;
  perfSmooth: number;
  perfAccum: number;
  perfTime: number;
  vmg: number;
  lead: number; // boat lengths the player is ahead (positive = ahead)
  ghostFinish: number | null;
  finished: boolean;
  playerTime: number | null;
}

interface Hud {
  sog: number;
  twa: number;
  vmg: number;
  lead: number;
  perf: number; // 0..1 smoothed
  onLine: boolean;
  hintShow: boolean;
  hintDir: -1 | 0 | 1;
  raceTime: number;
}

interface RaceResult {
  grade: string;
  avg: number;
  time: number;
  delta: number; // player time - ghost time
}

/* ------------------------------------------------------------------ *
 * Pure helpers
 * ------------------------------------------------------------------ */

function makeBoat(W: number, H: number): Boat {
  return {
    x: W / 2,
    y: H - START_BOTTOM,
    heading: 0,
    speed: 0,
    trail: [],
  };
}

function makeSim(W: number, H: number, clock: number): Sim {
  return {
    clock,
    raceTime: 0,
    wind: 0,
    player: makeBoat(W, H),
    ghost: makeBoat(W, H),
    ghostTack: 1,
    perfInstant: 0,
    perfSmooth: 0,
    perfAccum: 0,
    perfTime: 0,
    vmg: 0,
    lead: 0,
    ghostFinish: null,
    finished: false,
    playerTime: null,
  };
}

function bearingTo(x: number, y: number, m: Vec): number {
  const dx = m.x - x;
  const dy = m.y - y;
  return Math.atan2(dx, -dy) * RAD2DEG;
}

function distTo(x: number, y: number, m: Vec): number {
  return Math.hypot(m.x - x, m.y - y);
}

function gradeFor(avg: number): string {
  if (avg >= 0.96) return "S";
  if (avg >= 0.9) return "A";
  if (avg >= 0.8) return "B";
  if (avg >= 0.68) return "C";
  return "D";
}

/* ------------------------------------------------------------------ *
 * localStorage best (guarded)
 * ------------------------------------------------------------------ */

const BEST_KEY = "stingray.ghostrace.best";

function readBest(): number | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    const raw = window.localStorage.getItem(BEST_KEY);
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeBest(v: number): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(BEST_KEY, String(v));
  } catch {
    /* ignore — fall back to in-memory state */
  }
}

/* ------------------------------------------------------------------ *
 * Component
 * ------------------------------------------------------------------ */

export default function GhostRace() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const simRef = useRef<Sim | null>(null);
  const sizeRef = useRef<{ W: number; H: number }>({ W: 880, H: 460 });
  const inputRef = useRef<{ port: boolean; stbd: boolean }>({
    port: false,
    stbd: false,
  });
  const phaseRef = useRef<Phase>("countdown");
  const reducedRef = useRef(false);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const hudAccumRef = useRef<number>(0);
  const timersRef = useRef<number[]>([]);
  const startedRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("countdown");
  const [countText, setCountText] = useState<string>("3");
  const [result, setResult] = useState<RaceResult | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [held, setHeld] = useState<{ port: boolean; stbd: boolean }>({
    port: false,
    stbd: false,
  });
  const [hud, setHud] = useState<Hud>({
    sog: 0,
    twa: 0,
    vmg: 0,
    lead: 0,
    perf: 0,
    onLine: false,
    hintShow: false,
    hintDir: 0,
    raceTime: 0,
  });

  /* ---------- best score from storage ---------- */
  useEffect(() => {
    setBest(readBest());
  }, []);

  /* ---------- reduced motion ---------- */
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      reducedRef.current = mq.matches;
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  /* ---------- countdown / start ---------- */
  const startCountdown = useCallback(() => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];

    const { W, H } = sizeRef.current;
    const clock = simRef.current ? simRef.current.clock : 0;
    simRef.current = makeSim(W, H, clock);

    setResult(null);
    phaseRef.current = "countdown";
    setPhase("countdown");
    setCountText("3");

    const seq = ["3", "2", "1", "GO"];
    seq.forEach((val, i) => {
      const id = window.setTimeout(() => {
        setCountText(val);
      }, i * 700);
      timersRef.current.push(id);
    });
    const goId = window.setTimeout(() => {
      phaseRef.current = "racing";
      setPhase("racing");
      setCountText("");
    }, seq.length * 700);
    timersRef.current.push(goId);
  }, []);

  /* ---------- finishing ---------- */
  const finishRace = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.finished) return;
    sim.finished = true;
    sim.playerTime = sim.raceTime;

    const avg = sim.perfTime > 0 ? sim.perfAccum / sim.perfTime : 0;
    const ghostT = sim.ghostFinish ?? sim.raceTime;
    const delta = sim.playerTime - ghostT;
    const grade = gradeFor(avg);

    phaseRef.current = "finished";
    setPhase("finished");
    setResult({ grade, avg, time: sim.playerTime, delta });

    setBest((prev) => {
      if (prev == null || avg > prev) {
        writeBest(avg);
        return avg;
      }
      return prev;
    });
  }, []);

  /* ---------- ghost autopilot ---------- */
  const steerGhost = useCallback((sim: Sim, m: Vec, dt: number) => {
    const g = sim.ghost;
    const bearing = bearingTo(g.x, g.y, m);
    const rel = angleDiff(bearing, sim.wind);
    const off = Math.abs(rel);

    let target: number;
    if (off >= OPT_TWA - 1) {
      // On the layline / able to fetch — point straight at the mark.
      // (From the layline this naturally performs the tack.)
      target = bearing;
    } else {
      // Beating out on the current tack at the optimum close-hauled angle.
      target = sim.wind + sim.ghostTack * OPT_TWA;
    }

    const turn = clamp(
      angleDiff(target, g.heading),
      -GHOST_TURN * dt,
      GHOST_TURN * dt,
    );
    g.heading += turn;
  }, []);

  /* ---------- physics integration ---------- */
  const moveBoat = useCallback((b: Boat, wind: number, W: number, dt: number) => {
    const twa = Math.abs(angleDiff(b.heading, wind));
    const speed = polarSpeed(twa);
    const px = speed * PX_PER_KN;
    b.x += Math.sin(b.heading * DEG2RAD) * px * dt;
    b.y -= Math.cos(b.heading * DEG2RAD) * px * dt;
    b.x = clamp(b.x, EDGE, W - EDGE);
    b.speed = speed;
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > TRAIL_MAX) b.trail.shift();
  }, []);

  /* ---------- main step ---------- */
  const step = useCallback(
    (dt: number) => {
      const sim = simRef.current;
      if (!sim) return;
      const { W, H } = sizeRef.current;
      const mark: Vec = { x: W / 2, y: MARK_TOP };

      sim.clock += dt;
      sim.wind = 7 * Math.sin(sim.clock * 0.5) + 3 * Math.sin(sim.clock * 1.3);

      if (phaseRef.current !== "racing") return;

      sim.raceTime += dt;

      // player steering
      let turn = 0;
      if (inputRef.current.port) turn -= 1;
      if (inputRef.current.stbd) turn += 1;
      sim.player.heading += turn * TURN_RATE * dt;

      // ghost autopilot
      steerGhost(sim, mark, dt);

      // integrate
      moveBoat(sim.player, sim.wind, W, dt);
      moveBoat(sim.ghost, sim.wind, W, dt);

      // metrics
      const bearing = bearingTo(sim.player.x, sim.player.y, mark);
      const angOff = angleDiff(sim.player.heading, bearing);
      const progress = sim.player.speed * Math.cos(angOff * DEG2RAD);
      const perfInstant = clamp(progress / OPT_VMG, 0, 1);
      sim.perfInstant = perfInstant;
      sim.perfSmooth += (perfInstant - sim.perfSmooth) * Math.min(1, dt * 6);
      sim.perfAccum += perfInstant * dt;
      sim.perfTime += dt;
      sim.vmg = Math.max(0, progress);

      const dP = distTo(sim.player.x, sim.player.y, mark);
      const dG = distTo(sim.ghost.x, sim.ghost.y, mark);
      sim.lead = (dG - dP) / BL;

      if (sim.ghostFinish === null && dG < FINISH_RADIUS) {
        sim.ghostFinish = sim.raceTime;
      }

      if (dP < FINISH_RADIUS || sim.raceTime >= SAFETY_TIMEOUT) {
        finishRace();
      }
    },
    [steerGhost, moveBoat, finishRace],
  );

  /* ---------- push HUD snapshot to React ---------- */
  const pushHud = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const { W, H } = sizeRef.current;
    const mark: Vec = { x: W / 2, y: MARK_TOP };

    // Trim hint: pick the nearer close-hauled heading.
    const ch1 = sim.wind + OPT_TWA;
    const ch2 = sim.wind - OPT_TWA;
    const target =
      Math.abs(angleDiff(ch1, sim.player.heading)) <
      Math.abs(angleDiff(ch2, sim.player.heading))
        ? ch1
        : ch2;
    const turnNeeded = angleDiff(target, sim.player.heading);
    const hintDir: -1 | 0 | 1 = turnNeeded > 0 ? 1 : turnNeeded < 0 ? -1 : 0;

    setHud({
      sog: sim.player.speed,
      twa: Math.abs(angleDiff(sim.player.heading, sim.wind)),
      vmg: sim.vmg,
      lead: sim.lead,
      perf: sim.perfSmooth,
      onLine: sim.perfInstant > 0.965,
      hintShow: phaseRef.current === "racing" && sim.perfInstant < 0.93,
      hintDir,
      raceTime: sim.raceTime,
    });
    // mark referenced to keep one source of truth (W/H based)
    void mark;
  }, []);

  /* ---------- rendering ---------- */
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const sim = simRef.current;
    if (!canvas || !sim) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { W, H } = sizeRef.current;
    const mark: Vec = { x: W / 2, y: MARK_TOP };
    const reduced = reducedRef.current;

    ctx.clearRect(0, 0, W, H);

    // 1. water gradient
    const water = ctx.createLinearGradient(0, 0, 0, H);
    water.addColorStop(0, "#0a2230");
    water.addColorStop(0.55, "#071420");
    water.addColorStop(1, "#03060c");
    ctx.fillStyle = water;
    ctx.fillRect(0, 0, W, H);

    // 2. drifting wind streaks
    if (!reduced) {
      ctx.save();
      ctx.globalAlpha = 1;
      const dir = sim.wind + 180; // direction wind blows toward
      const ux = Math.sin(dir * DEG2RAD);
      const uy = -Math.cos(dir * DEG2RAD);
      const drift = (sim.clock * 26) % 46;
      ctx.strokeStyle = "rgba(70,227,234,0.05)";
      ctx.lineWidth = 1;
      const cols = 9;
      const rows = 7;
      for (let r = -1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const baseX = ((c + 0.5) / cols) * W;
          const baseY = ((r + 0.5) / rows) * H + drift;
          const len = 16;
          ctx.beginPath();
          ctx.moveTo(baseX - ux * len, baseY - uy * len);
          ctx.lineTo(baseX + ux * len, baseY + uy * len);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    // 3. laylines from the mark at optimum angle
    ctx.save();
    ctx.setLineDash([7, 9]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(70,227,234,0.18)";
    const L = H * 1.4;
    [sim.wind + OPT_TWA, sim.wind - OPT_TWA].forEach((h) => {
      // layline extends downward = opposite of close-hauled travel dir
      const dx = -Math.sin(h * DEG2RAD);
      const dy = Math.cos(h * DEG2RAD);
      ctx.beginPath();
      ctx.moveTo(mark.x, mark.y);
      ctx.lineTo(mark.x + dx * L, mark.y + dy * L);
      ctx.stroke();
    });
    ctx.restore();

    // 4. connecting delta band between the boats
    {
      const ahead = sim.lead >= 0;
      const col = ahead ? COLORS.green : COLORS.red;
      const wdt = clamp(13 - Math.abs(sim.lead) * 2.4, 3, 13);
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.strokeStyle = col;
      ctx.lineWidth = wdt;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(sim.player.x, sim.player.y);
      ctx.lineTo(sim.ghost.x, sim.ghost.y);
      ctx.stroke();
      ctx.restore();
    }

    // 5. mark (pulsing amber buoy)
    {
      const pulse = reduced ? 1 : 1 + 0.14 * Math.sin(sim.clock * 2.2);
      ctx.save();
      ctx.shadowColor = COLORS.amber;
      ctx.shadowBlur = 22 * pulse;
      ctx.fillStyle = "rgba(255,186,73,0.16)";
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 16 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 14;
      ctx.fillStyle = COLORS.amber;
      ctx.beginPath();
      ctx.arc(mark.x, mark.y, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 6. wakes
    drawWake(ctx, sim.ghost.trail, "70,227,234");
    drawWake(ctx, sim.player.trail, "255,186,73");

    // 7. ghost boat
    drawBoat(ctx, sim.ghost, {
      fill: "rgba(70,227,234,0.28)",
      stroke: COLORS.cyan,
      glow: COLORS.cyan,
    });

    // 8. player boat
    drawBoat(ctx, sim.player, {
      fill: COLORS.amber,
      stroke: "#ffe6b0",
      glow: COLORS.amber,
    });
  }, []);

  /* ---------- animation loop ---------- */
  useEffect(() => {
    const loop = (now: number) => {
      if (!lastRef.current) lastRef.current = now;
      let dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (dt > 0.05) dt = 0.05;
      if (dt < 0) dt = 0;

      step(dt);
      draw();

      hudAccumRef.current += dt;
      if (hudAccumRef.current >= 0.05) {
        hudAccumRef.current = 0;
        pushHud();
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [step, draw, pushHud]);

  /* ---------- size / DPR handling ---------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const W = Math.max(280, Math.round(rect.width));
      const H = Math.max(320, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sizeRef.current = { W, H };

      if (!simRef.current) {
        simRef.current = makeSim(W, H, 0);
      }
      if (!startedRef.current) {
        startedRef.current = true;
        startCountdown();
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(stage);
    window.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [startCountdown]);

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") {
        if (k === "arrowleft") e.preventDefault();
        inputRef.current.port = true;
        setHeld((h) => ({ ...h, port: true }));
      } else if (k === "d" || k === "arrowright") {
        if (k === "arrowright") e.preventDefault();
        inputRef.current.stbd = true;
        setHeld((h) => ({ ...h, stbd: true }));
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === "a" || k === "arrowleft") {
        inputRef.current.port = false;
        setHeld((h) => ({ ...h, port: false }));
      } else if (k === "d" || k === "arrowright") {
        inputRef.current.stbd = false;
        setHeld((h) => ({ ...h, stbd: false }));
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ---------- cleanup timers on unmount ---------- */
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, []);

  /* ---------- helm button handlers ---------- */
  const pressHelm = (
    key: "port" | "stbd",
    e: React.PointerEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    inputRef.current[key] = true;
    setHeld((h) => ({ ...h, [key]: true }));
  };
  const releaseHelm = (key: "port" | "stbd") => {
    inputRef.current[key] = false;
    setHeld((h) => ({ ...h, [key]: false }));
  };

  /* ---------- derived display ---------- */
  const bestLabel = best == null ? "--" : `${Math.round(best * 100)}%`;
  const leadAhead = hud.lead >= 0;
  const leadLabel = `${leadAhead ? "+" : "−"}${Math.abs(hud.lead).toFixed(1)}`;

  return (
    <div className="w-full" style={{ maxWidth: 920 }}>
      {/* ---------------- top bar ---------------- */}
      <div className="flex items-center gap-3 px-1 mb-3">
        <Emblem />
        <span
          className="font-display text-text"
          style={{
            fontWeight: 600,
            letterSpacing: "0.22em",
            fontSize: 22,
          }}
        >
          STINGRAY
        </span>
        <span
          className="hud-label"
          style={{ color: COLORS.cyan, fontSize: 11, letterSpacing: "0.24em" }}
        >
          Ghost Race
        </span>
        <div className="flex-1" />
        <span
          className="hud-label"
          style={{ color: COLORS.mut, fontSize: 11 }}
        >
          Best
        </span>
        <span
          className="font-display"
          style={{ color: COLORS.cyan, fontWeight: 700, fontSize: 18 }}
        >
          {bestLabel}
        </span>
      </div>

      {/* ---------------- stage ---------------- */}
      <div
        ref={stageRef}
        className="relative w-full overflow-hidden"
        style={{
          height: "clamp(380px, 60vh, 468px)",
          borderRadius: 14,
          border: `1px solid ${COLORS.hair}`,
          boxShadow: `0 0 0 1px rgba(70,227,234,0.04), 0 18px 60px -20px rgba(70,227,234,0.35)`,
          background: COLORS.abyss,
        }}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
          aria-label="Ghost Race sailing game. Steer the amber boat up the wind beat to match the cyan ghost's optimum line and reach the mark."
          role="img"
        />

        {/* HUD overlay */}
        <div
          className="absolute inset-0"
          style={{ pointerEvents: "none" }}
        >
          {/* instrument cluster — top left */}
          <div className="absolute left-3 top-3 flex gap-2 flex-wrap">
            <Instrument label="SOG" value={hud.sog.toFixed(1)} unit="kn" />
            <Instrument
              label="TWA"
              value={`${Math.round(hud.twa)}`}
              unit="°"
            />
            <Instrument label="VMG" value={hud.vmg.toFixed(1)} unit="kn" />
            <Instrument
              label="GAP"
              value={leadLabel}
              unit="BL"
              color={leadAhead ? COLORS.green : COLORS.red}
            />
          </div>

          {/* wind card — top right */}
          <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
            <div
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.hair}`,
                borderRadius: 9,
                backdropFilter: "blur(7px)",
                WebkitBackdropFilter: "blur(7px)",
                padding: "6px 11px",
                minWidth: 78,
              }}
            >
              <div
                className="hud-label"
                style={{ color: COLORS.cyan, fontSize: 9 }}
              >
                Wind
              </div>
              <div className="flex items-baseline gap-1">
                <span
                  className="font-display"
                  style={{ color: COLORS.text, fontWeight: 700, fontSize: 21 }}
                >
                  12
                </span>
                <span
                  className="font-display"
                  style={{ color: COLORS.mut, fontSize: 11 }}
                >
                  kn
                </span>
              </div>
            </div>
            <span
              className="font-display"
              style={{ color: COLORS.mut, fontSize: 13, fontWeight: 600 }}
            >
              {hud.raceTime.toFixed(1)}s
            </span>
          </div>

          {/* performance score — top centre */}
          <div
            className="absolute left-1/2 top-3 flex flex-col items-center"
            style={{ transform: "translateX(-50%)", width: 200 }}
          >
            <span
              className="hud-label"
              style={{ color: COLORS.mut, fontSize: 9 }}
            >
              Performance
            </span>
            <div className="flex items-start gap-0.5">
              <span
                className="font-display"
                style={{
                  color: COLORS.text,
                  fontWeight: 700,
                  fontSize: 45,
                  lineHeight: 1,
                  textShadow: `0 0 18px rgba(70,227,234,0.55)`,
                }}
              >
                {Math.round(hud.perf * 100)}
              </span>
              <span
                className="font-display"
                style={{
                  color: COLORS.mut,
                  fontSize: 16,
                  fontWeight: 700,
                  marginTop: 4,
                }}
              >
                %
              </span>
            </div>
            <div
              style={{
                width: 168,
                height: 5,
                borderRadius: 3,
                background: "rgba(255,255,255,0.08)",
                overflow: "hidden",
                marginTop: 4,
              }}
            >
              <div
                style={{
                  width: `${Math.round(hud.perf * 100)}%`,
                  height: "100%",
                  background: `linear-gradient(90deg, ${COLORS.amber}, ${COLORS.cyan}, ${COLORS.green})`,
                  transition: "width 80ms linear",
                }}
              />
            </div>
            <div style={{ marginTop: 6 }}>
              {hud.onLine ? (
                <span
                  className="hud-label"
                  style={{
                    color: "#04200f",
                    background: COLORS.green,
                    borderRadius: 999,
                    padding: "3px 12px",
                    fontSize: 10,
                    boxShadow: `0 0 16px rgba(122,240,168,0.6)`,
                  }}
                >
                  On the line
                </span>
              ) : (
                <span
                  className="hud-label"
                  style={{
                    color: COLORS.mut,
                    border: `1px solid ${COLORS.hair}`,
                    borderRadius: 999,
                    padding: "3px 12px",
                    fontSize: 10,
                  }}
                >
                  Trimming
                </span>
              )}
            </div>
          </div>

          {/* trim hint — bottom centre */}
          <div
            className="absolute left-1/2 bottom-3 flex items-center gap-2"
            style={{
              transform: "translateX(-50%)",
              opacity: hud.hintShow ? 1 : 0,
              transition: "opacity 260ms ease",
            }}
          >
            {hud.hintDir < 0 && (
              <span
                className="font-display"
                style={{ color: COLORS.cyan, fontSize: 18 }}
              >
                ‹
              </span>
            )}
            <span
              className="hud-label"
              style={{ color: COLORS.mut, fontSize: 11 }}
            >
              Trim to the line
            </span>
            {hud.hintDir > 0 && (
              <span
                className="font-display"
                style={{ color: COLORS.cyan, fontSize: 18 }}
              >
                ›
              </span>
            )}
          </div>

          {/* start overlay */}
          {phase === "countdown" && (
            <Overlay>
              <span
                className="hud-label"
                style={{ color: COLORS.cyan, fontSize: 12 }}
              >
                Chase the Ghost
              </span>
              <span
                className="font-display"
                style={{
                  color: COLORS.cyan,
                  fontWeight: 700,
                  fontSize: 84,
                  lineHeight: 1,
                  textShadow: `0 0 30px rgba(70,227,234,0.7)`,
                  margin: "6px 0",
                }}
              >
                {countText}
              </span>
              <span
                className="font-body text-center"
                style={{ color: COLORS.mut, fontSize: 13, maxWidth: 300 }}
              >
                Hold the helm buttons (or A / D) to steer the amber boat onto
                the ghost&apos;s line and round the mark.
              </span>
            </Overlay>
          )}

          {/* result overlay */}
          {phase === "finished" && result && (
            <Overlay>
              <span
                className="hud-label"
                style={{ color: COLORS.cyan, fontSize: 12 }}
              >
                Mark Rounded
              </span>
              <span
                className="font-display"
                style={{
                  color:
                    result.grade === "S"
                      ? COLORS.green
                      : result.grade === "A"
                        ? COLORS.cyan
                        : COLORS.text,
                  fontWeight: 700,
                  fontSize: 86,
                  lineHeight: 1,
                  textShadow: `0 0 30px rgba(70,227,234,0.55)`,
                  margin: "2px 0 10px",
                }}
              >
                {result.grade}
              </span>
              <div className="flex gap-7 mb-5">
                <ResultStat
                  label="Avg Performance"
                  value={`${Math.round(result.avg * 100)}%`}
                />
                <ResultStat
                  label="Your Time"
                  value={`${result.time.toFixed(1)}s`}
                />
                <ResultStat
                  label="Vs Ghost"
                  value={`${result.delta <= 0 ? "−" : "+"}${Math.abs(
                    result.delta,
                  ).toFixed(1)}s`}
                  color={result.delta <= 0 ? COLORS.green : COLORS.red}
                />
              </div>
              <button
                onClick={startCountdown}
                className="font-display no-touch-select"
                style={{
                  pointerEvents: "auto",
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  fontSize: 15,
                  color: "#04222a",
                  padding: "11px 26px",
                  borderRadius: 11,
                  border: "none",
                  cursor: "pointer",
                  background: `linear-gradient(90deg, ${COLORS.cyan}, ${COLORS.cyan2})`,
                  boxShadow: `0 0 22px rgba(70,227,234,0.5)`,
                }}
              >
                RACE AGAIN
              </button>
            </Overlay>
          )}
        </div>
      </div>

      {/* ---------------- controls ---------------- */}
      <div className="flex gap-2 mt-3">
        <HelmButton
          label="‹ PORT"
          held={held.port}
          onDown={(e) => pressHelm("port", e)}
          onUp={() => releaseHelm("port")}
        />
        <HelmButton
          label="STBD ›"
          held={held.stbd}
          onDown={(e) => pressHelm("stbd", e)}
          onUp={() => releaseHelm("stbd")}
        />
        <button
          onClick={startCountdown}
          className="font-display no-touch-select"
          style={{
            fontWeight: 600,
            letterSpacing: "0.1em",
            fontSize: 13,
            color: COLORS.mut,
            background: COLORS.navy,
            border: `1px solid ${COLORS.hair}`,
            borderRadius: 11,
            padding: "0 18px",
            cursor: "pointer",
          }}
        >
          Restart
        </button>
      </div>

      <p
        className="font-display mt-3 px-1"
        style={{ color: COLORS.mut, fontSize: 12.5, letterSpacing: "0.02em" }}
      >
        Match the ghost&apos;s angle to sail at 100%. Too high and you pinch,
        too low and you slip sideways.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Canvas drawing helpers
 * ------------------------------------------------------------------ */

function drawWake(
  ctx: CanvasRenderingContext2D,
  trail: Vec[],
  rgb: string,
): void {
  if (trail.length < 2) return;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 1; i < trail.length; i++) {
    const a = (i / trail.length) * 0.5;
    ctx.strokeStyle = `rgba(${rgb},${a})`;
    ctx.lineWidth = (i / trail.length) * 4 + 0.5;
    ctx.beginPath();
    ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
    ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoat(
  ctx: CanvasRenderingContext2D,
  b: Boat,
  style: { fill: string; stroke: string; glow: string },
): void {
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.rotate(b.heading * DEG2RAD);
  ctx.beginPath();
  ctx.moveTo(0, -16); // bow
  ctx.quadraticCurveTo(7, -2, 5, 10);
  ctx.quadraticCurveTo(0, 14, -5, 10);
  ctx.quadraticCurveTo(-7, -2, 0, -16);
  ctx.closePath();
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 14;
  ctx.fillStyle = style.fill;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = style.stroke;
  ctx.stroke();
  // a faint centreline
  ctx.beginPath();
  ctx.moveTo(0, -13);
  ctx.lineTo(0, 9);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * Small presentational components
 * ------------------------------------------------------------------ */

function Instrument({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: string;
  unit: string;
  color?: string;
}) {
  return (
    <div
      style={{
        background: COLORS.card,
        border: `1px solid ${COLORS.hair}`,
        borderRadius: 9,
        backdropFilter: "blur(7px)",
        WebkitBackdropFilter: "blur(7px)",
        padding: "5px 9px",
        minWidth: 60,
      }}
    >
      <div className="hud-label" style={{ color: COLORS.cyan, fontSize: 9 }}>
        {label}
      </div>
      <div className="flex items-baseline gap-0.5">
        <span
          className="font-display"
          style={{
            color: color ?? COLORS.text,
            fontWeight: 700,
            fontSize: 20,
            lineHeight: 1.05,
          }}
        >
          {value}
        </span>
        <span
          className="font-display"
          style={{ color: COLORS.mut, fontSize: 10 }}
        >
          {unit}
        </span>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center text-center px-4"
      style={{
        background: "rgba(3,7,14,0.62)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        pointerEvents: "auto",
      }}
    >
      {children}
    </div>
  );
}

function ResultStat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="hud-label" style={{ color: COLORS.mut, fontSize: 9 }}>
        {label}
      </span>
      <span
        className="font-display"
        style={{
          color: color ?? COLORS.text,
          fontWeight: 700,
          fontSize: 22,
          marginTop: 2,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function HelmButton({
  label,
  held,
  onDown,
  onUp,
}: {
  label: string;
  held: boolean;
  onDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onUp: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label.replace(/[‹›]/g, "").trim()}
      className="font-display no-touch-select flex-1"
      onPointerDown={onDown}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      style={{
        fontWeight: 700,
        letterSpacing: "0.14em",
        fontSize: 19,
        height: 58,
        borderRadius: 12,
        cursor: "pointer",
        color: held ? "#04222a" : COLORS.cyan,
        background: held
          ? `linear-gradient(90deg, ${COLORS.cyan}, ${COLORS.cyan2})`
          : COLORS.navy,
        border: `1px solid ${COLORS.hair}`,
        boxShadow: held ? `0 0 22px rgba(70,227,234,0.45)` : "none",
        transition: "background 60ms linear, color 60ms linear",
      }}
    >
      {label}
    </button>
  );
}

function Emblem() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" fill="none" aria-hidden>
      <defs>
        <linearGradient id="sr-silver" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#eaf3f8" />
          <stop offset="0.5" stopColor="#9fb3c2" />
          <stop offset="1" stopColor="#5c6f7e" />
        </linearGradient>
      </defs>
      <path d="M16 3 L28 13 L23 13 L16 8 L9 13 L4 13 Z" fill="url(#sr-silver)" />
      <rect x="8" y="17" width="16" height="2.6" rx="1.3" fill="url(#sr-silver)" />
      <rect x="10" y="22" width="12" height="2.6" rx="1.3" fill="url(#sr-silver)" />
      <rect x="12" y="27" width="8" height="2.6" rx="1.3" fill="url(#sr-silver)" />
    </svg>
  );
}
