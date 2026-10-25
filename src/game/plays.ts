/** Scripted plays. Yards: x = world x (QB's left is +x), y = downfield from the line. Route points [x, y, t]
 * are offsets from the player's start; t in seconds after the snap. */
export type OffPos = 'WR1' | 'WR2' | 'WR3' | 'TE' | 'RB' | 'LT' | 'LG' | 'C' | 'RG' | 'RT';
export type DefPos = 'DE1' | 'DT1' | 'DT2' | 'DE2' | 'LB1' | 'LB2' | 'CB1' | 'CB2' | 'NB' | 'S1' | 'S2';
export type Cover = { man?: OffPos; zone?: [number, number]; cushion?: number; lag?: number; blitz?: boolean; rot?: { at: number; zone: [number, number] } };

export interface Play {
  name: string;
  desc: string;
  routes: Partial<Record<OffPos, [number, number, number][]>>;
  coverage: Partial<Record<DefPos, Cover>>;
  sackTime: [number, number];
  yac: Partial<Record<OffPos, [number, number]>>;
}

export const OFF_SPOT: Record<OffPos, [number, number]> = {
  LT: [2.9, -0.8], LG: [1.45, -0.8], C: [0, -0.7], RG: [-1.45, -0.8], RT: [-2.9, -0.8],
  TE: [4.4, -1.0], WR1: [-21, -0.9], WR2: [20, -0.9], WR3: [-12, -1.2], RB: [-1.6, -5.2],
};
// 2026 rosters (texaslonghorns.com, soonersports.com). Starters picked by position, not an official depth chart.
export const OFF_NUM: Record<OffPos, number> = { LT: 74, LG: 54, C: 62, RG: 73, RT: 75, TE: 15, WR1: 1, WR2: 8, WR3: 3, RB: 0 };
export const OFF_NAME: Record<OffPos, string> = { LT: 'GOOSBY', LG: 'HUTSON', C: 'ROBERTSON', RG: 'BAKER', RT: 'CHATMAN',
  TE: 'MASUNAS', WR1: 'WINGO', WR2: 'COLEMAN', WR3: 'MOSLEY', RB: 'BROWN' };
export const DEF_NUM: Record<DefPos, number> = { DE1: 44, DT1: 0, DT2: 55, DE2: 34, LB1: 10, LB2: 11, CB1: 4, CB2: 24, NB: 2, S1: 22, S2: 25 };
export const DEF_NAME: Record<DefPos, string> = { DE1: 'WEIN', DT1: 'STONE', DT2: 'SAILI', DE2: 'ADEBAWORE', LB1: 'LEWIS', LB2: 'MOORE',
  CB1: 'GUILLORY', CB2: 'JOHNSON', NB: 'ROBINSON', S1: 'BOWEN', S2: 'BOGANOWSKI' };
export const QB_NAME = 'MANNING';
export const DEF_SPOT: Record<DefPos, [number, number]> = {
  DE1: [-3.8, 1.0], DT1: [-1.0, 0.9], DT2: [1.0, 0.9], DE2: [3.8, 1.0], LB1: [-2.6, 5], LB2: [2.6, 5],
  CB1: [-21, 6], CB2: [20, 6], NB: [-12, 5], S1: [-9, 13], S2: [9, 13],
};
export const ELIGIBLE: OffPos[] = ['WR1', 'WR2', 'WR3', 'TE', 'RB'];

const baseCover: Partial<Record<DefPos, Cover>> = {
  CB1: { man: 'WR1', cushion: 0.4, lag: 0.45 }, CB2: { man: 'WR2', cushion: 0.4, lag: 0.45 }, NB: { man: 'WR3', cushion: 0.3, lag: 0.5 },
  LB1: { man: 'RB', cushion: 0.2, lag: 0.6 }, LB2: { man: 'TE', cushion: 0.2, lag: 0.6 },
  S1: { zone: [-10, 18] }, S2: { zone: [10, 18] },
};

