import { describe, expect, it } from 'vitest';
import {
  parseOrigin,
  pickScreen,
  windowArgs,
  windowOrigin,
  type Screen,
} from '../../src/browser/window.js';

/** The operator's real layout: a primary centre screen, one above, one portrait to the left. */
const LAYOUT: Screen[] = [
  { name: 'DISPLAY1', primary: true, x: 0, y: 0, width: 2560, height: 1440 },
  { name: 'DISPLAY2', primary: false, x: 0, y: -1080, width: 1920, height: 1080 },
  { name: 'DISPLAY3', primary: false, x: -1440, y: -475, width: 1440, height: 2560 },
];

const SIZE = { width: 1440, height: 900 };

describe('pickScreen', () => {
  it('never returns the primary screen', () => {
    expect(pickScreen(LAYOUT, SIZE)?.primary).toBe(false);
  });

  it('prefers the largest non-primary screen that fits the window', () => {
    // DISPLAY3 is 3.69 Mpx against DISPLAY2's 2.07 Mpx, and 1440 wide fits exactly.
    expect(pickScreen(LAYOUT, SIZE)?.name).toBe('DISPLAY3');
  });

  it('falls back to a non-primary screen too small for the window rather than the primary', () => {
    const cramped: Screen[] = [
      LAYOUT[0]!,
      { name: 'TINY', primary: false, x: 3000, y: 0, width: 800, height: 600 },
    ];
    expect(pickScreen(cramped, SIZE)?.name).toBe('TINY');
  });

  it('returns null with only a primary screen, so the caller keeps the default placement', () => {
    expect(pickScreen([LAYOUT[0]!], SIZE)).toBeNull();
  });

  it('returns null when the screen probe found nothing', () => {
    expect(pickScreen([], SIZE)).toBeNull();
  });
});

describe('windowOrigin', () => {
  it('centres the window on a screen with room to spare', () => {
    // DISPLAY2: x 0 + (1920-1440)/2 = 240, y -1080 + (1080-900)/2 = -990.
    expect(windowOrigin(LAYOUT[1]!, SIZE)).toEqual({ x: 240, y: -990 });
  });

  it('keeps negative screen coordinates, which is how a screen above or left is addressed', () => {
    const origin = windowOrigin(LAYOUT[2]!, SIZE);
    expect(origin.x).toBe(-1440);
    expect(origin.y).toBe(-475 + Math.floor((2560 - 900) / 2));
  });

  it('never places the window off the top-left of a screen too small for it', () => {
    const tiny: Screen = { name: 'TINY', primary: false, x: 3000, y: 0, width: 800, height: 600 };
    expect(windowOrigin(tiny, SIZE)).toEqual({ x: 3000, y: 0 });
  });
});

describe('parseOrigin', () => {
  it('reads an explicit "x,y" override, negatives included', () => {
    expect(parseOrigin('-1440,-475')).toEqual({ x: -1440, y: -475 });
    expect(parseOrigin(' 240 , -990 ')).toEqual({ x: 240, y: -990 });
  });

  it('treats "primary" and "main" as a request to keep the default placement', () => {
    expect(parseOrigin('primary')).toBe('default');
    expect(parseOrigin('MAIN')).toBe('default');
  });

  it('ignores a blank or unparseable value so a typo cannot move the window somewhere absurd', () => {
    expect(parseOrigin('')).toBeNull();
    expect(parseOrigin(undefined)).toBeNull();
    expect(parseOrigin('top-left')).toBeNull();
    expect(parseOrigin('1440')).toBeNull();
  });
});

describe('windowArgs', () => {
  it('places the window on a non-primary screen and sizes it to the viewport', () => {
    expect(windowArgs(LAYOUT, SIZE)).toEqual([
      '--window-position=-1440,355',
      '--window-size=1440,900',
    ]);
  });

  it('honours an explicit override over the detected screen', () => {
    expect(windowArgs(LAYOUT, SIZE, '240,-990')).toEqual([
      '--window-position=240,-990',
      '--window-size=1440,900',
    ]);
  });

  it('emits no position argument when the override asks for the primary screen', () => {
    expect(windowArgs(LAYOUT, SIZE, 'primary')).toEqual(['--window-size=1440,900']);
  });

  it('emits no position argument when there is no second screen', () => {
    expect(windowArgs([LAYOUT[0]!], SIZE)).toEqual(['--window-size=1440,900']);
  });
});
