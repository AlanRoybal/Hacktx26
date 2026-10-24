/** Scripted plays. Yards: x = world x (QB's left is +x), y = downfield from the line. Route points [x, y, t]
 * are offsets from the player's start; t in seconds after the snap. */
export type OffPos = 'WR1' | 'WR2' | 'WR3' | 'TE' | 'RB' | 'LT' | 'LG' | 'C' | 'RG' | 'RT';
export type DefPos = 'DE1' | 'DT1' | 'DT2' | 'DE2' | 'LB1' | 'LB2' | 'CB1' | 'CB2' | 'NB' | 'S1' | 'S2';
export type Cover = { man?: OffPos; zone?: [number, number]; cushion?: number; lag?: number; blitz?: boolean };

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
export const OFF_NUM: Record<OffPos, number> = { LT: 72, LG: 65, C: 55, RG: 70, RT: 78, TE: 86, WR1: 1, WR2: 11, WR3: 4, RB: 7 };
export const DEF_NUM: Record<DefPos, number> = { DE1: 90, DT1: 95, DT2: 9, DE2: 44, LB1: 23, LB2: 10, CB1: 2, CB2: 7, NB: 13, S1: 8, S2: 21 };
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
];