export const PLAYS: Play[] = [
  {
    name: 'SLANT FLAT', desc: 'Quick. WR1 slant, slot to the flat',
    routes: {
      WR1: [[0, 0, 0], [0, 4, 0.7], [6, 10, 1.6], [12, 15, 2.5], [20, 21, 3.6]],
      WR3: [[0, 0, 0], [-3, 2, 0.6], [-9, 3, 1.6], [-14, 4, 2.6]],
      WR2: [[0, 0, 0], [0, 4, 0.7], [-6, 10, 1.6], [-12, 15, 2.5], [-20, 21, 3.6]],
      TE: [[0, 0, 0], [0, 8, 1.4], [0, 16, 2.6], [0, 26, 3.9]],
      RB: [[0, 0, 0], [4, 2, 1.0], [10, 4, 2.2], [14, 5, 3.0]],
    },
    coverage: baseCover, sackTime: [3.0, 3.6], yac: { WR1: [3, 12], WR2: [3, 12], WR3: [2, 8], TE: [2, 7], RB: [1, 6] },
  },
  {
    name: 'MESH', desc: 'Crossers underneath, dig and corner over the top',
    routes: {
      WR3: [[0, 0, 0], [3, 4, 0.8], [14, 5, 1.9], [26, 6, 3.1], [34, 6, 4.0]],
      TE: [[0, 0, 0], [-3, 3, 0.8], [-14, 5, 1.9], [-26, 6, 3.1], [-34, 6, 4.0]],
      WR1: [[0, 0, 0], [0, 12, 1.6], [10, 13, 2.5], [22, 13, 3.6]],
      WR2: [[0, 0, 0], [0, 10, 1.4], [5, 19, 2.7], [9, 28, 3.9]],
      RB: [[0, 0, 0], [-5, 1, 1.0], [-9, 6, 2.0], [-10, 16, 3.3]],
    },
    coverage: baseCover, sackTime: [3.2, 3.8], yac: { WR3: [4, 14], TE: [3, 10], WR1: [2, 10], WR2: [2, 8], RB: [2, 10] },
  },
  {
    name: 'FOUR VERTS', desc: 'Everybody deep. Hit the seam',
    routes: {
      WR1: [[0, 0, 0], [0, 10, 1.4], [1, 25, 3.2], [1, 42, 5.2]],
      WR2: [[0, 0, 0], [0, 10, 1.4], [-1, 25, 3.2], [-1, 42, 5.2]],
      WR3: [[0, 0, 0], [1, 10, 1.4], [3, 25, 3.2], [4, 42, 5.2]],
      TE: [[0, 0, 0], [0, 9, 1.5], [-1, 22, 3.2], [-2, 38, 5.2]],
      RB: [[0, 0, 0], [3, 2, 1.0], [6, 5, 2.2], [7, 7, 3.0]],
    },
    coverage: baseCover, sackTime: [3.6, 4.2], yac: { WR1: [2, 9], WR2: [2, 9], WR3: [2, 8], TE: [1, 6], RB: [2, 8] },
  },
  {
    name: 'POST CORNER', desc: 'Shot play. WR1 sells the post, breaks to the pylon',
    routes: {
      WR1: [[0, 0, 0], [0, 10, 1.4], [3, 14, 1.9], [-5, 24, 3.2], [-9, 33, 4.3]],
      WR2: [[0, 0, 0], [0, 12, 1.6], [-8, 26, 3.3], [-12, 38, 4.8]],
      WR3: [[0, 0, 0], [0, 6, 0.9], [-6, 7, 1.6], [-10, 7, 2.2]],
      TE: [[0, 0, 0], [-2, 3, 0.8], [-12, 4, 2.2], [-22, 5, 3.4]],
      RB: [[0, 0, 0], [4, 1, 1.2], [6, 3, 2.4]],
    },
    coverage: { ...baseCover, S2: { zone: [0, 20] }, S1: { man: 'WR2', cushion: 1.5, lag: 0.55 } },
    sackTime: [3.6, 4.3], yac: { WR1: [2, 10], WR2: [2, 9], WR3: [1, 6], TE: [2, 8], RB: [1, 5] },
  },
  {
    name: 'SMASH', desc: 'Hitch underneath, corner over the top',
    routes: { WR1: [[0, 0, 0], [0, 5, 0.8], [0, 4, 1.4], [1, 4, 3]], WR3: [[0, 0, 0], [0, 10, 1.4], [-7, 18, 2.6], [-11, 26, 3.8]],
      WR2: [[0, 0, 0], [0, 5, 0.8], [0, 4, 1.4], [-1, 4, 3]], TE: [[0, 0, 0], [0, 10, 1.4], [7, 18, 2.6], [11, 26, 3.8]], RB: [[0, 0, 0], [4, 2, 1], [9, 3, 2.2]] },
    coverage: baseCover, sackTime: [3.2, 3.8], yac: { WR1: [2, 8], WR2: [2, 8], WR3: [2, 9], TE: [2, 8], RB: [1, 6] },
  },
  {
    name: 'DAGGER', desc: 'Slot clears deep, outside runs the dig behind it',
    routes: { WR3: [[0, 0, 0], [0, 12, 1.6], [1, 30, 3.8]], WR1: [[0, 0, 0], [0, 14, 1.9], [12, 15, 2.9], [22, 16, 3.9]],
      WR2: [[0, 0, 0], [0, 6, 0.9], [-3, 6, 1.5]], TE: [[0, 0, 0], [0, 4, 0.8], [-6, 5, 1.8]], RB: [[0, 0, 0], [-4, 1, 1], [-8, 3, 2]] },
    coverage: baseCover, sackTime: [3.5, 4.1], yac: { WR1: [3, 12], WR3: [2, 9], WR2: [1, 5], TE: [1, 6], RB: [1, 6] },
  },
  {
    name: 'FLOOD', desc: 'Three levels to the left sideline',
    routes: { WR2: [[0, 0, 0], [0, 10, 1.4], [0, 32, 3.8]], TE: [[0, 0, 0], [0, 8, 1.3], [8, 14, 2.6], [12, 15, 3.4]],
      RB: [[0, 0, 0], [5, 1, 1], [12, 3, 2.2], [16, 4, 3]], WR1: [[0, 0, 0], [0, 10, 1.4], [8, 16, 2.6]], WR3: [[0, 0, 0], [0, 5, 0.8], [5, 7, 1.6]] },
    coverage: baseCover, sackTime: [3.3, 3.9], yac: { TE: [3, 10], RB: [2, 9], WR2: [2, 9], WR1: [2, 8], WR3: [1, 6] },
  },
  {
    name: 'CURL FLAT', desc: 'Outside curls at 12, backs into the flats',
    routes: { WR1: [[0, 0, 0], [0, 13, 1.8], [1, 11, 2.4], [1, 11, 3.5]], WR2: [[0, 0, 0], [0, 13, 1.8], [-1, 11, 2.4], [-1, 11, 3.5]],
      WR3: [[0, 0, 0], [-4, 2, 0.8], [-10, 3, 1.8]], TE: [[0, 0, 0], [4, 2, 0.8], [10, 3, 1.9]], RB: [[0, 0, 0], [0, 4, 1], [0, 6, 2]] },
    coverage: baseCover, sackTime: [3.1, 3.7], yac: { WR1: [1, 6], WR2: [1, 6], WR3: [2, 8], TE: [2, 8], RB: [1, 5] },
  },
  {
    name: 'SPOT', desc: 'Snag, flat and corner triangle',
    routes: { WR3: [[0, 0, 0], [0, 5, 0.8], [3, 6, 1.4], [3, 6, 3]], RB: [[0, 0, 0], [-5, 1, 0.9], [-12, 2, 2]], TE: [[0, 0, 0], [0, 10, 1.4], [-6, 18, 2.6], [-10, 24, 3.6]],
      WR1: [[0, 0, 0], [0, 14, 1.9], [0, 30, 3.8]], WR2: [[0, 0, 0], [0, 8, 1.2], [-5, 12, 2.2]] },
    coverage: baseCover, sackTime: [3.0, 3.6], yac: { WR3: [1, 6], RB: [2, 8], TE: [2, 8], WR1: [2, 9], WR2: [2, 8] },
  },
  {
    name: 'Y CROSS', desc: 'Tight end crosses the field at 15',
    routes: { TE: [[0, 0, 0], [0, 8, 1.2], [-10, 14, 2.4], [-24, 16, 3.6]], WR1: [[0, 0, 0], [0, 12, 1.6], [0, 30, 3.8]],
      WR2: [[0, 0, 0], [0, 10, 1.4], [5, 18, 2.6]], WR3: [[0, 0, 0], [0, 6, 0.9], [4, 7, 1.6]], RB: [[0, 0, 0], [-5, 1, 1], [-11, 3, 2.2]] },
    coverage: baseCover, sackTime: [3.5, 4.1], yac: { TE: [3, 12], WR1: [2, 9], WR2: [2, 8], WR3: [1, 6], RB: [2, 8] },
  },
  {
    name: 'STICK', desc: 'Quick out at 6, fast decision',
    routes: { TE: [[0, 0, 0], [0, 6, 0.9], [2, 6, 1.4], [2, 6, 3]], WR3: [[0, 0, 0], [-3, 2, 0.6], [-8, 3, 1.5]], WR1: [[0, 0, 0], [0, 10, 1.4], [0, 28, 3.6]],
      WR2: [[0, 0, 0], [0, 6, 0.9], [-2, 6, 1.4], [-2, 6, 3]], RB: [[0, 0, 0], [4, 1, 1], [9, 2, 2]] },
    coverage: baseCover, sackTime: [2.8, 3.4], yac: { TE: [1, 5], WR3: [2, 8], WR1: [2, 9], WR2: [1, 5], RB: [1, 6] },
  },
  {
    name: 'DOUBLE MOVE', desc: 'Sluggo: fake the slant, go deep',
    routes: { WR1: [[0, 0, 0], [0, 5, 0.8], [3, 7, 1.3], [3, 9, 1.7], [2, 36, 4.6]], WR2: [[0, 0, 0], [0, 5, 0.8], [-3, 7, 1.3], [-3, 9, 1.7], [-2, 36, 4.6]],
      WR3: [[0, 0, 0], [0, 6, 0.9], [-4, 7, 1.6]], TE: [[0, 0, 0], [0, 3, 0.6], [0, 3, 3]], RB: [[0, 0, 0], [3, 1, 1], [7, 2, 2]] },
    coverage: baseCover, sackTime: [3.8, 4.4], yac: { WR1: [3, 14], WR2: [3, 14], WR3: [1, 6], TE: [1, 4], RB: [1, 6] },
  },
  {
    name: 'SCREEN', desc: 'Back slips out behind the rush',
    routes: { RB: [[0, 0, 0], [-3, -1, 0.9], [-7, -2, 1.7], [-8, -2, 3]], WR1: [[0, 0, 0], [0, 12, 1.6], [0, 22, 3]], WR2: [[0, 0, 0], [0, 12, 1.6], [0, 22, 3]],
      WR3: [[0, 0, 0], [0, 4, 0.7], [3, 4, 1.4]], TE: [[0, 0, 0], [0, 10, 1.4], [0, 20, 2.8]] },
    coverage: baseCover, sackTime: [3.0, 3.5], yac: { RB: [5, 20], WR1: [1, 6], WR2: [1, 6], WR3: [1, 6], TE: [1, 6] },
  },
  {
    name: 'HAIL MARY', desc: 'Everybody to the end zone',
    routes: { WR1: [[0, 0, 0], [3, 20, 2.8], [10, 48, 6]], WR2: [[0, 0, 0], [-3, 20, 2.8], [-10, 48, 6]], WR3: [[0, 0, 0], [5, 20, 2.8], [8, 48, 6]],
      TE: [[0, 0, 0], [-2, 18, 2.8], [-4, 44, 6]], RB: [[0, 0, 0], [3, 2, 1], [5, 3, 2]] },
    coverage: baseCover, sackTime: [4.2, 4.8], yac: { WR1: [0, 6], WR2: [0, 6], WR3: [0, 6], TE: [0, 4], RB: [1, 5] },
  },
];

