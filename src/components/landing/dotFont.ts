/**
 * A 5×7 dot-matrix font, the face of real stadium ribbon boards and the only one that reads at
 * this size: a browser font rasterized to seven rows turns to mush. Each glyph is seven rows of
 * '#' (lamp on) and '.' (off); narrow glyphs are narrower. Anything not here draws as a space.
 */
const GLYPHS: Record<string, string> = {
  A: ".###. #...# #...# ##### #...# #...# #...#",
  B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.",
  D: "####. #...# #...# #...# #...# #...# ####.",
  E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....",
  G: ".###. #...# #.... #.### #...# #...# .####",
  H: "#...# #...# #...# ##### #...# #...# #...#",
  I: "### .#. .#. .#. .#. .#. ###",
  J: "..### ...#. ...#. ...#. ...#. #..#. .##..",
  K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####",
  M: "#...# ##.## #.#.# #.#.# #...# #...# #...#",
  N: "#...# #...# ##..# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.",
  P: "####. #...# #...# ####. #.... #.... #....",
  Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#",
  S: ".#### #.... #.... .###. ....# ....# ####.",
  T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.",
  V: "#...# #...# #...# #...# #...# .#.#. ..#..",
  W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#",
  Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..",
  Z: "##### ....# ...#. ..#.. .#... #.... #####",
  "0": ".###. #...# #..## #.#.# ##..# #...# .###.",
  "1": ".#. ##. .#. .#. .#. .#. ###",
  "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "##### ...#. ..#.. ...#. ....# #...# .###.",
  "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.",
  "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": "..##. .#... #.... ####. #...# #...# .###.",
  "7": "##### ....# ...#. ..#.. .#... .#... .#...",
  "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ...#. .##..",
  " ": "... ... ... ... ... ... ...",
  "·": "... ... ... .#. ... ... ...",
  "-": "... ... ... ### ... ... ...",
  "'": "# # . . . . .",
  ".": ". . . . . . #",
  ",": ".. .. .. .. .. .# #.",
  "✓": "..... ....# ...## #.##. ###.. .#... .....",
};

export const DOT_ROWS = 7;

/** One column of lamps: bit r set means row r (top = 0) is on. */
export interface DotColumn {
  bits: number;
  color: string;
}

/**
 * Lays text out as columns of lamps, one lamp's gap between glyphs. `color` is applied per run,
 * so a ribbon can show each player in their position's hue.
 */
export function layoutDots(runs: { text: string; color: string }[]): DotColumn[] {
  const cols: DotColumn[] = [];
  for (const run of runs) {
    for (const ch of run.text.toUpperCase()) {
      const rows = (GLYPHS[ch] ?? GLYPHS[" "]).split(" ");
      const width = rows[0].length;
      for (let c = 0; c < width; c++) {
        let bits = 0;
        for (let r = 0; r < DOT_ROWS; r++) if (rows[r][c] === "#") bits |= 1 << r;
        cols.push({ bits, color: run.color });
      }
      cols.push({ bits: 0, color: run.color });
    }
  }
  return cols;
}
