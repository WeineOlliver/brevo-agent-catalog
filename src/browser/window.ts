/**
 * Where the headed browser window opens.
 *
 * Every headed run — login, crawl, interact, explore, verify — takes over a
 * screen for up to half an hour while the operator keeps working. Chromium's
 * default is the primary screen, which is the one screen they are using. So
 * the window goes on a non-primary screen when there is one.
 *
 * Screen coordinates on a multi-monitor desktop are signed: a screen above or
 * to the left of the primary has negative origins. Nothing here may assume
 * otherwise, which is also why the layout is probed rather than configured.
 */

import { execFileSync } from 'node:child_process';

export type Screen = {
  name: string;
  primary: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowSize = { width: number; height: number };

/** The viewport every headed run uses, and therefore the window size. */
export const HEADED_VIEWPORT: WindowSize = { width: 1440, height: 900 };

/** An explicit placement, a request for the default, or nothing usable. */
export type OriginOverride = { x: number; y: number } | 'default' | null;

/**
 * The screen to open on: the largest non-primary one that fits the window,
 * else the largest non-primary one regardless, else null.
 *
 * A screen too small for the window still beats the primary — a clipped window
 * on a spare screen is a cosmetic problem, while one on the primary screen is
 * in the operator's way, which is the thing being fixed.
 */
export function pickScreen(screens: Screen[], size: WindowSize): Screen | null {
  const candidates = screens.filter((screen) => !screen.primary);
  if (candidates.length === 0) return null;

  const area = (screen: Screen): number => screen.width * screen.height;
  const byArea = [...candidates].sort((a, b) => area(b) - area(a));

  const fits = byArea.find(
    (screen) => screen.width >= size.width && screen.height >= size.height,
  );
  return fits ?? byArea[0] ?? null;
}

/** Centres the window on a screen, clamped to its top-left corner. */
export function windowOrigin(screen: Screen, size: WindowSize): { x: number; y: number } {
  return {
    x: screen.x + Math.max(0, Math.floor((screen.width - size.width) / 2)),
    y: screen.y + Math.max(0, Math.floor((screen.height - size.height) / 2)),
  };
}

/** Reads a `BROWSER_WINDOW` value: "x,y", or "primary"/"main" for the default. */
export function parseOrigin(raw: string | undefined): OriginOverride {
  const text = raw?.trim() ?? '';
  if (text.length === 0) return null;
  if (/^(?:primary|main|default)$/i.test(text)) return 'default';

  const match = /^(-?\d+)\s*,\s*(-?\d+)$/.exec(text);
  if (match === null) return null;
  return { x: Number(match[1]), y: Number(match[2]) };
}

/**
 * Chromium arguments placing and sizing the window. The size is always set so
 * the window matches the viewport; the position is omitted when the default
 * placement is what we want, since Chromium handles that better than we can.
 */
export function windowArgs(
  screens: Screen[],
  size: WindowSize,
  override?: string | undefined,
): string[] {
  const sizeArg = `--window-size=${size.width},${size.height}`;
  const parsed = parseOrigin(override);

  if (parsed === 'default') return [sizeArg];

  const origin = parsed ?? (() => {
    const screen = pickScreen(screens, size);
    return screen === null ? null : windowOrigin(screen, size);
  })();

  if (origin === null) return [sizeArg];
  return [`--window-position=${origin.x},${origin.y}`, sizeArg];
}

/**
 * Reads the probe's stdout into a layout.
 *
 * Kept separate from running the probe so the shapes Windows PowerShell 5.1
 * actually produces are covered by tests: a JSON array, a bare object when
 * there is one screen, and error text when the command itself failed.
 */
export function parseScreenProbe(stdout: string): Screen[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return [];
  }

  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const screens: Screen[] = [];

  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const r = row as Record<string, unknown>;
    const numbers = ['x', 'y', 'width', 'height'].map((key) => Number(r[key]));
    if (numbers.some((n) => !Number.isFinite(n))) continue;
    const [x, y, width, height] = numbers as [number, number, number, number];
    if (width <= 0 || height <= 0) continue;

    screens.push({
      name: typeof r.name === 'string' ? r.name : 'unknown',
      // PowerShell may render the flag as a JSON boolean or as "True"/"False".
      primary: r.primary === true || /^true$/i.test(String(r.primary)),
      x,
      y,
      width,
      height,
    });
  }

  return screens;
}

/**
 * The desktop's screen layout.
 *
 * Windows only: `System.Windows.Forms.Screen` is the one source that reports
 * both the signed bounds and which screen is primary. Elsewhere this returns
 * an empty layout, and `windowArgs` then leaves placement to Chromium — the
 * behaviour before any of this existed.
 *
 * `ConvertTo-Json -AsArray` would be the obvious way to get a stable shape,
 * but it is PowerShell 7+ and this runs on Windows PowerShell 5.1, where it
 * fails the whole command. `-InputObject` on a forced array keeps 5.1 from
 * unrolling a single screen, and `parseScreenProbe` tolerates both shapes.
 */
export function detectScreens(platform: string = process.platform): Screen[] {
  if (platform !== 'win32') return [];

  const script =
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    '$screens = @([System.Windows.Forms.Screen]::AllScreens | ' +
    'ForEach-Object { [pscustomobject]@{ name = $_.DeviceName; primary = $_.Primary; ' +
    'x = $_.WorkingArea.X; y = $_.WorkingArea.Y; ' +
    'width = $_.WorkingArea.Width; height = $_.WorkingArea.Height } }); ' +
    'ConvertTo-Json -InputObject $screens -Compress -Depth 3';

  try {
    const stdout = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 10_000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return parseScreenProbe(stdout);
  } catch {
    // A probe that fails must not stop a run; Chromium's default still works.
    return [];
  }
}

/**
 * The launch arguments for a headed run, with the layout probed here.
 * `BROWSER_WINDOW` in the environment overrides the choice.
 */
export function headedLaunchArgs(size: WindowSize, env: NodeJS.ProcessEnv = process.env): string[] {
  return windowArgs(detectScreens(), size, env.BROWSER_WINDOW);
}

/** One line naming where the window will open, for the run's own output. */
export function describePlacement(args: string[]): string {
  const position = args.find((arg) => arg.startsWith('--window-position='));
  if (position === undefined) return 'window: primary screen (default placement)';
  return `window: at ${position.split('=')[1]} (off the primary screen)`;
}