export type DefCall = 'MAN' | 'COVER 2' | 'COVER 3' | 'BLITZ' | 'ROBBER';
/** Coverage for this snap. Zones are [x yards, depth yards] from the line. */
export function makeCoverage(call: DefCall, base: Partial<Record<DefPos, Cover>>): Partial<Record<DefPos, Cover>> {
  switch (call) {
    case 'COVER 2': return { CB1: { zone: [-20, 4] }, CB2: { zone: [20, 4] }, NB: { zone: [-11, 8] }, LB1: { zone: [-4, 9] }, LB2: { zone: [5, 9] },
      S1: { zone: [-12, 20] }, S2: { zone: [12, 20] } };
    case 'COVER 3': return { CB1: { zone: [-18, 18] }, CB2: { zone: [18, 18] }, S2: { zone: [0, 22] }, S1: { zone: [-9, 9] }, NB: { zone: [-14, 6] },
      LB1: { zone: [-4, 8] }, LB2: { zone: [5, 8] } };
    case 'BLITZ': return { ...base, LB1: { blitz: true }, S1: { man: 'RB', cushion: 2, lag: 0.6 } };
    case 'ROBBER': return { ...base, S1: { zone: [-9, 13], rot: { at: 0.5, zone: [0, 22] } }, S2: { zone: [9, 13], rot: { at: 0.5, zone: [5, 9] } } };
    default: return base;
  }
}
