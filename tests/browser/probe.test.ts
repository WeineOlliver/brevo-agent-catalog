import { describe, expect, it } from 'vitest';
import { parseScreenProbe } from '../../src/browser/window.js';

/**
 * Windows PowerShell 5.1 does not have `ConvertTo-Json -AsArray`, and piping a
 * single object to `ConvertTo-Json` emits an object rather than a one-element
 * array. A probe that only understands arrays reports "no screens", and the
 * window silently opens on the primary screen — the exact bug this pins.
 */
describe('parseScreenProbe', () => {
  it('reads a JSON array of screens', () => {
    const json =
      '[{"name":"\\\\\\\\.\\\\DISPLAY1","primary":true,"x":0,"y":0,"width":2560,"height":1392},' +
      '{"name":"\\\\\\\\.\\\\DISPLAY2","primary":false,"x":0,"y":-1080,"width":1920,"height":1032}]';
    const screens = parseScreenProbe(json);
    expect(screens).toHaveLength(2);
    expect(screens[1]).toMatchObject({ primary: false, y: -1080, width: 1920 });
  });

  it('reads a single screen emitted as a bare object, not an array', () => {
    const json = '{"name":"DISPLAY1","primary":true,"x":0,"y":0,"width":2560,"height":1392}';
    expect(parseScreenProbe(json)).toHaveLength(1);
    expect(parseScreenProbe(json)[0]?.primary).toBe(true);
  });

  it('returns nothing for the error text a failed PowerShell command prints', () => {
    expect(parseScreenProbe("ConvertTo-Json : parameter 'AsArray' not found")).toEqual([]);
    expect(parseScreenProbe('')).toEqual([]);
  });

  it('drops entries missing the geometry the placement maths needs', () => {
    const json = '[{"name":"BROKEN","primary":false},{"name":"OK","primary":false,"x":1,"y":2,"width":3,"height":4}]';
    const screens = parseScreenProbe(json);
    expect(screens).toHaveLength(1);
    expect(screens[0]?.name).toBe('OK');
  });

  it('coerces a PowerShell boolean-ish primary flag', () => {
    const json = '[{"name":"A","primary":"True","x":0,"y":0,"width":100,"height":100}]';
    expect(parseScreenProbe(json)[0]?.primary).toBe(true);
  });
});
