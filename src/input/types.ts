export interface Sample { t: number; gx: number; gy: number; gz: number; ax: number; ay: number; az: number; trig: boolean }

/** Same output from the Joy-Con and the mouse fallback, so the game can't tell them apart. */
export interface ThrowEvent {
  speed: number;      // m/s
  launchDeg: number;  // launch angle above horizontal
  yawDeg: number;     // + = toward the QB's left (+x)
  wobble: number;     // 0 perfect spiral .. 1 duck
  timingMs: number;   // release minus peak arm speed; + = late
  wPeak: number;      // deg/s
  source: 'joycon' | 'mouse' | 'auto';
}

export interface InputListener {
  onTrigger(down: boolean): void;
  onThrow(e: ThrowEvent): void;
  onPumpFake(): void;
}
